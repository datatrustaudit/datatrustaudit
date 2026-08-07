"""Regressão: cookies, armazenamento local, ordem real de disparo e
rastreamento em domínio próprio.

Todo este arquivo se apoia num fato do scanner: **ele nunca clica em
"aceitar"**. Logo, cookie gravado, chave de storage escrita e requisição a
endpoint de rastreamento observados durante a visita aconteceram sem
consentimento. Isso é evidência direta — diferente de inferir ordem por
posição no HTML, que era tudo o que o motor fazia.
"""
import time

import pytest

from audit_engine.orchestrator import run_audit
from audit_engine.storage_auditor import auditar_armazenamento, auditar_ordem_do_consent_mode
from audit_engine.tag_detector import detect_tags, detectar_rastreamento_em_dominio_proprio


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
    scan_method = "browser"
    fallback_used = False
    all_script_urls = []

    def __init__(self, html="<html><head></head><body>x</body></html>",
                 requisicoes=None, cookies=None, local_storage=None):
        self.html = html
        self.intercepted_requests = requisicoes or []
        self.cookies = cookies or []
        self.local_storage = local_storage or {}
        self.session_storage = {}


class _Evento:
    """EventFinding mínimo — o detector de duplicatas só olha o nome."""
    def __init__(self, nome):
        self.name = nome


def _cookie(nome, dias=365, http_only=False):
    return {
        "name": nome,
        "domain": ".loja.com.br",
        "expires": time.time() + dias * 86400,
        "httpOnly": http_only,
    }


class TestCookiesSemConsentimento:
    """O produto se chama "Tag, Cookie and Consent Auditing" e não lia um
    cookie sequer — o scanner nem os capturava."""

    def test_cookies_de_rastreio_sao_apontados(self):
        scan = _Scan(cookies=[_cookie("_ga"), _cookie("_fbp"), _cookie("IDE", http_only=True)])
        r = auditar_armazenamento(scan, tem_cmp=False)
        nomes = {c.nome for c in r.cookies_sem_consentimento}
        assert nomes == {"_ga", "_fbp", "IDE"}
        assert all(c.severidade == "critical" for c in r.cookies_sem_consentimento)

    def test_cookie_funcional_nao_vira_falso_positivo(self):
        """Carrinho, sessão e preferência de idioma não exigem consentimento."""
        scan = _Scan(cookies=[_cookie("carrinho"), _cookie("PHPSESSID"), _cookie("idioma")])
        r = auditar_armazenamento(scan, tem_cmp=False)
        assert r.cookies_sem_consentimento == []

    def test_cookie_por_propriedade_do_ga4_e_reconhecido(self):
        scan = _Scan(cookies=[_cookie("_ga_ABC1234567")])
        r = auditar_armazenamento(scan, tem_cmp=False)
        assert len(r.cookies_sem_consentimento) == 1
        assert "Google Analytics" in r.cookies_sem_consentimento[0].dono

    def test_duracao_longa_e_sinalizada(self):
        scan = _Scan(cookies=[_cookie("_ga", dias=730)])
        r = auditar_armazenamento(scan, tem_cmp=False)
        achado = r.cookies_sem_consentimento[0]
        assert achado.duracao_dias > 700
        assert "Conserva" in achado.detalhe

    def test_httponly_e_registrado(self):
        """Cookie HttpOnly não aparece em document.cookie: só é visto porque a
        captura vem do contexto do navegador."""
        scan = _Scan(cookies=[_cookie("IDE", http_only=True)])
        r = auditar_armazenamento(scan, tem_cmp=False)
        assert r.cookies_sem_consentimento[0].http_only is True


class TestArmazenamentoLocal:
    def test_chaves_de_rastreio_sao_apontadas(self):
        scan = _Scan(local_storage={"amplitude_id_abc": "1", "ajs_user_id": "2", "tema": "escuro"})
        r = auditar_armazenamento(scan, tem_cmp=False)
        nomes = {s.nome for s in r.storage_sem_consentimento}
        assert nomes == {"amplitude_id_abc", "ajs_user_id"}, "tema do site não deveria ser apontado"

    def test_localstorage_e_critico_por_nao_expirar(self):
        scan = _Scan(local_storage={"amplitude_id_abc": "1"})
        r = auditar_armazenamento(scan, tem_cmp=False)
        assert r.storage_sem_consentimento[0].severidade == "critical"


