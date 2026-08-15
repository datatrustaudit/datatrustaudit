"""A aba "Tag Health" só pode mostrar tempo que alguém mediu.

`TagHealthMonitor.tsx` exibia, por tag, um badge de relógio com
`Math.random() * 200 + 50` — comentado no código como "Simulado", apresentado
na tela como medição. E a análise rodava no corpo do componente, sem
memoização: cada re-render sorteava de novo. O cliente lia "Meta Pixel —
137 ms", anotava, recarregava a página e lia "91 ms".

Nenhum campo de tempo por tag existe no motor: `TagFinding` não tem nada do
gênero. A única medição temporal real é `msSincePageStart`, da linha do tempo
de rede (`storage.firingTimeline`), e é dela que o número passou a sair.

O casamento entre a tag e a requisição é feito pelo NOME DO FORNECEDOR, e ele
só é confiável porque os dois lados nascem da mesma entrada do
`VENDOR_CATALOG`: `TagFinding.name` e o `owner` de cada evento da linha do
tempo. Se essa igualdade se perder, nada estoura — a tela inteira passa a dizer
"sem medição", que é o modo de falha silencioso mais caro deste projeto. Os
testes de motor abaixo existem para que ela não se perca sem aviso.
"""
import json
import re
from pathlib import Path

import pytest

from api.audit import _normalize_audit_response
from audit_engine.orchestrator import run_audit
from tests.test_campos_das_visoes import AGORA, _Req, _Scan


RAIZ = Path(__file__).resolve().parent.parent
COMPONENTE = RAIZ / "static/src/components/TagHealthMonitor.tsx"
PAI = RAIZ / "static/src/components/DeepAnalysisPanel.tsx"
AMOSTRA = RAIZ / "static/src/dev/laudo-de-exemplo.json"


def _codigo(caminho: Path) -> str:
    """O arquivo sem os comentários.

    Os comentários deste componente citam o defeito pelo nome — "vinha de
    `Math.random()`", "saía 'head' / 'body' / 'dynamic'" — e é assim que devem
    continuar: é o registro do que não pode voltar. Procurar a marca no texto
    cru acusaria justamente a documentação da correção.
    """
    fonte = caminho.read_text(encoding="utf-8")
    fonte = re.sub(r"/\*.*?\*/", "", fonte, flags=re.DOTALL)
    # `(?<!:)` preserva `https://…` dentro de string; nada mais neste arquivo
    # tem `//` que não seja comentário.
    return re.sub(r"(?<!:)//.*", "", fonte)


