"""Regressão do defeito mais caro que este produto já teve: três respostas
para o mesmo site.

O scan Rápido reprovava terra.com.br com 22 achados; o Deep, no mesmo site,
acusava menos; e a aba Tempo Real exibia "100% conforme". Nenhum teste pegava
isso, porque cada caminho era testado contra si mesmo — e todos passavam.

A causa era arquitetural: `/api/audit` usa o `audit_engine` (Playwright, rede
interceptada, cookie real, teste do botão "Recusar"), enquanto `/deep-analyze`
e `/analyze` usavam `generate_audit_report`, o motor legado do `main.py`, que
infere consentimento por posição no HTML. Posição não prova bloqueio.

O que estes testes garantem é a propriedade que faltava: existe um caminho só
para auditar uma página, e todo modo do produto passa por ele.
"""
import asyncio
import os
import time

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

import api.audit as api_audit
from api.audit import auditar_pagina


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


class _ScanFalso:
    """Página com GA4, Meta Pixel e Clarity, sem nenhum controle de consentimento."""
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
        "</head><body>"
        '<a href="/produtos">Produtos</a><a href="/contato">Contato</a>'
        "</body></html>"
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


@pytest.fixture
def sem_navegador(monkeypatch):
    """Troca o Playwright por um scan fixo — o alvo aqui é o motor, não a rede."""
    monkeypatch.setattr(api_audit, "browser_scan", lambda url, timeout: _ScanFalso())
    return _ScanFalso


def _auditar(url="https://loja.com.br", plano="premium"):
    return asyncio.run(auditar_pagina(url, plano))


class TestFonteUnica:
    def test_auditar_pagina_devolve_o_formato_da_api(self, sem_navegador):
        """O Deep consome esta função; o formato precisa ser o mesmo do Rápido."""
        r = _auditar()
        for chave in ("success", "score", "summary", "tags", "privacy", "violations", "storage"):
            assert chave in r, f"chave {chave} ausente — o Deep leria vazio"

    def test_encontra_as_nao_conformidades(self, sem_navegador):
        """Site sem CMP e com três rastreadores não pode sair limpo.

        É exatamente o cenário em que a aba Tempo Real dizia "100% conforme".
        """
        r = _auditar()
        assert r["summary"]["violationsCount"] > 0, (
            "site sem controle de consentimento e com GA4/Meta/Clarity saiu sem achado"
        )
        assert r["privacy"]["hasConsentTool"] is False

    def test_contagem_por_gravidade_acompanha_o_total(self, sem_navegador):
        r = _auditar()
        gravidade = r["summary"]["violationsBySeverity"]
        assert sum(gravidade.values()) == r["summary"]["violationsCount"]

    def test_free_e_premium_veem_o_mesmo_total(self, sem_navegador):
        """O plano corta o detalhe, nunca o número. Contar pela lista cortada
        foi o que zerou o gráfico de gravidade no free."""
        free = _auditar(plano="free")
        premium = _auditar(plano="premium")
        assert free["summary"]["violationsCount"] == premium["summary"]["violationsCount"]
        assert len(free["tags"]) <= len(premium["tags"])

    def test_objetos_internos_nao_vazam_para_a_resposta(self, sem_navegador):
        """`_scan` é objeto de Playwright: se escapar, o JSONResponse estoura."""
        r = _auditar()
        assert "_audit_result" in r and "_scan" in r, "quem chama precisa desses"
        from fastapi.encoders import jsonable_encoder

        limpo = {k: v for k, v in r.items() if not k.startswith("_")}
        jsonable_encoder(limpo)  # levanta se algo não for serializável

    def test_pagina_sem_html_e_falha_e_nao_site_limpo(self, monkeypatch):
        """Falso negativo é o erro caro: página vazia com score alto vira
        'conforme' num laudo."""
        class _Vazio(_ScanFalso):
            html = ""
            scan_status = "blocked"
            intercepted_requests = []
            cookies = []

        monkeypatch.setattr(api_audit, "browser_scan", lambda url, timeout: _Vazio())
        r = _auditar()
        assert r["success"] is False
        assert r["errorCode"] == "BLOCKED"

    def test_falha_do_navegador_nao_levanta(self, monkeypatch):
        """Uma página ruim não pode derrubar a varredura das outras."""
        def _explode(url, timeout):
            raise RuntimeError("net::ERR_CONNECTION_REFUSED")

        monkeypatch.setattr(api_audit, "browser_scan", _explode)
        r = _auditar()
        assert r["success"] is False
        assert r["errorCode"] == "FETCH_FAILED"


