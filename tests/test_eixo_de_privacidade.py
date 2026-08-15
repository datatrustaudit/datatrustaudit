"""O eixo de privacidade ia para a tela com o sinal trocado.

`compute_privacy_risk` devolve RISCO — quanto maior, pior — e o docstring dizia
"exibido invertido na tela". A tela não invertia: `PainelDeScores` desenhava
`privacyRiskScore` cru na mesma escala dos outros cinco eixos, onde acima de 80
é verde e "Adequado".

Medido no laudo de exemplo (`static/src/dev/laudo-de-exemplo.json`), com 11
violações críticas e 4 altas: risco 74, e a tela estampava "Privacidade 74%".
O correto era 26% — vermelho, "Crítico". Um site com risco máximo apareceria
como "Privacidade 100% — Adequado", em verde.

E o painel escolhe o "Comece por X" pelo MENOR valor: o eixo mais perigoso
virava o de melhor aparência, e a recomendação de por onde começar apontava
para o lado errado.

A correção publica `privacyProtectionScore` já invertido, com o nome dizendo a
direção, e mantém `privacyRiskScore` cru para quem já lia essa chave.
"""
from api.audit import _safe_dict
from audit_engine.models import AuditResult, AuditScores, privacy_protection_from_risk
from audit_engine.score_engine import _PESOS, compute_privacy_risk, compute_scores


#: A faixa que `PainelDeScores.faixaDe` usa: >= 80 é "Adequado", em verde.
#: Repetida aqui de propósito — é a regra que o laudo publica, e o teste existe
#: para impedir que um site de alto risco caia nela.
FAIXA_ADEQUADO = 80


class _Violacao:
    def __init__(self, severity):
        self.severity = severity


class _Privacy:
    def __init__(self, violacoes, tem_cmp=True):
        self.violations = [_Violacao(s) for s in violacoes]
        self.has_consent_tool = tem_cmp


class _Consent:
    cmp_detected = True
    consent_mode_v2 = True
    consent_mode_version = "v2"
    has_default_denied = True
    has_reject_all = True
    has_privacy_policy = True
    has_cookie_policy = True
    tags_before_consent = []


class _Evento:
    def __init__(self, nome="page_view", validity="valid"):
        self.name = nome
        self.validity = validity


class _Eventos:
    """Eventos limpos: serve para isolar a privacidade como pior eixo."""
    def __init__(self):
        self.total_events = 3
        self.events = [_Evento(n) for n in ("page_view", "scroll", "click")]
        self.duplicated_event_names = 0
        self.ecommerce_events_detected = []


def _scores_de_site_de_alto_risco():
    """O cenário do laudo de exemplo: 11 críticas e 4 altas."""
    privacy = _Privacy(["critical"] * 11 + ["high"] * 4)
    return compute_scores([], None, _Eventos(), [], _Consent(), privacy, [])


class TestDirecaoDoEixo:
    def test_protecao_e_o_inverso_do_risco(self):
        assert privacy_protection_from_risk(0) == 100
        assert privacy_protection_from_risk(74) == 26
        assert privacy_protection_from_risk(100) == 0

    def test_valor_fora_da_faixa_nao_escapa(self):
        """Risco negativo ou acima de 100 não pode virar barra fora do trilho."""
        assert privacy_protection_from_risk(-10) == 100
        assert privacy_protection_from_risk(150) == 0

    def test_risco_maior_significa_protecao_menor(self):
        anterior = 101
        for risco in range(0, 101, 10):
            atual = privacy_protection_from_risk(risco)
            assert atual < anterior, f"risco {risco} não reduziu a proteção"
            anterior = atual


class TestRespostaPublicaOEixoJaInvertido:
    def test_campo_de_exibicao_vem_invertido(self):
        publicado = AuditScores(
            overall=40, tracking_quality=60, event_architecture=100,
            datalayer_quality=100, consent_integrity=100, privacy_risk=74,
        ).to_dict()
        assert publicado["privacyProtectionScore"] == 26

    def test_campo_legado_continua_sendo_risco_cru(self):
        """Compatibilidade: quem já lia `privacyRiskScore` recebe o risco.

        Inverter o campo antigo em vez de criar um novo trocaria o significado
        de uma chave já publicada — o mesmo defeito, só que do outro lado.
        """
        publicado = AuditScores(
            overall=40, tracking_quality=60, event_architecture=100,
            datalayer_quality=100, consent_integrity=100, privacy_risk=74,
        ).to_dict()
        assert publicado["privacyRiskScore"] == 74

    def test_os_dois_campos_nunca_divergem(self):
        for risco in (0, 1, 26, 50, 74, 99, 100):
            d = AuditScores(
                overall=0, tracking_quality=0, event_architecture=0,
                datalayer_quality=0, consent_integrity=0, privacy_risk=risco,
            ).to_dict()
            assert d["privacyProtectionScore"] + d["privacyRiskScore"] == 100

    def test_o_campo_chega_a_resposta_da_api(self):
        """`_safe_dict` é o caminho real de `/api/audit`; um campo que ele não
        carrega some em silêncio antes da tela."""
        resultado = AuditResult(
            url="https://exemplo.com.br",
            timestamp="2026-08-15T12:00:00Z",
            scores=_scores_de_site_de_alto_risco(),
        )
        scores = _safe_dict(resultado)["scores"]
        assert "privacyProtectionScore" in scores
        assert scores["privacyProtectionScore"] == 100 - scores["privacyRiskScore"]