class TestNadaEFabricadoNaTela:
    """A conferência é sobre o texto do `.tsx`: ele só carrega dentro do
    empacotador, e a reintrodução do valor sorteado é uma linha só."""

    def test_a_aba_nao_sorteia_numero(self):
        assert "Math.random" not in _codigo(COMPONENTE), (
            "voltou um valor sorteado ao monitor de saúde das tags — o laudo "
            "exibia um tempo que mudava a cada re-render"
        )

    def test_nao_ha_valor_declaradamente_simulado(self):
        """As marcas honestas do código antigo (`// Simulado`) ficavam ao lado
        de uma tela que apresentava tudo como observado."""
        fonte = COMPONENTE.read_text(encoding="utf-8").lower()
        for marca in ("// simulado", "// mock", "// fake", "// placeholder"):
            assert marca not in fonte, (
                f"marca de valor inventado ({marca!r}) no monitor de saúde das tags"
            )

    def test_o_tempo_exibido_vem_da_linha_do_tempo_de_rede(self):
        """O badge de relógio precisa estar preso ao campo medido; sem essa
        amarra, qualquer número volta a caber ali."""
        codigo = _codigo(COMPONENTE)
        assert "msSincePageStart" in codigo, (
            "o monitor não lê mais a única medição de tempo que o motor produz"
        )
        assert "primeiraRequisicaoMs" in codigo

    def test_a_ausencia_de_medicao_e_dita(self):
        """Campo ausente é dito, nunca preenchido: sem linha do tempo a aba
        precisa declarar isso na tela."""
        fonte = COMPONENTE.read_text(encoding="utf-8")
        assert "não trouxe a linha do tempo de rede" in fonte
        assert "sem medição de tempo" in fonte

    def test_a_posicao_no_html_nao_e_deduzida(self):
        """A aba rotulava a tag como 'head' / 'body' / 'dynamic' a partir do
        número da linha — e `lineNumber` chega 0 para tag detectada só na rede,
        o que fazia toda tag sem linha aparecer como 'head'."""
        rotulos = re.findall(r"'(head|body|dynamic)'", _codigo(COMPONENTE))
        assert not rotulos, (
            "a posição no HTML voltou a ser deduzida do número da linha: " + str(rotulos)
        )

    def test_a_ausencia_na_lista_nao_vira_afirmacao_sobre_a_varredura(self):
        """Não ter casado com requisição é fato sobre A LISTA, não sobre o site.

        A aba resumia a ausência com "a varredura não registrou requisição
        atribuível a elas" — afirmação que o laudo não tem como sustentar: a
        linha do tempo guarda as 60 primeiras requisições de rastreio (ver
        `TestALinhaDoTempoEUmRecorte`), e `totalTimelineEvents` é contado depois
        do corte, então nem o servidor sabe dizer quantas ficaram de fora.
        Numa peça de evidência, negativa fabricada custa o mesmo que positiva.
        """
        fonte = COMPONENTE.read_text(encoding="utf-8")
        alvo = fonte.split("{comMedicao}", 1)
        assert len(alvo) == 2, "o resumo de quantas tags casaram sumiu da aba"
        # Só o texto da frase, para que o comentário que registra o defeito
        # (e que precisa citá-lo pelo nome) não derrube o teste. O espaço é
        # colapsado porque o JSX quebra a frase em várias linhas e o navegador
        # a renderiza como uma só — procurar no texto cru acharia menos do que
        # o leitor lê.
        frase = re.sub(r"\s+", " ", alvo[1].split("</p>", 1)[0])
        assert "não registrou" not in frase, (
            "a aba voltou a afirmar que a varredura não registrou requisição "
            "das tags sem medição — ela só sabe que a lista não traz"
        )
        assert "não prova que não dispararam" in frase, (
            "o resumo deixou de ressalvar que ausência na lista não é prova de "
            "que a tag não disparou"
        )
        assert "recorte" in frase, (
            "o resumo não diz mais que a linha do tempo é um recorte"
        )

    def test_o_pai_entrega_a_linha_do_tempo(self):
        """Sem a prop, o componente fica sem a única fonte de tempo real — e a
        tentação de estimar volta com ela."""
        fonte = _codigo(PAI)
        assert re.search(r"linhaDoTempo=\{storage\?\.firingTimeline\}", fonte), (
            "DeepAnalysisPanel parou de repassar storage.firingTimeline ao "
            "TagHealthMonitor"
        )


class TestOCasamentoPorFornecedorSeSustenta:
    """Se `tags[].name` e `firingTimeline[].owner` divergirem, nenhuma tag casa
    e a aba inteira passa a dizer "sem medição" sem que nada falhe."""

    @pytest.fixture(scope="class")
    def resposta(self):
        resultado = run_audit("https://loja.com.br", _Scan())
        return _normalize_audit_response("https://loja.com.br", "premium", _Scan(), resultado)

    def test_a_linha_do_tempo_chega_a_resposta(self, resposta):
        storage = resposta.get("storage")
        assert storage is not None, "storage não chegou à resposta"
        assert storage.get("firingTimeline"), (
            "nenhuma requisição na linha do tempo — sem ela não há tempo a exibir"
        )

    def test_cada_evento_traz_o_que_a_tela_usa(self, resposta):
        for evento in resposta["storage"]["firingTimeline"]:
            assert isinstance(evento.get("msSincePageStart"), int), (
                "evento sem medição numérica: o badge de tempo ficaria vazio"
            )
            assert evento.get("owner"), "sem dono, o evento não casa com tag nenhuma"
            assert evento.get("url"), "sem URL, o número exibido não é conferível"

    def test_ao_menos_uma_tag_casa_com_uma_requisicao(self, resposta):
        """Este é o teste que protege o casamento. O `_Scan` de teste dispara
        uma requisição para `google-analytics.com/g/collect`, e o GA4 está entre
        as tags detectadas: o nome do fornecedor precisa bater dos dois lados."""
        nomes = {t["name"] for t in resposta["tags"]}
        donos = {e["owner"] for e in resposta["storage"]["firingTimeline"]}
        assert nomes & donos, (
            "nenhum nome de tag bate com o dono de uma requisição observada: o "
            f"casamento por fornecedor quebrou. tags={sorted(nomes)} "
            f"donos={sorted(donos)}"
        )

    def test_o_ga4_casa_pelo_nome_exato(self, resposta):
        """Sem exigir o nome exato, o teste acima passaria com qualquer par
        coincidente — a igualdade literal é o que a tela usa."""
        donos = {e["owner"] for e in resposta["storage"]["firingTimeline"]}
        assert "Google Analytics 4" in donos
        assert "Google Analytics 4" in {t["name"] for t in resposta["tags"]}


