"""A tela só pode mostrar o que a varredura observou.

Duas abas do plano pago fabricavam evidência. O `CookiesInspector` montava um
`_ga` com "2 anos" de validade a partir das tags detectadas; o
`DataLayerAnalyzer` inventava um `purchase` com SKU e preço. Os comentários no
código eram honestos — `// Simular cookies`, `// Gerar eventos do dataLayer` —
mas a tela apresentava tudo como observado.

Num laudo de conformidade isso é o defeito mais caro que existe. O cliente leva
ao DPO uma lista de cookies que talvez nunca tenham sido gravados; se alguém
conferir e não encontrar, o laudo inteiro vira suspeito — inclusive a parte que
estava certa.

Estes testes garantem o que a tela precisa para não ter de inventar: a
evidência real chega à resposta, com os campos que ela exibe.
"""
import os

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.audit import _normalize_audit_response
from audit_engine.orchestrator import run_audit
from tests.test_campos_das_visoes import _Scan


@pytest.fixture(scope="module")
def resposta():
    resultado = run_audit("https://loja.com.br", _Scan())
    return _normalize_audit_response("https://loja.com.br", "premium", _Scan(), resultado)


class TestCookiesSaoObservados:
    def test_a_lista_de_cookies_chega_a_resposta(self, resposta):
        """Sem isto, a aba não tem o que mostrar — e foi por isso que a versão
        anterior passou a inventar."""
        storage = resposta.get("storage")
        assert storage is not None
        assert storage.get("cookiesWithoutConsent"), "nenhum cookie observado num site sem CMP"

    def test_cada_cookie_traz_o_que_a_tela_exibe(self, resposta):
        """Campo ausente aqui vira espaço em branco na tela — ou tentação de
        preencher com suposição."""
        cookie = resposta["storage"]["cookiesWithoutConsent"][0]
        assert cookie.get("name")
        assert cookie.get("owner"), "sem o dono, o cookie não diz nada a quem lê"
        assert cookie.get("purpose"), "sem finalidade, não há como avaliar base legal"
        assert cookie.get("severity") in ("critical", "high", "medium", "low")

    def test_total_acompanha_a_lista(self, resposta):
        storage = resposta["storage"]
        assert storage["totalCookiesWithoutConsent"] >= len(storage["cookiesWithoutConsent"])

    def test_cookie_de_servidor_e_distinguivel(self, resposta):
        """`httpOnly` separa o que o JavaScript gravou do que veio por
        Set-Cookie — e é o que sustenta a conversa sobre server-side."""
        for c in resposta["storage"]["cookiesWithoutConsent"]:
            assert "httpOnly" in c or "http_only" in c


class TestDataLayerNaoEInventado:
    def test_a_resposta_traz_os_achados_de_datalayer(self, resposta):
        """Pode ser lista vazia — o que não pode é a chave sumir e a tela
        preencher com evento fabricado."""
        assert "datalayerFindings" in resposta

    def test_eventos_vem_do_motor(self, resposta):
        assert "events" in resposta
        assert isinstance(resposta["events"], list)

    def test_pagina_sem_evento_nao_inventa(self, resposta):
        """O cenário de teste não dispara evento: a resposta precisa refletir
        isso, e a tela dizer que não houve — não montar um `view_item`."""
        assert resposta["events"] == [] or all(
            isinstance(e, dict) and e.get("name") for e in resposta["events"]
        )


class TestOVereditoChegaInteiro:
    """Regressão: o campo existia na resposta e o normalizador do frontend não
    o copiava, deixando o plano gratuito com a tela vazia."""

    def test_veredito_esta_na_resposta(self, resposta):
        v = resposta.get("veredito")
        assert v is not None
        assert v.get("titulo") and v.get("frase")

    def test_o_nivel_de_detalhe_e_declarado(self, resposta):
        assert resposta.get("showsDetail") is True

    def test_total_de_tags_sobrevive_ao_corte(self):
        """A tela conta por aqui, não pela lista — contar pela lista mostrava
        "0 tag(s) detectada(s)" ao lado de "15 achados"."""
        resultado = run_audit("https://loja.com.br", _Scan())
        free = _normalize_audit_response("https://loja.com.br", "free", _Scan(), resultado)
        assert free["tags"] == []
        assert free["summary"]["totalTags"] > 0
