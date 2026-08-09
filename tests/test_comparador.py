"""Regressão do diff entre duas varreduras.

O comparador que existia no frontend derivava tudo da diferença de contagem:

    newViolations: violationsDiff > 0 ? ['Nova violação detectada'] : []

Isso erra justamente no caso que mais importa — três achados corrigidos e três
novos aparecendo dão delta zero, e a tela dizia "sem mudança" quando o trabalho
tinha sido feito e uma regressão havia entrado junto.

O risco aqui não é o comparador quebrar: é ele dar uma resposta plausível e
errada. "Você corrigiu tudo" sobre um site que continua irregular é pior do que
não ter a funcionalidade.
"""
import pytest

from audit_engine.comparador import (
    chave_da_violacao,
    comparar,
    resumo_em_texto,
)


def v(article, description, tag="Página", severity="high", violation=None):
    return {
        "article": article,
        "description": description,
        "tag": tag,
        "severity": severity,
        "violation": violation or f"{description} em {tag}",
    }


SEM_CMP = v("LGPD art. 7º, I", "Rastreamento sem mecanismo de consentimento na página", severity="critical")
COOKIE_GA = v("LGPD art. 7º, I e art. 16", "Cookie de rastreamento gravado antes de qualquer consentimento", "Google Analytics 4")
COOKIE_META = v("LGPD art. 7º, I e art. 16", "Cookie de rastreamento gravado antes de qualquer consentimento", "Meta Pixel")
UA_OBSOLETO = v("LGPD art. 46", "Tecnologia descontinuada em uso (Universal Analytics)", "Universal Analytics", "medium")


def scan(violacoes, score=50, tags=()):
    return {
        "privacy": {"violations": list(violacoes)},
        "scores": {"overall": score},
        "tags": [{"name": t} for t in tags],
    }


class TestChaveDeIdentidade:
    """Decidir quando dois achados de varreduras diferentes são o mesmo."""

    def test_mesmo_achado_gera_mesma_chave(self):
        assert chave_da_violacao(COOKIE_GA) == chave_da_violacao(dict(COOKIE_GA))

    def test_tags_diferentes_sao_achados_diferentes(self):
        """O mesmo artigo violado por duas tags são dois problemas."""
        assert chave_da_violacao(COOKIE_GA) != chave_da_violacao(COOKIE_META)

    def test_texto_variavel_nao_muda_a_identidade(self):
        """A frase da violação embute contagem e nomes de tag: "3 ferramentas
        ativas: GA4, Meta, Clarity". Se ela entrasse na chave, remover uma tag
        faria todo o resto parecer achado novo — e o cliente leria "você não
        corrigiu nada" logo depois de ter corrigido."""
        antes = dict(SEM_CMP, violation="Nenhum controle, e 3 ferramentas ativas: GA4, Meta, Clarity")
        depois = dict(SEM_CMP, violation="Nenhum controle, e 2 ferramentas ativas: GA4, Meta")
        assert chave_da_violacao(antes) == chave_da_violacao(depois)

    def test_acento_e_caixa_nao_importam(self):
        a = v("LGPD art. 7º, I", "Rastreamento sem mecanismo")
        b = v("lgpd art 7º, i", "RASTREAMENTO SEM MECANISMO")
        assert chave_da_violacao(a) == chave_da_violacao(b)

    def test_violacao_sem_campos_nao_quebra(self):
        assert chave_da_violacao({}) == ""


class TestOCasoQueOComparadorAntigoErrava:
    def test_mesmo_total_com_troca_completa_nao_e_sem_mudanca(self):
        """Delta zero, mas tudo mudou: 2 corrigidas e 2 novas."""
        antes = scan([COOKIE_GA, COOKIE_META])
        agora = scan([SEM_CMP, UA_OBSOLETO])

        d = comparar(antes, agora)

        assert d["totais"]["antes"] == d["totais"]["agora"] == 2
        assert d["veredito"] == "misto", "delta zero escondia a regressão"
        assert d["totais"]["corrigidas"] == 2
        assert d["totais"]["novas"] == 2
        assert d["totais"]["persistentes"] == 0

    def test_regressao_junto_com_correcao_aparece(self):
        antes = scan([COOKIE_GA, COOKIE_META, UA_OBSOLETO])
        agora = scan([COOKIE_GA, SEM_CMP])

        d = comparar(antes, agora)
        assert d["veredito"] == "misto"
        assert [x["tag"] for x in d["corrigidas"]] == ["Meta Pixel", "Universal Analytics"] or \
               sorted(x["tag"] for x in d["corrigidas"]) == ["Meta Pixel", "Universal Analytics"]
        assert [x["description"] for x in d["novas"]] == [SEM_CMP["description"]]
        assert [x["tag"] for x in d["persistentes"]] == ["Google Analytics 4"]


