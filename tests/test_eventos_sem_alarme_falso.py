"""Dois alarmes falsos que o laudo de eventos publicava sobre implementação correta.

Os dois apareciam no laudo real da terra.com.br, congelado em
`static/src/dev/laudo-de-exemplo.json`:

1. **`page_location` e `page_title` cobrados de um hit que os carregava.**
   No protocolo de coleta do GA4 os parâmetros padrão não viajam como `ep.*` —
   `page_location` é `dl`, `page_title` é `dt`. O auditor só lia `ep.*`, então
   listava os três recomendados (`page_title`, `page_location`, `page_path`)
   como ausentes em todo `page_view` observado na rede. `page_path` é pior
   ainda: ninguém envia, o GA4 deriva do caminho de `dl`.

2. **`page_view` apontado como disparo duplicado.** Os dois hits iam para
   propriedades GA4 diferentes (`G-7Y8JPEF9M3` e `G-FJBH1GT2QG`): é
   tagueamento duplo, não `dataLayer.push()` repetido. A recomendação mandava
   procurar um push que não existe, e a nota afirmava "detected in static HTML
   source only" sobre prova que veio da rede — método de coleta errado derruba
   o achado inteiro.

Alarme falso custa mais que falso negativo: erro para mais o cliente confere e
reclama; a parte correta do laudo é que fica sob suspeita.
"""
import os

os.environ.setdefault("SECRET_KEY", "x" * 40)

from audit_engine.duplicate_detector import detect_duplicates
from audit_engine.event_auditor import audit_events


class _Requisicao:
    def __init__(self, url):
        self.url = url
        self.post_data = None


class _Scan:
    """O mínimo que `audit_events` lê de um scan de navegador."""

    def __init__(self, requisicoes):
        self.intercepted_requests = requisicoes


class _Evento:
    """EventFinding mínimo para o detector de duplicatas."""

    def __init__(self, nome, snippet="", metodo=""):
        self.name = nome
        self.source_snippet = snippet
        self.detection_method = metodo


_HIT_PAGE_VIEW = (
    "https://www.google-analytics.com/g/collect?v=2&tid=G-7Y8JPEF9M3&en=page_view"
    "&dl=https%3A%2F%2Fwww.terra.com.br%2Fnoticias%2F&dt=Terra%20-%20Not%C3%ADcias"
    "&dr=https%3A%2F%2Fwww.google.com%2F&ep.content_type=cap"
)


def _evento_unico(resultado, nome):
    achados = [e for e in resultado.events if e.name == nome]
    assert achados, f"o evento {nome} deveria ter sido detectado"
    return achados[0]


class TestParametroPadraoNaRequisicao:
    def test_page_location_e_page_title_nao_sao_cobrados_quando_vieram(self):
        r = audit_events("<html></html>", _Scan([_Requisicao(_HIT_PAGE_VIEW)]))
        page_view = _evento_unico(r, "page_view")

        assert "page_location" not in page_view.missing_recommended_params
        assert "page_title" not in page_view.missing_recommended_params

    def test_page_path_nao_e_cobrado_de_requisicao_de_rede(self):
        """O GA4 deriva `page_path` de `dl`; ninguém o envia."""
        r = audit_events("<html></html>", _Scan([_Requisicao(_HIT_PAGE_VIEW)]))
        page_view = _evento_unico(r, "page_view")

        assert "page_path" not in page_view.missing_recommended_params
        assert page_view.missing_recommended_params == []

    def test_o_valor_exibido_e_o_observado(self):
        """O parâmetro entra com o nome do protocolo e o valor que veio no hit —
        renomear é tradução, inventar valor seria fabricação."""
        r = audit_events("<html></html>", _Scan([_Requisicao(_HIT_PAGE_VIEW)]))
        page_view = _evento_unico(r, "page_view")
        por_nome = {p.name: p.value for p in page_view.parameters_found}

        assert por_nome["page_location"] == "https://www.terra.com.br/noticias/"
        assert por_nome["page_title"] == "Terra - Notícias"
        assert "page_path" not in por_nome

    def test_currency_de_compra_vem_em_cu(self):
        hit = (
            "https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567&en=purchase"
            "&cu=BRL&epn.value=199.9&ep.transaction_id=T-1"
        )
        r = audit_events("<html></html>", _Scan([_Requisicao(hit)]))
        compra = _evento_unico(r, "purchase")

        assert compra.missing_required_params == []
        assert compra.validity == "valid"

    def test_compra_sem_currency_continua_sendo_apontada(self):
        """A correção não pode calar o achado verdadeiro."""
        hit = (
            "https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567&en=purchase"
            "&epn.value=199.9&ep.transaction_id=T-1"
        )
        r = audit_events("<html></html>", _Scan([_Requisicao(hit)]))
        compra = _evento_unico(r, "purchase")

        assert "currency" in compra.missing_required_params


class TestUmDisparoPorPropriedadeNaoEDuplicata:
    def test_page_view_para_duas_propriedades(self):
        eventos = [
            _Evento("page_view", "https://x/g/collect?v=2&tid=G-7Y8JPEF9M3&en=page_view", "network_request"),
            _Evento("page_view", "https://x/g/collect?v=2&tid=G-FJBH1GT2QG&en=page_view", "network_request"),
        ]
        achados = [a for a in detect_duplicates("<html></html>", [], eventos) if a.name == "page_view"]

        assert achados, "o fato precisa continuar no laudo"
        assert achados[0].severity == "low"
        assert "G-7Y8JPEF9M3" in achados[0].recommendation
        assert "G-FJBH1GT2QG" in achados[0].recommendation
        assert "dataLayer.push" not in achados[0].recommendation

    def test_dois_disparos_para_a_mesma_propriedade_continuam_duplicata(self):
        eventos = [
            _Evento("page_view", "https://x/g/collect?v=2&tid=G-7Y8JPEF9M3&en=page_view", "network_request"),
            _Evento("page_view", "https://x/g/collect?v=2&tid=G-7Y8JPEF9M3&en=page_view", "network_request"),
        ]
        achados = [a for a in detect_duplicates("<html></html>", [], eventos) if a.name == "page_view"]

        assert achados and achados[0].severity == "warning"

    def test_compra_duplicada_na_mesma_propriedade_continua_critica(self):
        eventos = [
            _Evento("purchase", "https://x/g/collect?tid=G-A&en=purchase", "network_request"),
            _Evento("purchase", "https://x/g/collect?tid=G-A&en=purchase", "network_request"),
        ]
        achados = [a for a in detect_duplicates("<html></html>", [], eventos) if a.name == "purchase"]

        assert achados and achados[0].severity == "critical"


class TestProcedenciaDoAchado:
    def test_achado_de_rede_nao_diz_que_veio_do_html(self):
        eventos = [
            _Evento("select_item", "https://x/g/collect?tid=G-A&en=select_item", "network_request"),
            _Evento("select_item", "https://x/g/collect?tid=G-A&en=select_item", "network_request"),
        ]
        achados = [a for a in detect_duplicates("<html></html>", [], eventos) if a.name == "select_item"]

        assert achados
        assert "requisição de rede" in achados[0].note

    def test_achado_de_html_diz_o_que_nao_enxerga(self):
        achados = [
            a for a in detect_duplicates("<html></html>", [], [_Evento("sign_up"), _Evento("sign_up")])
            if a.name == "sign_up"
        ]

        assert achados
        assert "não é observável" in achados[0].note