class TestConsolidacaoDoDeep:
    """A soma do Deep precisa bater com o que cada página relatou.

    A versão anterior somava `privacy.totalViolations`, chave do motor legado.
    Com as páginas vindo de `auditar_pagina`, ler a chave errada devolveria
    zero — e o Deep mostraria "0 violações" para um site reprovado.
    """

    def _consolida(self, paginas):
        def violacoes(r):
            summary = r.get("summary") or {}
            if summary.get("violationsCount") is not None:
                return int(summary["violationsCount"])
            privacy = r.get("privacy") or {}
            return int(privacy.get("totalViolations") or len(privacy.get("violations") or []))

        gravidade = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for r in paginas:
            for nivel, q in ((r.get("summary") or {}).get("violationsBySeverity") or {}).items():
                if nivel in gravidade:
                    gravidade[nivel] += int(q or 0)
        return sum(violacoes(r) for r in paginas), gravidade

    def test_soma_das_paginas_bate_com_o_total(self, sem_navegador):
        paginas = [_auditar(), _auditar("https://loja.com.br/produtos")]
        total, gravidade = self._consolida(paginas)
        assert total == sum(p["summary"]["violationsCount"] for p in paginas)
        assert sum(gravidade.values()) == total

    def test_deep_nao_reporta_menos_que_uma_pagina(self, sem_navegador):
        """O modo mais caro do produto era o que menos enxergava."""
        uma = _auditar()
        total, _ = self._consolida([uma, _auditar("https://loja.com.br/contato")])
        assert total >= uma["summary"]["violationsCount"]

    def test_pagina_que_falhou_nao_conta_como_limpa(self, sem_navegador):
        """Página fora do ar entra em `pagesFailed`, não como zero achados —
        senão ela puxa a média do site para cima."""
        boas = [_auditar()]
        total, _ = self._consolida(boas)
        assert total == boas[0]["summary"]["violationsCount"]


class TestPorQueTrocamosDeMotor:
    """Registro executável da diferença que justificou a migração.

    Medido no mesmo HTML, sem rede: o legado encontra 6 não conformidades e
    score 18; o `audit_engine` encontra 8, score 42, e ainda enumera os 4
    cookies gravados sem consentimento — que o legado não enxerga, porque não
    lê `context.cookies()`.

    Note que os scores divergem no sentido oposto ao das violações: são escalas
    diferentes. Era impossível para o cliente conciliar os dois números.
    """

    def _legado(self):
        from main import generate_audit_report

        return generate_audit_report({
            "html": _ScanFalso.html,
            "url": "https://loja.com.br",
            "scripts": [],
            "error": None,
            "cookies": _ScanFalso.cookies,
        })

    def test_o_motor_novo_nunca_enxerga_menos(self, sem_navegador):
        legado = (self._legado().get("privacy") or {}).get("totalViolations") or 0
        novo = _auditar()["summary"]["violationsCount"]
        assert novo >= legado, (
            f"regressão: o audit_engine achou {novo} onde o motor legado achava "
            f"{legado}. O modo Deep já foi o que menos enxergava — não pode voltar a ser."
        )

    def test_so_o_motor_novo_prova_cookie_sem_consentimento(self, sem_navegador):
        """Cookie gravado antes de qualquer aceite é evidência direta.

        O legado inferia consentimento por posição no HTML — e posição não
        prova bloqueio: um CMP declarado antes das tags não garante que ele
        bloqueie coisa alguma.
        """
        storage = _auditar().get("storage") or {}
        assert storage.get("cookiesWithoutConsent"), (
            "sem a lista de cookies, o laudo volta a depender de inferência por posição"
        )
