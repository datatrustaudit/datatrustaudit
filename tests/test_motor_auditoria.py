"""Regressão do motor de auditoria — os defeitos que produziam laudo errado.

Falso positivo (acusar problema inexistente) e falso negativo (atestar conforme
um site irregular) são os dois piores erros deste produto: o primeiro destrói a
confiança no relatório, o segundo é o risco que o cliente está pagando para não
correr.
"""
import pytest

from audit_engine.orchestrator import run_audit
from audit_engine.tag_detector import detect_tags


GA4_UMA_INSTALACAO = (
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>'
    '<script>gtag("config","G-ABC1234567");</script>'
)
GA4_DUAS_PROPRIEDADES = GA4_UMA_INSTALACAO + (
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZZZ9999999"></script>'
    '<script>gtag("config","G-ZZZ9999999");</script>'
)

TAGS_DE_RASTREIO = """
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<script>gtag('config','G-ABC1234567');</script>
<script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','1234567890123456');</script>
<script src="https://www.clarity.ms/tag/abcdefghij"></script>
"""
COM_CMP = f'<html><head><script id="Cookiebot" src="https://consent.cookiebot.com/uc.js"></script>{TAGS_DE_RASTREIO}</head><body>x</body></html>'
SEM_CMP = f"<html><head>{TAGS_DE_RASTREIO}</head><body>x</body></html>"


class _Requisicao:
    def __init__(self, url):
        self.url = url
        self.method = "GET"
        self.domain = ""
        self.path = ""
        self.post_data = None
        self.resource_type = "script"


class _ScanComDisparo:
    """CMP presente na página, mas os rastreadores dispararam mesmo assim."""
    scan_method = "browser"
    fallback_used = False
    all_script_urls = []

    def __init__(self, html):
        self.html = html
        self.intercepted_requests = [
            _Requisicao("https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567"),
            _Requisicao("https://www.facebook.com/tr?id=1234567890123456&ev=PageView"),
        ]


class TestContagemDeDuplicatas:
    """O contador somava os três níveis de detecção: o mesmo script contado por
    URL, por padrão no código e por requisição de rede. Uma instalação correta
    virava occurrence_count=2 e o produto acusava "GA4 duplicado, consolide"."""

    def _ga4(self, html):
        tags = detect_tags(f"<html><head>{html}</head><body>x</body></html>")
        return next((t for t in tags if t.id == "ga4"), None)

    def test_uma_instalacao_conta_uma(self):
        assert self._ga4(GA4_UMA_INSTALACAO).occurrence_count == 1

    def test_site_correto_nao_recebe_acusacao_de_duplicata(self):
        r = run_audit("https://exemplo.com.br", f"<html><head>{GA4_UMA_INSTALACAO}</head><body>x</body></html>")
        assert len(r.duplicates) == 0, f"acusou duplicata inexistente: {r.duplicates}"

    def test_duas_propriedades_distintas_sao_duplicata_real(self):
        assert self._ga4(GA4_DUAS_PROPRIEDADES).occurrence_count == 2

    def test_mesmo_snippet_colado_duas_vezes_e_duplicata_real(self):
        """Carrega a tag duas vezes de verdade — inflando pageviews no GA4."""
        assert self._ga4(GA4_UMA_INSTALACAO + GA4_UMA_INSTALACAO).occurrence_count == 2


