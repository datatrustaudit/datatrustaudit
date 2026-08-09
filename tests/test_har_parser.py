"""Leitura do HAR e montagem do percurso.

O modo trajeto existe porque o scanner abre a home deslogado, e dado pessoal
não vaza na home — vaza no checkout e na confirmação do pedido. O HAR é o que
permite auditar isso sem extensão e sem pedir credencial ao cliente.

Dois cuidados guiam os testes:

- **O HAR vem de fora.** É arquivo que o usuário exporta e sobe; malformado,
  truncado ou de outra ferramenta não pode derrubar a rota.
- **O percurso precisa sair na ordem certa.** Um laudo que diz "o pixel
  disparou no checkout" quando disparou na home é pior que não ter o recurso.
"""
import json

import pytest

from audit_engine.har_parser import (
    HARInvalido,
    MAX_ENTRADAS,
    ler_har,
    montar_passos,
    passo_para_scan,
    resumo_do_percurso,
)


def entrada(url, pageref="p1", quando="2026-08-09T14:22:07.000Z", mime="text/html",
            metodo="GET", corpo=None, cookies=()):
    return {
        "pageref": pageref,
        "startedDateTime": quando,
        "request": {
            "method": metodo,
            "url": url,
            **({"postData": {"text": corpo}} if corpo else {}),
        },
        "response": {
            "content": {"mimeType": mime, **({"text": "<html>home</html>"} if mime == "text/html" else {})},
            "cookies": list(cookies),
        },
    }


def har(entradas, paginas=None):
    return json.dumps({
        "log": {
            "version": "1.2",
            "creator": {"name": "Chrome DevTools"},
            "pages": paginas if paginas is not None else [
                {"id": "p1", "title": "Home", "startedDateTime": "2026-08-09T14:22:00.000Z"},
            ],
            "entries": entradas,
        }
    })


PERCURSO = har(
    paginas=[
        {"id": "p1", "title": "Home", "startedDateTime": "2026-08-09T14:22:00.000Z"},
        {"id": "p2", "title": "Carrinho", "startedDateTime": "2026-08-09T14:24:00.000Z"},
        {"id": "p3", "title": "Finalizar compra", "startedDateTime": "2026-08-09T14:26:00.000Z"},
    ],
    entradas=[
        entrada("https://loja.com.br/", "p1", "2026-08-09T14:22:01.000Z"),
        entrada("https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234", "p1",
                "2026-08-09T14:22:02.000Z", mime="application/javascript"),
        entrada("https://loja.com.br/carrinho", "p2", "2026-08-09T14:24:01.000Z"),
        entrada("https://loja.com.br/checkout", "p3", "2026-08-09T14:26:01.000Z"),
        entrada("https://www.facebook.com/tr/", "p3", "2026-08-09T14:26:03.000Z",
                mime="image/gif", metodo="POST",
                corpo="id=1234567890123&ev=Purchase&ud[em]=[e-mail removido]"),
    ],
)


class TestLeitura:
    def test_har_valido(self):
        log = ler_har(PERCURSO)
        assert len(log["entries"]) == 5

    def test_json_quebrado(self):
        with pytest.raises(HARInvalido):
            ler_har("{isso não é json")

    def test_json_valido_que_nao_e_har(self):
        with pytest.raises(HARInvalido) as e:
            ler_har('{"algo": 1}')
        assert "Export HAR" in str(e.value), "a mensagem precisa dizer como exportar certo"

    def test_har_sem_entries(self):
        with pytest.raises(HARInvalido):
            ler_har('{"log": {"version": "1.2"}}')

    def test_aceita_dict_ja_carregado(self):
        assert ler_har(json.loads(PERCURSO))["version"] == "1.2"


class TestPercurso:
    def test_um_passo_por_pagina_navegada(self):
        passos = montar_passos(ler_har(PERCURSO))
        assert [p["titulo"] for p in passos] == ["Home", "Carrinho", "Finalizar compra"]

    def test_passos_saem_em_ordem_cronologica(self):
        """Ordem errada faria o laudo dizer que o pixel disparou no passo errado."""
        passos = montar_passos(ler_har(PERCURSO))
        tempos = [p["inicio"] for p in passos]
        assert tempos == sorted(tempos)

    def test_requisicao_fica_no_passo_certo(self):
        passos = montar_passos(ler_har(PERCURSO))
        checkout = [p for p in passos if p["titulo"] == "Finalizar compra"][0]
        urls = [r.url for r in checkout["requisicoes"]]
        assert any("facebook.com/tr" in u for u in urls)
        assert not any("gtm.js" in u for u in urls), "requisição da home vazou para o checkout"

    def test_nome_do_passo_junta_titulo_e_caminho(self):
        passos = montar_passos(ler_har(PERCURSO))
        assert passos[2]["nome"] == "Finalizar compra (/checkout)"

    def test_har_sem_pages_vira_passo_unico(self):
        """Alguns exportadores omitem `pages`. Melhor um laudo de percurso
        inteiro do que recusar o arquivo."""
        dados = har([entrada("https://loja.com.br/", pageref=None)], paginas=[])
        passos = montar_passos(ler_har(dados))
        assert len(passos) == 1
        assert passos[0]["requisicoes"]

    def test_teto_de_entradas(self):
        """Sessão longa passa de 20 mil requisições; ler tudo trava o worker
        sem melhorar o laudo."""
        muitas = [entrada(f"https://loja.com.br/r{i}") for i in range(MAX_ENTRADAS + 500)]
        passos = montar_passos(ler_har(har(muitas)))
        assert sum(len(p["requisicoes"]) for p in passos) <= MAX_ENTRADAS


