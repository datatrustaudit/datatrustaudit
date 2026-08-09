"""A rota que recebe o HAR do percurso.

O que esta rota aceita vem de fora e costuma ser grande: HAR de checkout com
corpo de resposta passa de 10 MB. E carrega o dado mais sensível que este
produto chega perto — o conteúdo real de um pedido, com e-mail, CPF e endereço.

O teste que mais importa aqui é um: **nada de PII pode sobrar no que a rota
devolve nem no que ela grava**. Se falhar, o produto passa a ser o vazamento
que audita.
"""
import json

import pytest

from db.models import Scan


def _entrada(url, pageref="p1", quando="2026-08-09T14:26:01.000Z",
             mime="text/html", metodo="GET", corpo=None, html=None):
    return {
        "pageref": pageref,
        "startedDateTime": quando,
        "request": {
            "method": metodo,
            "url": url,
            **({"postData": {"text": corpo}} if corpo else {}),
        },
        "response": {
            "content": {
                "mimeType": mime,
                **({"text": html} if html else {}),
            },
            "cookies": [],
        },
    }


HAR_DE_CHECKOUT = {
    "log": {
        "version": "1.2",
        "pages": [
            {"id": "p1", "title": "Home", "startedDateTime": "2026-08-09T14:22:00.000Z"},
            {"id": "p2", "title": "Finalizar compra", "startedDateTime": "2026-08-09T14:26:00.000Z"},
        ],
        "entries": [
            _entrada("https://loja.com.br/", "p1", "2026-08-09T14:22:01.000Z",
                     html="<html><head></head><body>home</body></html>"),
            _entrada("https://loja.com.br/checkout?email=cliente@loja.com.br", "p2",
                     "2026-08-09T14:26:01.000Z",
                     html='<html><head><script>fbq("init","1234567890123456");</script></head></html>'),
            _entrada("https://www.facebook.com/tr/", "p2", "2026-08-09T14:26:03.000Z",
                     mime="image/gif", metodo="POST",
                     corpo="id=1234567890123456&ev=Purchase&em=cliente@loja.com.br&cpf=529.982.247-25"),
        ],
    }
}


def _subir(client, headers, har, nome="percurso.har"):
    return client.post(
        "/api/trajeto/har",
        headers=headers,
        files={"arquivo": (nome, json.dumps(har).encode("utf-8"), "application/json")},
    )


@pytest.fixture()
def usuario_premium(client, db, usuario_logado):
    """Conta paga. O gratuito recebe o veredito de cada passo, não a lista de
    tags — então o detalhe do percurso só é verificável aqui."""
    from db.models import User
    headers, email = usuario_logado
    user = db.query(User).filter(User.email == email).first()
    user.plan = "premium"
    db.commit()
    return headers, user


