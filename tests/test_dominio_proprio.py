"""Rastreamento montado para não ser visto.

Server-side tagging (sGTM hospedado, do tipo que Stape e concorrentes vendem)
é o ponto cego mais caro que sobrou: o script não aparece no HTML, o cookie é
first-party, e o dado sai do servidor do cliente para Meta e Google sem o
visitante ver. Auditar sem enxergar isso entrega um laudo que diz "nenhum
rastreador de terceiro" para um site que manda tudo pela porta dos fundos.

São três assinaturas, em ordem de força:

1. O container servido do próprio domínio (`/gtm.js?id=GTM-…`) — direto.
2. O beacon com o protocolo do fornecedor em host do cliente (`/g/collect`).
3. O cookie que só o servidor grava (`FPID`) — o único que sobra quando o
   carregador usa caminho aleatório justamente para não casar com padrão.

O risco aqui é o falso positivo. Server-side é técnica legítima, e acusar um
site que só tem um arquivo chamado `gtm.js` no CDN queima o laudo inteiro.
"""
import pytest

from audit_engine.tag_detector import (
    detect_tags,
    detectar_cookies_de_servidor,
    detectar_rastreamento_em_dominio_proprio,
)


class _Req:
    def __init__(self, url):
        self.url = url
        self.timestamp = 1_700_000_000.0
        self.method = "GET"
        self.domain = ""
        self.path = ""
        self.post_data = None
        self.resource_type = "script"


class _Scan:
    scan_method = "browser"
    scan_status = "completed"
    fallback_used = False
    all_script_urls = []
    error = None
    html = "<html><head></head><body>loja</body></html>"
    local_storage = {}
    session_storage = {}
    intercepted_requests = []
    cookies = []


def scan(urls=(), cookies=(), html=None):
    class S(_Scan):
        pass
    S.intercepted_requests = [_Req(u) for u in urls]
    S.cookies = [{"name": n, "domain": ".loja.com.br", "httpOnly": True} for n in cookies]
    if html is not None:
        S.html = html
    return S()


class TestContainerEmDominioProprio:
    def test_gtm_servido_do_proprio_site_e_detectado(self):
        achados = detectar_rastreamento_em_dominio_proprio(
            scan(["https://gtm.loja.com.br/gtm.js?id=GTM-ABC1234"])
        )
        assert achados, "container sGTM em domínio próprio passou despercebido"
        assert achados[0]["vendor_id"] == "gtm"
        assert achados[0]["host"] == "gtm.loja.com.br"

    def test_carregador_do_gtag_em_dominio_proprio(self):
        achados = detectar_rastreamento_em_dominio_proprio(
            scan(["https://sst.loja.com.br/gtag/js?id=G-ABC1234567"])
        )
        assert achados and achados[0]["vendor_id"] == "ga4"

    def test_host_oficial_nao_vira_achado_de_dominio_proprio(self):
        """O caminho normal já detecta isso; contar duas vezes vira duplicata."""
        achados = detectar_rastreamento_em_dominio_proprio(
            scan(["https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"])
        )
        assert achados == []


class TestBeaconEmDominioProprio:
    def test_ga4_collect_em_host_do_cliente(self):
        achados = detectar_rastreamento_em_dominio_proprio(
            scan(["https://data.loja.com.br/g/collect?v=2&tid=G-ABC1234567&en=page_view"])
        )
        assert achados and achados[0]["vendor_id"] == "ga4"

    def test_variante_j_collect(self):
        """Versões do sGTM usam /j/collect além de /g/ e /mp/."""
        achados = detectar_rastreamento_em_dominio_proprio(
            scan(["https://data.loja.com.br/j/collect?v=2&tid=G-ABC1234567"])
        )
        assert achados

    def test_capi_gateway_da_meta(self):
        achados = detectar_rastreamento_em_dominio_proprio(
            scan(["https://capi.loja.com.br/tr?id=1234567890123&ev=PageView"])
        )
        assert achados and achados[0]["vendor_id"] == "meta_pixel"

    def test_mesmo_host_nao_repete_o_achado(self):
        achados = detectar_rastreamento_em_dominio_proprio(scan([
            "https://data.loja.com.br/g/collect?v=2&tid=G-ABC1234567&en=page_view",
            "https://data.loja.com.br/g/collect?v=2&tid=G-ABC1234567&en=scroll",
        ]))
        assert len(achados) == 1