class TestVeredito:
    def test_so_correcao_e_melhorou(self):
        d = comparar(scan([COOKIE_GA, COOKIE_META]), scan([COOKIE_GA]))
        assert d["veredito"] == "melhorou"

    def test_so_achado_novo_e_regrediu(self):
        d = comparar(scan([COOKIE_GA]), scan([COOKIE_GA, SEM_CMP]))
        assert d["veredito"] == "regrediu"

    def test_nada_muda_e_sem_mudanca(self):
        d = comparar(scan([COOKIE_GA]), scan([COOKIE_GA]))
        assert d["veredito"] == "sem_mudanca"
        assert d["totais"]["persistentes"] == 1

    def test_site_que_ficou_limpo(self):
        d = comparar(scan([COOKIE_GA, SEM_CMP]), scan([]))
        assert d["veredito"] == "melhorou"
        assert d["totais"]["agora"] == 0
        assert d["totais"]["corrigidas"] == 2


class TestOrdenacao:
    def test_mais_grave_primeiro(self):
        """Quem lê o diff decide o que fazer hoje: crítico vem antes."""
        d = comparar(scan([]), scan([UA_OBSOLETO, SEM_CMP]))
        assert d["novas"][0]["severity"] == "critical"


class TestScoreETags:
    def test_variacao_do_score(self):
        d = comparar(scan([COOKIE_GA], score=40), scan([], score=75))
        assert d["score"]["antes"] == 40
        assert d["score"]["agora"] == 75
        assert d["score"]["variacao"] == 35

    def test_score_ausente_nao_inventa_variacao(self):
        d = comparar({"privacy": {"violations": []}}, {"privacy": {"violations": []}})
        assert d["score"]["variacao"] is None

    def test_tag_nova_aparece(self):
        """Tag que entrou entre as duas visitas costuma ser a causa da
        regressão — é a primeira coisa que o implementador quer saber."""
        d = comparar(scan([], tags=["Google Analytics 4"]), scan([], tags=["Google Analytics 4", "TikTok Pixel"]))
        assert d["tags"]["adicionadas"] == ["TikTok Pixel"]
        assert d["tags"]["removidas"] == []

    def test_tag_removida_aparece(self):
        d = comparar(scan([], tags=["Google Analytics 4", "Hotjar"]), scan([], tags=["Google Analytics 4"]))
        assert d["tags"]["removidas"] == ["Hotjar"]


class TestEntradaImprestavel:
    """Comparador que estoura é ruim; comparador que mente é pior."""

    def test_scan_vazio_dos_dois_lados(self):
        d = comparar(None, None)
        assert d["veredito"] == "sem_mudanca"
        assert d["totais"] == {"antes": 0, "agora": 0, "corrigidas": 0, "persistentes": 0, "novas": 0}

    def test_raw_data_sem_privacy(self):
        d = comparar({"tags": []}, {"tags": []})
        assert d["totais"]["antes"] == 0

    def test_violations_com_tipo_errado(self):
        """Já houve resposta com `violations` vindo como dict em vez de lista."""
        d = comparar({"privacy": {"violations": "isso não é lista"}}, scan([COOKIE_GA]))
        assert d["totais"]["antes"] == 0
        assert d["totais"]["novas"] == 1

    def test_item_nao_dict_na_lista_e_ignorado(self):
        d = comparar({"privacy": {"violations": [None, "texto", COOKIE_GA]}}, scan([COOKIE_GA]))
        assert d["totais"]["antes"] == 1
        assert d["veredito"] == "sem_mudanca"


class TestResumo:
    def test_resumo_de_caso_misto_cita_os_tres_numeros(self):
        d = comparar(scan([COOKIE_GA, COOKIE_META]), scan([COOKIE_GA, SEM_CMP]))
        texto = resumo_em_texto(d)
        assert "1 corrigida" in texto
        assert "1 nova" in texto
        assert "1 ainda aberta" in texto

    def test_resumo_sem_mudanca_diz_quantas_continuam(self):
        d = comparar(scan([COOKIE_GA]), scan([COOKIE_GA]))
        assert "1 não conformidades continuam" in resumo_em_texto(d) or "continuam" in resumo_em_texto(d)

    def test_resumo_de_site_limpo_nos_dois(self):
        d = comparar(scan([]), scan([]))
        assert "nenhuma não conformidade" in resumo_em_texto(d).lower()
