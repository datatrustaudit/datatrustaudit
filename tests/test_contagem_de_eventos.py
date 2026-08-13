"""A aba Eventos dizia "13 eventos · 0 únicos · 0 duplicados · 0 com problemas".

Os dois primeiros números não podem coexistir: treze eventos têm pelo menos um
nome. O terceiro e o quarto eram piores — afirmavam ausência de duplicata e
ausência de problema sobre uma medição que nunca chegou à tela.

A causa é a de sempre neste produto: a resposta de `/api/audit` achata `events`
para a lista pura, e a tela lia `uniqueEventNames`/`duplicatedEventNames`/
`eventsWithIssues` de um objeto que não existia mais. Todos caíam no zero
padrão, em silêncio. O motor (`audit_engine/event_auditor.py`) já calculava os
quatro; era a resposta que os descartava.

Agora os agregados viajam em `summary`, junto de `violationsBySeverity` e pelo
mesmo motivo: contador sobrevive ao corte por plano, lista não.
"""
import os

os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.audit import _agregados_de_evento


def _evento(nome, **extra):
    base = {"name": nome, "validity": "valid"}
    base.update(extra)
    return base


class TestContagemAPartirDaLista:
    def test_treze_eventos_com_cinco_nomes(self):
        """O caso real que expôs o defeito: terra.com.br dispara gtm.dom,
        gtm.load, gtm.scrollDepth (várias vezes), gtm.click e gtm.timer."""
        itens = (
            [_evento("gtm.dom"), _evento("gtm.load")]
            + [_evento("gtm.scrollDepth")] * 8
            + [_evento("gtm.click")] * 2
            + [_evento("gtm.timer")]
        )
        r = _agregados_de_evento([], itens)

        assert len(itens) == 13
        assert r["uniqueEventNames"] == 5
        assert r["duplicatedEventNames"] == 2  # scrollDepth e click

    def test_nome_unico_nao_e_duplicata(self):
        r = _agregados_de_evento([], [_evento("page_view")])
        assert r["uniqueEventNames"] == 1
        assert r["duplicatedEventNames"] == 0

    def test_lista_vazia_zera_sem_estourar(self):
        r = _agregados_de_evento([], [])
        assert r == {
            "uniqueEventNames": 0,
            "duplicatedEventNames": 0,
            "eventsWithIssues": 0,
            "ecommerceEventsDetected": [],
        }

    def test_entrada_suja_nao_derruba_a_resposta(self):
        """Cache antigo e resposta parcial já trouxeram `None` no meio da
        lista. Uma varredura inteira não pode se perder por causa disso."""
        r = _agregados_de_evento([], [_evento("purchase"), None, "x", {"sem": "nome"}])
        assert r["uniqueEventNames"] == 1


class TestEventoComProblema:
    """Mesma régua do motor: `VALIDITY_PARTIAL`, `VALIDITY_MALFORMED` ou
    faltando parâmetro obrigatório."""

    def test_evento_valido_e_completo_nao_conta(self):
        r = _agregados_de_evento([], [_evento("purchase", validity="valid")])
        assert r["eventsWithIssues"] == 0

    def test_validade_parcial_conta(self):
        r = _agregados_de_evento([], [_evento("purchase", validity="partial")])
        assert r["eventsWithIssues"] == 1

    def test_malformado_conta(self):
        r = _agregados_de_evento([], [_evento("purchase", validity="malformed")])
        assert r["eventsWithIssues"] == 1

    def test_parametro_obrigatorio_faltando_conta(self):
        """Chega nos dois formatos: snake_case do `raw_data` e camelCase da
        API. Ler só um devolvia zero para metade dos laudos."""
        assert _agregados_de_evento([], [
            _evento("purchase", missing_required_params=["value"])
        ])["eventsWithIssues"] == 1
        assert _agregados_de_evento([], [
            _evento("purchase", missingRequiredParams=["value"])
        ])["eventsWithIssues"] == 1


class TestEcommerce:
    def test_reconhece_evento_de_receita(self):
        r = _agregados_de_evento([], [
            _evento("purchase"), _evento("begin_checkout"), _evento("gtm.load")
        ])
        assert r["ecommerceEventsDetected"] == ["begin_checkout", "purchase"]

    def test_pagina_sem_loja_nao_inventa(self):
        r = _agregados_de_evento([], [_evento("gtm.dom"), _evento("page_view")])
        assert r["ecommerceEventsDetected"] == []


class TestPrecedencia:
    def test_o_que_o_motor_calculou_vence(self):
        """Se o agregado veio pronto, ele manda: recalcular sobre uma lista já
        cortada pelo plano daria número menor que o real."""
        motor = {
            "uniqueEventNames": 40,
            "duplicatedEventNames": 7,
            "eventsWithIssues": 3,
            "ecommerceEventsDetected": ["purchase"],
        }
        r = _agregados_de_evento(motor, [_evento("page_view")])
        assert r["uniqueEventNames"] == 40
        assert r["duplicatedEventNames"] == 7

    def test_zero_do_motor_e_resposta_valida(self):
        """Zero não pode ser confundido com ausência e disparar o recálculo —
        é o erro que `||` comete e `is not None` evita."""
        motor = {
            "uniqueEventNames": 0,
            "duplicatedEventNames": 0,
            "eventsWithIssues": 0,
            "ecommerceEventsDetected": [],
        }
        r = _agregados_de_evento(motor, [_evento("a"), _evento("b")])
        assert r["uniqueEventNames"] == 0

    def test_agregado_incompleto_cai_para_o_recalculo(self):
        """Resposta antiga com só parte dos campos não pode entregar `None`
        para a tela — `None` vira "0" silencioso lá."""
        r = _agregados_de_evento({"uniqueEventNames": 5}, [_evento("a"), _evento("a")])
        assert r["duplicatedEventNames"] == 1
        assert all(v is not None for v in r.values())


class TestNaRespostaDaApi:
    def test_summary_carrega_os_quatro_agregados(self):
        """É de `summary` que a tela lê — o mesmo lugar de
        `violationsBySeverity`, e pelo mesmo motivo."""
        from api.audit import _normalize_audit_response

        motor = {"events": {"events": [
            {"name": "purchase", "validity": "partial"},
            {"name": "purchase", "validity": "valid"},
            {"name": "gtm.load", "validity": "valid"},
        ]}}

        r = _normalize_audit_response("https://loja.com.br", "premium", None, motor)
        s = r["summary"]
        assert s["eventsDetected"] == 3
        assert s["uniqueEventNames"] == 2
        assert s["duplicatedEventNames"] == 1
        assert s["eventsWithIssues"] == 1
        assert s["ecommerceEventsDetected"] == ["purchase"]

    def test_a_lista_de_eventos_continua_sendo_lista(self):
        """Contrato de `events` preservado: testes e telas antigas dependem
        dele. Os agregados foram para `summary` justamente por isso."""
        from api.audit import _normalize_audit_response

        motor = {"events": {"events": [{"name": "page_view", "validity": "valid"}]}}

        r = _normalize_audit_response("https://loja.com.br", "premium", None, motor)
        assert isinstance(r["events"], list)