class TestALinhaDoTempoEUmRecorte:
    """A premissa da ressalva exibida na aba.

    O motor guarda as 60 primeiras requisições de rastreio e conta
    `totalTimelineEvents` depois do corte — a tela não tem como saber quantas
    ficaram de fora. Enquanto for assim, "não casou com nenhuma requisição" só
    pode ser dito da lista, nunca da varredura.

    Se este teste falhar porque o corte deixou de existir, ou porque o total
    verdadeiro passou a viajar na resposta, o texto de
    `TagHealthMonitor.tsx` pode (e deve) ficar mais forte: aí dá para dizer se
    a lista está completa.
    """

    @pytest.fixture(scope="class")
    def resposta_com_excesso(self):
        class _Excesso(_Scan):
            # Meta Pixel declarado no HTML e com beacon próprio, disparado
            # depois de 70 requisições do GA4: prova de disparo que não cabe
            # no recorte.
            html = _Scan.html.replace(
                "</head>",
                '<script src="https://connect.facebook.net/en_US/fbevents.js"></script></head>',
            )
            intercepted_requests = [
                _Req(f"https://www.google-analytics.com/g/collect?v=2&n={i}", AGORA + 0.1 + i * 0.01)
                for i in range(70)
            ] + [_Req("https://www.facebook.com/tr?id=1234567890123456", AGORA + 5.0)]
            navigation_started_at = AGORA

        resultado = run_audit("https://loja.com.br", _Excesso())
        return _normalize_audit_response("https://loja.com.br", "premium", _Excesso(), resultado)

    def test_o_recorte_deixa_requisicao_provada_de_fora(self, resposta_com_excesso):
        linha = resposta_com_excesso["storage"]["firingTimeline"]
        assert len(linha) == 60, f"o recorte mudou de tamanho: {len(linha)}"
        donos = {e["owner"] for e in linha}
        assert "Meta Pixel (Facebook)" not in donos, (
            "o recorte deixou de cortar — reforce o texto da aba"
        )
        assert "Meta Pixel (Facebook)" in {t["name"] for t in resposta_com_excesso["tags"]}, (
            "sem a tag na lista o cenário não reproduz o defeito"
        )

    def test_o_total_verdadeiro_nao_chega_a_tela(self, resposta_com_excesso):
        """71 requisições observadas, 60 na lista, e o campo de total diz 60."""
        storage = resposta_com_excesso["storage"]
        assert storage["totalTimelineEvents"] == len(storage["firingTimeline"]), (
            "o total passou a ser maior que a lista: a tela agora consegue "
            "detectar o corte e o texto pode declarar quando a lista é completa"
        )


class TestAAmostraDoLaudoSustentaATela:
    """`/dev/laudo` é o único jeito de olhar essa aba sem login e sem cota. Se a
    amostra não tiver o campo, a conferência visual passa a olhar uma tela que o
    produto não produz."""

    @pytest.fixture(scope="class")
    def amostra(self):
        return json.loads(AMOSTRA.read_text(encoding="utf-8"))

    def test_a_amostra_traz_a_linha_do_tempo(self, amostra):
        assert amostra.get("storage", {}).get("firingTimeline"), (
            "a amostra de `/dev/laudo` perdeu a linha do tempo — regenere com "
            "scripts/gerar_amostra_do_laudo.py"
        )

    def test_a_amostra_tem_tag_com_medicao_e_tag_sem(self, amostra):
        """Os dois estados precisam aparecer na conferência visual: o do tempo
        medido e o do "sem medição", que é justamente o que antes era
        preenchido com número sorteado."""
        donos = {e["owner"] for e in amostra["storage"]["firingTimeline"]}
        nomes = {t["name"] for t in amostra["tags"]}
        assert nomes & donos, "nenhuma tag da amostra casa com a linha do tempo"
        assert nomes - donos, "nenhuma tag da amostra fica sem medição"