class TestFalsoPositivo:
    """Acusar site limpo queima o laudo inteiro — pior que deixar passar."""

    def test_arquivo_chamado_gtm_js_sem_id_de_container(self):
        """Um `gtm.js` qualquer no CDN não é um container servido."""
        assert detectar_rastreamento_em_dominio_proprio(
            scan(["https://cdn.loja.com.br/js/gtm.js"])
        ) == []

    def test_collect_generico_sem_protocolo_do_ga4(self):
        """Endpoint interno chamado /collect é comum e não é GA4."""
        assert detectar_rastreamento_em_dominio_proprio(
            scan(["https://api.loja.com.br/g/collect?pedido=123"])
        ) == []

    def test_tr_sem_assinatura_da_meta(self):
        """`/tr` casa com rota de tracking interno; sem id e ev não é Meta."""
        assert detectar_rastreamento_em_dominio_proprio(
            scan(["https://loja.com.br/tr?produto=42"])
        ) == []

    def test_tid_de_universal_analytics_nao_casa(self):
        """UA-XXXX não é GA4; a exigência de `tid=G-` evita confundir."""
        assert detectar_rastreamento_em_dominio_proprio(
            scan(["https://data.loja.com.br/g/collect?v=1&tid=UA-12345-1"])
        ) == []

    def test_sem_requisicao_alguma(self):
        assert detectar_rastreamento_em_dominio_proprio(scan()) == []


class TestCookieDeServidor:
    """A única assinatura que sobra quando o carregador usa caminho aleatório."""

    def test_fpid_e_reconhecido(self):
        achados = detectar_cookies_de_servidor(scan(cookies=["FPID"]))
        assert achados and achados[0]["nome"] == "FPID"
        assert "servidor" in achados[0]["descricao"].lower()

    def test_cookie_comum_do_ga_nao_conta(self):
        """`_ga` é escrito pelo JavaScript: não prova server-side."""
        assert detectar_cookies_de_servidor(scan(cookies=["_ga", "_gid", "_fbp"])) == []

    def test_varios_cookies_de_servidor(self):
        achados = detectar_cookies_de_servidor(scan(cookies=["FPID", "FPLC", "_ga"]))
        assert {a["nome"] for a in achados} == {"FPID", "FPLC"}

    def test_cookie_malformado_nao_quebra(self):
        class S(_Scan):
            cookies = [None, "texto solto", {"sem_nome": 1}, {"name": "FPID"}]
        achados = detectar_cookies_de_servidor(S())
        assert [a["nome"] for a in achados] == ["FPID"]


class TestChegaAoLaudo:
    def test_cookie_de_servidor_vira_tag_no_laudo(self):
        """Sem requisição reconhecível, o cookie é a única prova — e precisa
        aparecer no laudo, não só existir no detector."""
        tags = detect_tags(_Scan.html, scan(cookies=["FPID", "FPLC"]))
        sgtm = [t for t in tags if t.id == "sgtm_first_party"]
        assert sgtm, "tagueamento server-side não chegou à lista de tags"
        assert "FPID" in (sgtm[0].matched_pattern or "")

    def test_container_detectado_nao_duplica_com_o_cookie(self):
        """Com as duas evidências, é uma instalação só.

        `occurrence_count` conta instalações: somar as duas provas do mesmo
        sGTM faria o laudo acusar duplicata inexistente.
        """
        s = scan(
            urls=["https://gtm.loja.com.br/gtm.js?id=GTM-ABC1234"],
            cookies=["FPID"],
        )
        tags = detect_tags(_Scan.html, s)
        ids = [t.id for t in tags]
        assert ids.count("sgtm_first_party") == 0, "criou tag separada tendo container detectado"
        assert "gtm" in ids

    def test_site_sem_server_side_nao_ganha_achado(self):
        tags = detect_tags(_Scan.html, scan(cookies=["_ga"]))
        assert [t for t in tags if t.id == "sgtm_first_party"] == []