class TestTagsSemConsentimento:
    """A função devolvia lista vazia quando não havia CMP — ou seja, zero tags
    apontadas justamente no pior caso jurídico."""

    def test_sem_cmp_todo_rastreador_e_listado(self):
        r = run_audit("https://exemplo.com.br", SEM_CMP)
        assert r.privacy.has_consent_tool is False
        assert len(r.consent.tags_before_consent) >= 3, \
            f"sem CMP deveria apontar todos os rastreadores, apontou {r.consent.tags_before_consent}"

    def test_sem_cmp_marca_o_flag_em_cada_tag(self):
        """isBeforeConsent alimenta a coluna do Excel, a linha do PDF e o
        Dashboard. Nunca era escrito: o laudo respondia "Não" para todo mundo."""
        r = run_audit("https://exemplo.com.br", SEM_CMP)
        rastreadores = [t for t in r.tags if t.type in ("analytics", "advertising", "heatmap", "marketing")]
        assert rastreadores, "nenhum rastreador detectado no fixture"
        assert all(t.is_before_consent for t in rastreadores), \
            "flag is_before_consent não marcado — o relatório sairia dizendo 'Não'"

    def test_sem_cmp_gera_violacao_por_rastreador(self):
        r = run_audit("https://exemplo.com.br", SEM_CMP)
        assert r.privacy.total_violations >= 3


class TestCMPQueNaoBloqueia:
    """Bastava o script do CMP aparecer antes das tags para o laudo sair limpo.
    Posição no HTML não prova bloqueio — o banner pode carregar primeiro e não
    bloquear nada."""

    def test_cmp_sem_disparo_observado_fica_limpo(self):
        r = run_audit("https://exemplo.com.br", COM_CMP)
        assert r.privacy.has_consent_tool is True
        assert len(r.consent.tags_before_consent) == 0

    def test_cmp_com_disparo_observado_gera_violacao(self):
        """O scanner nunca clica em aceitar: requisição a endpoint de rastreio
        durante a visita é prova de disparo sem consentimento."""
        r = run_audit("https://exemplo.com.br", _ScanComDisparo(COM_CMP))
        assert len(r.consent.tags_before_consent) >= 2, \
            f"CMP presente mas tags dispararam — deveria apontar, apontou {r.consent.tags_before_consent}"
        assert r.privacy.total_violations >= 2


class TestExtracaoDeIdentificador:
    def test_id_vem_da_rede_quando_a_tag_nao_esta_no_html(self):
        """Tag injetada pelo GTM só aparece na rede. O ID estava na URL da
        requisição, mas era procurado apenas no HTML: o relatório dizia "GA4
        detectado" sem informar qual propriedade."""
        class Scan:
            html = "<html><head></head><body>x</body></html>"
            all_script_urls = []
            intercepted_requests = [
                _Requisicao("https://www.google-analytics.com/g/collect?v=2&tid=G-ZZZ9999999")
            ]

        tags = detect_tags(Scan.html, scan=Scan())
        ga4 = next((t for t in tags if t.id == "ga4"), None)
        assert ga4 is not None, "tag vista só pela rede não foi detectada"
        assert ga4.tag_id == "G-ZZZ9999999"


class TestCoberturaDeDeteccao:
    @pytest.mark.parametrize("nome,html,vendor_id", [
        ("Segment (snippet oficial usa analytics.load)",
         '<script>!function(){var analytics=window.analytics=window.analytics||[];analytics.load("chave");}();</script>',
         "segment"),
        ("RD Station (maior plataforma de automação do Brasil)",
         '<script src="https://d335luupugsy2.cloudfront.net/js/loader-scripts/abc-loader.js" async></script>',
         "rd_station"),
    ])
    def test_plataforma_e_detectada(self, nome, html, vendor_id):
        tags = detect_tags(f"<html><head>{html}</head><body>x</body></html>")
        assert any(t.id == vendor_id for t in tags), f"{nome} não detectada"

    def test_beacon_de_coleta_prova_o_disparo(self):
        """O catálogo mapeava só o script de carga. Sem o endpoint de coleta,
        não dava para provar que a tag efetivamente enviou dados."""
        class Scan:
            html = "<html><head></head><body>x</body></html>"
            all_script_urls = []
            intercepted_requests = [_Requisicao("https://www.facebook.com/tr?id=123&ev=PageView")]

        tags = detect_tags(Scan.html, scan=Scan())
        assert any(t.id == "meta_pixel" for t in tags), \
            "Meta Pixel disparou o beacon de coleta e não foi detectado"