class TestOrdemRealDeDisparo:
    """InterceptedRequest.timestamp era capturado e nunca usado."""

    def test_linha_do_tempo_em_milissegundos(self):
        scan = _Scan(requisicoes=[
            _Req("https://www.googletagmanager.com/gtag/js?id=G-ABC1234567", AGORA + 0.30),
            _Req("https://www.facebook.com/tr?id=123&ev=PageView", AGORA + 0.52),
            _Req("https://consent.cookiebot.com/uc.js", AGORA + 0.90),
        ])
        r = auditar_armazenamento(scan, tem_cmp=True)
        assert len(r.linha_do_tempo) == 3
        assert r.linha_do_tempo[0].ms_desde_o_inicio == 0
        assert r.linha_do_tempo[1].ms_desde_o_inicio == 220
        assert r.linha_do_tempo[2].ms_desde_o_inicio == 600

    def test_ordem_independe_da_ordem_de_captura(self):
        scan = _Scan(requisicoes=[
            _Req("https://www.facebook.com/tr?id=1&ev=PageView", AGORA + 0.90),
            _Req("https://www.googletagmanager.com/gtag/js?id=G-A", AGORA + 0.10),
        ])
        r = auditar_armazenamento(scan, tem_cmp=True)
        assert r.linha_do_tempo[0].ms_desde_o_inicio < r.linha_do_tempo[1].ms_desde_o_inicio

    def test_identifica_o_responsavel_por_evento(self):
        scan = _Scan(requisicoes=[_Req("https://www.facebook.com/tr?id=1&ev=PageView")])
        r = auditar_armazenamento(scan, tem_cmp=True)
        assert "Meta" in r.linha_do_tempo[0].dono


class TestOrdemDoConsentMode:
    """O motor checava se o Consent Mode existia, não se estava na ordem certa.
    Declarado depois do config, ele não protege nada."""

    def test_default_depois_do_config_e_apontado(self):
        html = """<script>gtag('config','G-ABC1234567');</script>
                  <script>gtag('consent','default',{ad_storage:'denied'});</script>"""
        problemas = auditar_ordem_do_consent_mode(html)
        assert any(p["check"] == "consent_default_after_config" for p in problemas)
        assert problemas[0]["status"] == "critical"

    def test_ordem_correta_nao_gera_alerta(self):
        html = """<script>gtag('consent','default',{ad_storage:'denied'});</script>
                  <script>gtag('config','G-ABC1234567');</script>"""
        assert auditar_ordem_do_consent_mode(html) == []

    def test_datalayer_depois_do_gtm_e_apontado(self):
        html = """<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script>
                  <script>dataLayer = [];</script>"""
        problemas = auditar_ordem_do_consent_mode(html)
        assert any(p["check"] == "datalayer_after_gtm" for p in problemas)