class TestSiteDeAltoRiscoNaoApareceComoAdequado:
    """A regressão que motivou tudo isto."""

    def test_onze_criticas_nao_podem_pintar_de_verde(self):
        scores = _scores_de_site_de_alto_risco()
        exibido = scores.to_dict()["privacyProtectionScore"]
        assert exibido < FAIXA_ADEQUADO, (
            f"site com 11 violações críticas exibiria Privacidade {exibido}% — "
            "na faixa 'Adequado', em verde"
        )
        assert exibido < 50, f"esperado bem abaixo da metade, veio {exibido}%"

    def test_risco_maximo_exibe_zero(self):
        privacy = _Privacy(["critical"] * 200, tem_cmp=False)
        risco = compute_privacy_risk(privacy)
        assert risco >= 95, f"cenário não saturou o risco: {risco}"
        assert privacy_protection_from_risk(risco) <= 5

    def test_privacidade_ruim_vence_o_comece_por(self):
        """`PainelDeScores` aponta o MENOR eixo como ponto de partida.

        Com o valor cru, o eixo mais perigoso era o de maior número e a seta
        apontava para outro lugar. Aqui o pior eixo tem que ser a privacidade.
        """
        publicado = _scores_de_site_de_alto_risco().to_dict()
        especificos = {
            chave: valor for chave, valor in publicado.items()
            if chave not in ("auditScore", "privacyRiskScore")
        }
        pior = min(especificos, key=especificos.get)
        assert pior == "privacyProtectionScore", (
            f"o painel mandaria começar por {pior}, e não pela privacidade: {especificos}"
        )

    def test_site_limpo_continua_verde(self):
        """A inversão não pode derrubar quem está correto — falso positivo em
        laudo custa mais caro que falso negativo."""
        scores = compute_scores([], None, _Eventos(), [], _Consent(), _Privacy([]), [])
        assert scores.to_dict()["privacyProtectionScore"] == 100


class TestEixoNaoMedidoNaoViraConformidade:
    """O outro lado da inversão: eixo AUSENTE não pode virar 100%.

    `analyze_privacy` roda dentro de um `try/except` no orchestrator (para que
    uma página ruim não derrube a varredura das outras) e, ao falhar, deixa
    `privacy_result = None`. `compute_privacy_risk` devolvia 0 nesse caso, e 0
    de RISCO é 100 de PROTEÇÃO: o laudo estampava "Privacidade 100% —
    Adequado", em verde, exatamente sobre o eixo que ninguém conseguiu apurar —
    e ainda levantava a média ponderada, onde a privacidade pesa 0,25.

    É o mesmo defeito que o resto deste arquivo corrige, só que na direção
    oposta e mais cara: reduzir demais também mente, e "conforme" por engano é
    o que o cliente publica sem conferir.
    """

    def test_analise_ausente_nao_e_risco_zero(self):
        assert compute_privacy_risk(None) is None

    def test_a_resposta_publica_nao_medido_em_vez_de_100(self):
        publicado = compute_scores([], None, None, [], None, None, []).to_dict()
        assert publicado["privacyProtectionScore"] is None, (
            "eixo não apurado voltou a ser publicado como "
            f"{publicado['privacyProtectionScore']}% — a faixa a partir de 80 é "
            "'Adequado', em verde"
        )
        assert publicado["privacyRiskScore"] is None

    def test_eixo_ausente_fica_fora_da_media(self):
        """Com privacidade ausente, o geral é a média só dos que sobraram.

        Entrando como 100 com peso 0,25, o eixo não apurado puxava o score
        geral para cima: 87 numa varredura em que só rastreamento (60) e
        dataLayer (100) foram medidos, contra os 77 honestos.

        A comparação é contra `_PESOS` — a mesma tabela que o motor usa —, e
        não contra um número escrito à mão, que envelheceria calado no dia em
        que os pesos mudassem. O que discrimina é a lista de eixos: se a
        privacidade voltar a entrar nela, o valor esperado deixa de bater.
        """
        scores = compute_scores([], None, None, [], None, None, [])

        assert scores.privacy_protection is None, (
            "a privacidade não foi apurada e mesmo assim entrou na média como "
            f"{scores.privacy_protection}"
        )

        medidos = {
            "tracking": scores.tracking_quality,
            "eventos": scores.event_architecture,
            "datalayer": scores.datalayer_quality,
            "consentimento": scores.consent_integrity,
            "privacidade": scores.privacy_protection,
        }
        presentes = {n: v for n, v in medidos.items() if v is not None}
        assert presentes, "cenário sem eixo medido nenhum não testa nada"

        peso = sum(_PESOS[n] for n in presentes)
        esperado = round(sum(_PESOS[n] * v for n, v in presentes.items()) / peso)
        assert scores.overall == esperado, (
            f"geral {scores.overall} não bate com a média dos eixos medidos "
            f"({esperado}, sobre {sorted(presentes)}): algo não apurado entrou na conta"
        )

    def test_privacidade_medida_e_limpa_continua_valendo_100(self):
        """O contrário do falso negativo: site apurado e sem violação continua
        com o eixo cheio. Sumir com o número de quem está correto é mentir na
        outra direção."""
        scores = compute_scores([], None, _Eventos(), [], _Consent(), _Privacy([]), [])
        assert scores.to_dict()["privacyProtectionScore"] == 100
        assert scores.to_dict()["privacyRiskScore"] == 0