class TestPercursoAuditado:
    def test_cada_pagina_vira_um_passo(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = _subir(client, headers, HAR_DE_CHECKOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["resumo"]["passos"] == 2
        assert [p["nome"] for p in d["passos"]] == ["Home (/)", "Finalizar compra (/checkout)"]

    def test_tag_do_checkout_aparece_no_passo_certo(self, client, usuario_premium):
        """O achado que a varredura de home nunca encontraria."""
        headers, _ = usuario_premium
        d = _subir(client, headers, HAR_DE_CHECKOUT).json()
        checkout = d["passos"][1]
        nomes = [t["name"] for t in checkout["laudo"]["tags"]]
        assert any("Meta" in n for n in nomes), f"pixel não detectado no checkout: {nomes}"

    def test_pii_e_reportada_com_o_local(self, client, usuario_logado):
        headers, _ = usuario_logado
        d = _subir(client, headers, HAR_DE_CHECKOUT).json()
        checkout = d["passos"][1]
        tipos = {x["tipo"] for x in checkout["dadosPessoais"]}
        assert "email" in tipos and "cpf" in tipos
        assert all(x["onde"] for x in checkout["dadosPessoais"])

    def test_resumo_agrega_o_percurso(self, client, usuario_logado):
        headers, _ = usuario_logado
        d = _subir(client, headers, HAR_DE_CHECKOUT).json()["resumo"]
        assert d["requisicoes"] == 3
        assert set(d["violationsBySeverity"]) == {"critical", "high", "medium", "low"}
        assert d["dadosPessoaisEncontrados"].get("email", 0) >= 1


class TestNenhumaPIIEscapa:
    """O teste que decide se este recurso pode existir."""

    def test_resposta_nao_contem_dado_pessoal(self, client, usuario_logado):
        headers, _ = usuario_logado
        bruto = _subir(client, headers, HAR_DE_CHECKOUT).text
        assert "cliente@loja.com.br" not in bruto
        assert "529.982.247-25" not in bruto

    def test_banco_nao_contem_dado_pessoal(self, client, db, usuario_logado):
        """O laudo é persistido; se a PII entrar aqui, fica."""
        headers, _ = usuario_logado
        d = _subir(client, headers, HAR_DE_CHECKOUT).json()
        registro = db.query(Scan).filter(Scan.id == d["scan_id"]).first()
        assert registro is not None
        gravado = json.dumps(registro.raw_data)
        assert "cliente@loja.com.br" not in gravado
        assert "529.982.247-25" not in gravado

    def test_o_har_original_nao_e_guardado(self, client, db, usuario_logado):
        """Só o resultado da auditoria é gravado — nunca o arquivo."""
        headers, _ = usuario_logado
        d = _subir(client, headers, HAR_DE_CHECKOUT).json()
        registro = db.query(Scan).filter(Scan.id == d["scan_id"]).first()
        assert "entries" not in json.dumps(registro.raw_data)

    def test_id_do_pixel_sobrevive(self, client, usuario_premium):
        """Mascarar demais quebraria a detecção da tag que se quer auditar."""
        headers, _ = usuario_premium
        bruto = _subir(client, headers, HAR_DE_CHECKOUT).text
        assert "1234567890123456" in bruto


class TestArquivoImprestavel:
    def test_exige_login(self, client):
        r = _subir(client, {}, HAR_DE_CHECKOUT)
        assert r.status_code in (401, 403)

    def test_arquivo_vazio(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = client.post("/api/trajeto/har", headers=headers,
                        files={"arquivo": ("vazio.har", b"", "application/json")})
        assert r.status_code == 400

    def test_json_quebrado(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = client.post("/api/trajeto/har", headers=headers,
                        files={"arquivo": ("x.har", b"{nao e json", "application/json")})
        assert r.status_code == 400

    def test_json_que_nao_e_har(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = client.post("/api/trajeto/har", headers=headers,
                        files={"arquivo": ("x.har", b'{"algo": 1}', "application/json")})
        assert r.status_code == 400
        assert "Export HAR" in r.json()["detail"], "a mensagem precisa ensinar a exportar certo"

    def test_har_sem_requisicoes_utilizaveis(self, client, usuario_logado):
        headers, _ = usuario_logado
        vazio = {"log": {"version": "1.2", "pages": [], "entries": []}}
        r = _subir(client, headers, vazio)
        assert r.status_code == 400

    def test_arquivo_grande_demais(self, client, usuario_logado):
        """HAR de sessão longa passa de 25 MB e não pode ser lido inteiro."""
        headers, _ = usuario_logado
        gigante = b"x" * (26 * 1024 * 1024)
        r = client.post("/api/trajeto/har", headers=headers,
                        files={"arquivo": ("grande.har", gigante, "application/json")})
        assert r.status_code == 413
        assert "Preserve log" in r.json()["detail"], "a mensagem precisa dizer como reduzir"


class TestTeto:
    def test_percurso_longo_e_cortado_e_avisado(self, client, usuario_logado):
        """Silenciar o corte faria o laudo parecer completo sem ser."""
        headers, _ = usuario_logado
        paginas = [{"id": f"p{i}", "title": f"Tela {i}",
                    "startedDateTime": f"2026-08-09T14:{i:02d}:00.000Z"} for i in range(20)]
        entradas = [_entrada(f"https://loja.com.br/t{i}", f"p{i}",
                             f"2026-08-09T14:{i:02d}:01.000Z", html="<html></html>")
                    for i in range(20)]
        r = _subir(client, headers, {"log": {"pages": paginas, "entries": entradas}})
        assert r.status_code == 200
        d = r.json()
        assert len(d["passos"]) <= 12
        assert d["resumo"]["passosIgnorados"] > 0