class TestDominioProprio:
    """GA4 server-side e o gateway da CAPI rodam em subdomínio do cliente,
    justamente para escapar de bloqueadores — e escapavam da auditoria."""

    def test_ga4_server_side_e_detectado(self):
        scan = _Scan(requisicoes=[
            _Req("https://metrics.loja.com.br/g/collect?v=2&tid=G-ABC1234567&en=page_view")
        ])
        achados = detectar_rastreamento_em_dominio_proprio(scan)
        assert any(a["vendor_id"] == "ga4" for a in achados)
        assert achados[0]["host"] == "metrics.loja.com.br"

    def test_meta_capi_gateway_e_detectado(self):
        scan = _Scan(requisicoes=[_Req("https://capig.loja.com.br/tr?id=1234567890123&ev=PageView")])
        achados = detectar_rastreamento_em_dominio_proprio(scan)
        assert any(a["vendor_id"] == "meta_pixel" for a in achados)

    def test_recurso_comum_nao_vira_falso_positivo(self):
        scan = _Scan(requisicoes=[
            _Req("https://cdn.loja.com.br/imagem.png"),
            _Req("https://loja.com.br/api/produtos?id=123"),
            _Req("https://loja.com.br/collect-emails"),
        ])
        assert detectar_rastreamento_em_dominio_proprio(scan) == []

    def test_host_oficial_nao_e_contado_duas_vezes(self):
        scan = _Scan(requisicoes=[
            _Req("https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567")
        ])
        assert detectar_rastreamento_em_dominio_proprio(scan) == []

    def test_aparece_na_lista_de_tags(self):
        scan = _Scan(requisicoes=[
            _Req("https://metrics.loja.com.br/g/collect?v=2&tid=G-ABC1234567&en=page_view")
        ])
        tags = detect_tags(scan.html, scan=scan)
        assert any("domínio próprio" in t.name for t in tags)


class TestIntegracaoNoLaudo:
    def test_cookies_viram_violacao(self):
        scan = _Scan(
            html="<html><head><script async src='https://www.googletagmanager.com/gtag/js?id=G-ABC1234567'></script></head><body>x</body></html>",
            cookies=[_cookie("_ga"), _cookie("_fbp")],
        )
        r = run_audit("https://loja.com.br", scan)
        assert r.storage is not None
        assert len(r.storage.cookies_sem_consentimento) == 2
        textos = " ".join(v.violation for v in r.privacy.violations)
        assert "_ga" in textos, "cookie sem consentimento não chegou ao laudo"

    def test_ordem_do_consent_mode_vira_violacao(self):
        html = """<html><head>
            <script id="Cookiebot" src="https://consent.cookiebot.com/uc.js"></script>
            <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
            <script>gtag('config','G-ABC1234567');</script>
            <script>gtag('consent','default',{ad_storage:'denied'});</script>
            </head><body>x</body></html>"""
        r = run_audit("https://loja.com.br", _Scan(html=html))
        assert any(p["check"] == "consent_default_after_config" for p in r.storage.problemas_de_ordem)
        textos = " ".join(v.violation for v in r.privacy.violations)
        assert "Consent Mode" in textos


class TestFalsoPositivoDeDuplicata:
    """Evento que dispara várias vezes por design não é duplicata.

    scrollDepth dispara a 25/50/75/100%, click dispara a cada clique. Reportar
    isso como problema enche o laudo de alarme falso — e laudo com alarme falso
    faz o cliente duvidar dos achados verdadeiros.
    """

    def test_scroll_depth_repetido_nao_e_duplicata(self):
        from audit_engine.duplicate_detector import detect_duplicates

        eventos = [_Evento("gtm.scrollDepth") for _ in range(6)]
        achados = detect_duplicates("<html></html>", [], eventos)
        assert not any(a.name == "gtm.scrollDepth" for a in achados)

    @pytest.mark.parametrize("nome", ["gtm.click", "gtm.timer", "scroll", "user_engagement"])
    def test_outros_eventos_repetidos_por_design(self, nome):
        from audit_engine.duplicate_detector import detect_duplicates

        achados = detect_duplicates("<html></html>", [], [_Evento(nome), _Evento(nome)])
        assert not any(a.name == nome for a in achados)

    def test_purchase_duplicado_continua_sendo_critico(self):
        """Este sim é problema real: infla conversão e distorce faturamento."""
        from audit_engine.duplicate_detector import detect_duplicates

        achados = detect_duplicates("<html></html>", [], [_Evento("purchase"), _Evento("purchase")])
        purchase = [a for a in achados if a.name == "purchase"]
        assert purchase, "purchase duplicado deveria ser apontado"
        assert purchase[0].severity == "critical"

    def test_evento_comum_duplicado_continua_sendo_apontado(self):
        from audit_engine.duplicate_detector import detect_duplicates

        achados = detect_duplicates("<html></html>", [], [_Evento("page_view"), _Evento("page_view")])
        assert any(a.name == "page_view" for a in achados)