class TestMediaUsaAMesmaInversao:
    def test_eixo_exibido_e_o_que_entrou_na_media(self):
        """Duas inversões independentes divergem: a média ponderada e o eixo da
        tela precisam vir da mesma função."""
        privacy = _Privacy(["critical"] * 4)
        scores = compute_scores([], None, _Eventos(), [], _Consent(), privacy, [])
        exibido = scores.to_dict()["privacyProtectionScore"]
        assert exibido == privacy_protection_from_risk(compute_privacy_risk(privacy))
        # A média fica entre o pior e o melhor eixo medido — se ela tivesse
        # usado o risco cru, sairia acima do teto dos eixos.
        medidos = [
            scores.tracking_quality, scores.event_architecture,
            scores.datalayer_quality, scores.consent_integrity, exibido,
        ]
        assert min(medidos) <= scores.overall <= max(medidos)


class TestEixoNaoMedidoNaoViraZero:
    """O outro lado da mesma moeda: zero é uma NOTA, não um "não sei".

    `compute_scores` já deixava o eixo ausente fora da média ponderada e, na
    linha seguinte, achatava ele para 0 ao montar o `AuditScores`. Na escala do
    painel, 0 é "Nada conforme", em vermelho — e ainda vence o "Comece por X",
    que aponta o menor número. Conferido na tela (`/dev/laudo`) com o eixo de
    eventos ausente: o painel estampava "Eventos — Nada conforme — 0%" e
    "Comece por Eventos", sobre uma página que simplesmente não disparou evento
    nenhum.
    """

    def test_pagina_sem_evento_nao_recebe_nota_de_evento(self):
        scores = compute_scores([], None, None, [], _Consent(), _Privacy([]), [])
        assert scores.event_architecture is None
        assert scores.to_dict()["eventArchitectureScore"] is None

    def test_consentimento_nao_auditado_fica_ausente(self):
        scores = compute_scores([], None, _Eventos(), [], None, _Privacy([]), [])
        assert scores.consent_integrity is None
        assert scores.to_dict()["consentIntegrityScore"] is None

    def test_site_sem_cmp_continua_valendo_zero(self):
        """A fronteira que impede o falso negativo: site sem controle de
        consentimento foi MEDIDO e tirou zero — isso continua sendo 0, não
        "não medido". Trocar um pelo outro apagaria o achado mais caro do
        laudo."""
        from audit_engine.consent_auditor import audit_consent

        html = (
            "<html><head>"
            '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567">'
            "</script></head><body>sem aviso de cookies</body></html>"
        )
        consent = audit_consent(html, ["GA4"])
        scores = compute_scores([], None, _Eventos(), [], consent, _Privacy(["critical"]), [])
        assert scores.consent_integrity == 0
        assert scores.to_dict()["consentIntegrityScore"] == 0


class TestRiscoAusenteNaoViraProtecaoTotal:
    """`100 - None` é `TypeError`, e `100 - 0` é uma mentira em verde.

    Reabrir um laudo cujo `scores` foi gravado incompleto reconstrói o eixo
    como `None` (`api.scans._reconstroi` prefere `None` a inventar valor). Com
    a inversão feita sem checar o tipo, o `to_dict()` levantava `TypeError` e
    derrubava a rota inteira; tratar o ausente como risco 0 publicaria
    "Privacidade 100% — Adequado".
    """

    def test_risco_ausente_devolve_ausente(self):
        assert privacy_protection_from_risk(None) is None

    def test_serializacao_com_eixos_ausentes_nao_estoura(self):
        publicado = AuditScores(
            overall=0, tracking_quality=None, event_architecture=None,
            datalayer_quality=None, consent_integrity=None, privacy_risk=None,
        ).to_dict()
        assert publicado["privacyProtectionScore"] is None
        assert publicado["privacyRiskScore"] is None

    def test_caminho_da_resposta_tambem_sobrevive(self):
        """`_safe_dict` é por onde o laudo reconstruído passa antes da tela."""
        resultado = AuditResult(
            url="https://exemplo.com.br",
            timestamp="2026-08-15T12:00:00Z",
            scores=AuditScores(
                overall=0, tracking_quality=None, event_architecture=None,
                datalayer_quality=None, consent_integrity=None, privacy_risk=None,
            ),
        )
        assert _safe_dict(resultado)["scores"]["privacyProtectionScore"] is None
