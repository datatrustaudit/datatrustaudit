"""Regressão do que a resposta de /api/audit entrega à tela.

Vários problemas do laudo nasceram aqui: campo que o motor calcula e a API não
expõe, agregado que some junto com o detalhe no corte por plano, chave em
formato diferente do que o frontend lê. Nenhum deles aparece nos testes do
motor — só na tela, tarde demais.
"""
import time

import pytest

from api.audit import _normalize_audit_response, _storage_para_o_plano
from audit_engine.orchestrator import run_audit


AGORA = 1_700_000_000.0
NIVEIS = ("critical", "high", "medium", "low")


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
    scan_method = "browser"
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
def resultado():
    return run_audit("https://loja.com.br", _Scan())


def _resposta(resultado, plano):
    return _normalize_audit_response("https://loja.com.br", plano, _Scan(), resultado)


class TestGraficoDeSeveridade:
    """O painel mostrava '23 violações' ao lado de um gráfico vazio."""

    def test_severidades_usam_os_valores_que_a_tela_espera(self, resultado):
        violacoes = resultado.privacy.violations
        assert violacoes, "cenário de teste deveria produzir violações"
        fora = {v.severity for v in violacoes if v.severity not in NIVEIS}
        assert not fora, f"severidade fora do vocabulário da tela: {fora}"

    def test_contagem_por_gravidade_e_exposta(self, resultado):
        resposta = _resposta(resultado, "premium")
        contagem = resposta["summary"].get("violationsBySeverity")
        assert contagem is not None, "sem agregado, o gráfico não tem o que desenhar"
        assert set(contagem) == set(NIVEIS)

    def test_contagem_bate_com_o_total(self, resultado):
        resposta = _resposta(resultado, "premium")
        contagem = resposta["summary"]["violationsBySeverity"]
        assert sum(contagem.values()) == resposta["summary"]["violationsCount"]

    def test_agregado_sobrevive_ao_plano_free(self, resultado):
        """O corte esconde o detalhe de cada violação, não quantas existem."""
        resposta = _resposta(resultado, "free")
        contagem = resposta["summary"]["violationsBySeverity"]
        assert sum(contagem.values()) > 0, (
            "no plano free o gráfico de severidade ficava zerado enquanto o "
            "contador mostrava o total"
        )


class TestCamposQueASomeSumiam:
    def test_storage_chega_a_resposta(self, resultado):
        """Cookies, ordem de disparo e guias existiam no motor e não eram expostos."""
        resposta = _resposta(resultado, "premium")
        assert resposta.get("storage") is not None
        assert resposta["storage"]["cookiesWithoutConsent"], "cookies não chegaram à tela"

    def test_exposicao_nao_inventa_valor_em_dolar(self, resultado):
        """O laudo exibia 'USD $40,800' num relatório de LGPD.

        Cifrão sozinho não serve de critério: "R$ 50 milhões" é exatamente o
        que se espera num laudo brasileiro. O que não pode aparecer é dólar.
        """
        texto = resultado.privacy.estimated_risk_exposure or ""
        assert "USD" not in texto, f"exposição em dólar num laudo de LGPD: {texto}"
        assert "US$" not in texto
        assert "art. 52" in texto.lower() or "nenhum indicador" in texto.lower()

    def test_exposicao_cita_o_criterio_e_nao_um_valor_pronto(self, resultado):
        """A LGPD não tem tabela por tipo de violação — tem percentual do faturamento."""
        texto = resultado.privacy.estimated_risk_exposure or ""
        if "art. 52" in texto.lower():
            assert "2%" in texto and "faturamento" in texto.lower()

    def test_notas_de_qualidade_em_portugues(self, resultado):
        """O bloco inteiro saía em inglês na tela."""
        notas = resultado.data_quality_notes or []
        assert notas
        texto = " ".join(n.limitation + " " + n.reason for n in notas)
        for termo_ingles in ("Single-page browser scan", "not observable", "legal conclusions"):
            assert termo_ingles not in texto


class TestCorteDeStoragePorPlano:
    def test_free_recebe_menos_cookies_que_premium(self, resultado):
        completo = _storage_para_o_plano(_resposta(resultado, "premium")["storage"], "premium")
        limitado = _storage_para_o_plano(_resposta(resultado, "free")["storage"], "free")
        assert len(limitado["cookiesWithoutConsent"]) <= len(completo["cookiesWithoutConsent"])

    def test_free_sempre_sabe_o_total_real(self, resultado):
        """Mostrar 2 de 4 e dizer que são 4 é o que motiva o upgrade."""
        limitado = _storage_para_o_plano(_resposta(resultado, "free")["storage"], "free")
        assert limitado["totalCookiesWithoutConsent"] >= len(limitado["cookiesWithoutConsent"])

    def test_guia_de_correcao_e_beneficio_do_plano_pago(self, resultado):
        limitado = _storage_para_o_plano(_resposta(resultado, "free")["storage"], "free")
        assert limitado["guidesLocked"] is True
        completo = _storage_para_o_plano(_resposta(resultado, "premium")["storage"], "premium")
        assert completo["guidesLocked"] is False