class TestConversaoParaScan:
    def test_scan_tem_o_formato_que_o_motor_espera(self):
        passos = montar_passos(ler_har(PERCURSO))
        scan = passo_para_scan(passos[0])
        for atributo in ("url", "html", "intercepted_requests", "cookies",
                         "local_storage", "session_storage", "scan_method"):
            assert hasattr(scan, atributo), f"o motor lê `{atributo}` e ele não existe"
        assert scan.scan_method == "har"

    def test_requisicao_carrega_timestamp(self):
        """É o timestamp que sustenta "disparou antes de qualquer aceite"."""
        passos = montar_passos(ler_har(PERCURSO))
        scan = passo_para_scan(passos[2])
        assert all(r.timestamp > 0 for r in scan.intercepted_requests)

    def test_corpo_do_post_e_preservado(self):
        """O payload do beacon é a prova de que a tag enviou dados."""
        passos = montar_passos(ler_har(PERCURSO))
        scan = passo_para_scan(passos[2])
        corpos = [r.post_data for r in scan.intercepted_requests if r.post_data]
        assert corpos and "ev=Purchase" in corpos[0]

    def test_cookie_de_resposta_e_capturado(self):
        """`document.cookie` não vê HttpOnly nem os FPID de server-side."""
        dados = har([entrada(
            "https://loja.com.br/", cookies=[
                {"name": "FPID", "value": "abc", "domain": ".loja.com.br", "httpOnly": True},
            ],
        )])
        scan = passo_para_scan(montar_passos(ler_har(dados))[0])
        assert [c["name"] for c in scan.cookies] == ["FPID"]
        assert scan.cookies[0]["httpOnly"] is True

    def test_cookie_repetido_nao_duplica(self):
        """O mesmo Set-Cookie aparece em várias respostas."""
        c = [{"name": "_ga", "value": "1", "domain": ".loja.com.br"}]
        dados = har([
            entrada("https://loja.com.br/a", cookies=c),
            entrada("https://loja.com.br/b", cookies=c),
        ])
        scan = passo_para_scan(montar_passos(ler_har(dados))[0])
        assert len(scan.cookies) == 1


class TestEntradaImprestavel:
    def test_entrada_que_nao_e_dict(self):
        dados = json.dumps({"log": {"entries": ["texto", None, 42]}})
        assert montar_passos(ler_har(dados)) == []

    def test_entrada_sem_url(self):
        dados = json.dumps({"log": {"entries": [{"request": {"method": "GET"}}]}})
        assert montar_passos(ler_har(dados)) == []

    def test_data_invalida_nao_quebra(self):
        dados = har([entrada("https://loja.com.br/", quando="ontem à tarde")])
        passos = montar_passos(ler_har(dados))
        assert passos and passos[0]["requisicoes"][0].timestamp == 0.0

    def test_esquemas_internos_sao_ignorados(self):
        """`data:` e `chrome-extension:` poluem o laudo sem serem rastreio."""
        dados = har([
            entrada("data:image/png;base64,iVBOR"),
            entrada("chrome-extension://abc/inject.js"),
            entrada("https://loja.com.br/"),
        ])
        passos = montar_passos(ler_har(dados))
        assert len(passos[0]["requisicoes"]) == 1


class TestResumo:
    def test_conta_passos_e_requisicoes(self):
        r = resumo_do_percurso(montar_passos(ler_har(PERCURSO)))
        assert r["passos"] == 3
        assert r["requisicoes"] == 5
        assert r["paginas"][0].startswith("Home")

    def test_duracao_do_percurso(self):
        r = resumo_do_percurso(montar_passos(ler_har(PERCURSO)))
        assert r["duracaoSegundos"] and r["duracaoSegundos"] > 0

    def test_percurso_vazio_nao_quebra(self):
        r = resumo_do_percurso([])
        assert r["passos"] == 0 and r["duracaoSegundos"] is None
