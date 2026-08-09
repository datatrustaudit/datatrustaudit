"""O contrato entre a API e as três saídas do laudo.

O laudo passou a ter três leituras do mesmo dado — resumo para quem decide,
jurídica para quem responde, técnica para quem corrige. Cada uma lê campos
diferentes da mesma resposta.

Este arquivo existe porque o modo de falha aqui é silencioso e já aconteceu
três vezes neste projeto: o motor calcula, a API expõe, e alguma camada no
meio não repassa. Ninguém vê exceção; o número simplesmente aparece como zero,
e zero num laudo lê como "está tudo certo".

Foi assim que `violationsBySeverity` ficou de fora do normalizador do
frontend — o gráfico de gravidade nascia vazio ao lado do contador cheio — e
foi assim que a aba Tempo Real chegou a afirmar "100% conforme" lendo uma
chave que não existia.
"""
import time

import pytest

from api.audit import _normalize_audit_response
from audit_engine.orchestrator import run_audit


AGORA = 1_700_000_000.0


class _Req:
    def __init__(self, url, timestamp=AGORA):
        self.url = url
        self.timestamp = timestamp
        self.method = "GET"
        self.domain = ""
        self.path = ""
        self.post_data = None
        self.resource_type = "script"


class _Scan:
    """Loja sem controle de consentimento, com três rastreadores."""
    scan_method = "browser"
    scan_status = "completed"
    fallback_used = False
    all_script_urls = []
    error = None
    html = (
        "<html><head>"
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>'
        "<script>fbq('init','1234567890123456');</script>"
        '<script src="https://www.clarity.ms/tag/abcdefghij"></script>'
        "</head><body>loja</body></html>"
    )
    intercepted_requests = [
        _Req("https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567", AGORA + 0.35)
    ]
    cookies = [
        {"name": n, "domain": ".loja.com.br", "expires": time.time() + 3e7, "httpOnly": False}
        for n in ("_ga", "_fbp", "IDE", "_clck")
    ]
    local_storage = {}
    session_storage = {}


@pytest.fixture(scope="module")
def resposta():
    resultado = run_audit("https://loja.com.br", _Scan())
    return _normalize_audit_response("https://loja.com.br", "premium", _Scan(), resultado)


class TestVisaoExecutiva:
    """Veredito, evidência observada e por onde começar."""

    def test_tem_o_total_e_a_quebra_por_gravidade(self, resposta):
        """O veredito é montado a partir de quantas são críticas e altas."""
        summary = resposta["summary"]
        assert summary.get("violationsCount") is not None
        gravidade = summary.get("violationsBySeverity")
        assert gravidade is not None, "sem isso o veredito não sabe se é crítico ou menor"
        assert set(gravidade) == {"critical", "high", "medium", "low"}

    def test_evidencia_de_cookie_chega(self, resposta):
        """"8 cookies gravados antes de qualquer aceite" é a frase que vende
        o laudo — e ela vem de storage, não da lista de violações."""
        storage = resposta.get("storage")
        assert storage is not None, "storage não chegou à resposta"
        assert storage.get("cookiesWithoutConsent"), "nenhum cookie listado num site sem CMP"

    def test_tag_antes_do_consentimento_e_marcada(self, resposta):
        """`is_before_consent` já ficou False para todo site — o laudo
        respondia "Não" à coluna mais importante do relatório."""
        tags = resposta["tags"]
        assert tags, "cenário deveria detectar tags"
        assert any(t.get("isBeforeConsent") for t in tags), (
            "site sem CMP e com GA4 disparando: alguma tag tem de estar marcada"
        )

    def test_exposicao_legal_esta_presente(self, resposta):
        assert resposta["privacy"].get("estimatedRiskExposure")

    def test_tem_recomendacoes_para_o_proximo_passo(self, resposta):
        """A seção "por onde começar" fica vazia sem isto."""
        assert resposta.get("recommendations") is not None


class TestVisaoJuridica:
    """Base legal, cadeia de evidência e providência."""

    def test_violacoes_citam_dispositivo_legal(self, resposta):
        """A visão agrupa por artigo: sem `article`, tudo cai num balaio só."""
        violacoes = resposta["privacy"]["violations"]
        assert violacoes, "cenário deveria produzir violações"
        com_artigo = [v for v in violacoes if v.get("article")]
        assert com_artigo, "nenhuma violação informou o dispositivo da LGPD"

    def test_violacoes_trazem_providencia(self, resposta):
        violacoes = resposta["privacy"]["violations"]
        assert any(v.get("recommendation") for v in violacoes), (
            "sem recomendação, a visão jurídica aponta o problema e para aí"
        )

    def test_identificacao_da_varredura_esta_completa(self, resposta):
        """Laudo sem método e sem regime aplicável não se sustenta como peça."""
        assert resposta.get("scanMethod"), "método da varredura ausente"
        privacy = resposta["privacy"]
        assert privacy.get("jurisdiction") or privacy.get("framework")

    def test_cmp_ausente_e_afirmado_e_nao_omitido(self, resposta):
        """A ausência de controle é o achado mais grave que existe: precisa
        ser um valor explícito, não a falta de um campo."""
        assert resposta["privacy"].get("hasConsentTool") is False


class TestOsNumerosNaoDivergem:
    """As três visões leem da mesma fonte — se divergirem, é bug de leitura."""

    def test_total_bate_entre_summary_e_privacy(self, resposta):
        assert resposta["summary"]["violationsCount"] == resposta["privacy"]["totalViolations"]

    def test_quebra_por_gravidade_soma_o_total(self, resposta):
        gravidade = resposta["summary"]["violationsBySeverity"]
        assert sum(gravidade.values()) == resposta["summary"]["violationsCount"]

    def test_cmp_diz_o_mesmo_em_todo_lugar(self, resposta):
        """`summary.consentDetected` e `privacy.hasConsentTool` descrevem a
        mesma coisa; divergir entre eles é como o laudo passa a se contradizer
        de uma seção para a outra."""
        assert resposta["summary"]["consentDetected"] == resposta["privacy"]["hasConsentTool"]

    def test_free_ve_menos_detalhe_mas_o_mesmo_total(self):
        """O corte por plano esconde o detalhe, nunca o número — mostrar 2 de
        22 e dizer que são 22 é o que motiva o upgrade."""
        resultado = run_audit("https://loja.com.br", _Scan())
        free = _normalize_audit_response("https://loja.com.br", "free", _Scan(), resultado)
        premium = _normalize_audit_response("https://loja.com.br", "premium", _Scan(), resultado)

        assert free["summary"]["violationsCount"] == premium["summary"]["violationsCount"]
        assert free["summary"]["violationsBySeverity"] == premium["summary"]["violationsBySeverity"]
        assert len(free["tags"]) <= len(premium["tags"])
