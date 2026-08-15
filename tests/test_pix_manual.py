"""PIX na chave própria, confirmado à mão.

Duas coisas acontecem aqui, e as duas são perigosas: dinheiro entra e acesso
pago é liberado. Sem intermediário, não há um terceiro conferindo — o que a
API deixar passar, passou.

O caso mais fácil de esquecer é o do **scanner de link**: Gmail, Outlook e
antivírus corporativo abrem os links de um e-mail sozinhos, antes de qualquer
humano clicar. Um `GET` que libera plano seria disparado por eles, e o acesso
sairia de graça sem ninguém ter apertado nada. Por isso o link do e-mail leva a
uma página que só lê, e quem libera é um `POST`.
"""
import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

#: A regra de prazo da tela, exercitada no Node — ver `TestOPrazoDaTelaDePix`.
PIX_TS = Path(__file__).resolve().parents[1] / "static" / "src" / "lib" / "pix.ts"


@pytest.fixture(autouse=True)
def _pix_configurado(monkeypatch):
    """Sem chave a rota devolve 503 — correto em produção, inútil no teste."""
    monkeypatch.setenv("PIX_CHAVE", "digitalfistpower@gmail.com")
    monkeypatch.setenv("PIX_NOME_RECEBEDOR", "DataTrust Audit")
    monkeypatch.setenv("PIX_CIDADE", "Sao Paulo")


@pytest.fixture(autouse=True)
def _email_falso(monkeypatch):
    """Nenhum teste manda e-mail de verdade.

    As funções são substituídas por dublês que registram a chamada — é assim
    que se verifica QUE o dono foi avisado e com qual link, sem tocar o Resend.
    """
    import api.emails as e

    enviados = []
    monkeypatch.setattr(e, "avisar_dono_de_pix", lambda **kw: enviados.append(("dono", kw)) or True)
    monkeypatch.setattr(e, "confirmar_pix_ao_cliente", lambda **kw: enviados.append(("cliente", kw)) or True)
    monkeypatch.setattr(e, "instrucoes_de_pix_ao_cliente", lambda **kw: enviados.append(("instrucoes", kw)) or True)
    return enviados


def _cadastrar(client, admin=False):
    email = f"pix-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
    r = client.post("/api/auth/register", json={
        "email": email, "password": "SenhaForte#2026", "name": "Teste PIX",
    })
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]

    if admin:
        from db.database import SessionLocal
        from db.models import User
        db = SessionLocal()
        try:
            u = db.query(User).filter(User.email == email).first()
            u.is_admin = True
            db.commit()
        finally:
            db.close()

    return {"Authorization": f"Bearer {token}"}, email


def _criar_pedido(client, headers, plano="premium"):
    r = client.post("/api/payments/pix/pedido", json={"plan": plano}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _token_do_ultimo_email(enviados):
    """O token só existe no link do e-mail — em lugar nenhum do banco."""
    for tipo, kw in reversed(enviados):
        if tipo == "dono":
            return kw["link_de_confirmacao"].split("t=")[1]
    raise AssertionError("o dono não foi avisado")


class TestCriacaoDoPedido:
    def test_exige_login(self, client):
        r = client.post("/api/payments/pix/pedido", json={"plan": "premium"})
        assert r.status_code in (401, 403)

    def test_valor_vem_da_tabela_com_desconto_do_pix(self, client):
        headers, _ = _cadastrar(client)
        assert _criar_pedido(client, headers)["valor"] == 234.65

    def test_valor_do_cliente_e_ignorado(self, client):
        """Mandar {"valor": 1} não pode comprar o premium por um real."""
        headers, _ = _cadastrar(client)
        r = client.post(
            "/api/payments/pix/pedido",
            json={"plan": "premium", "valor": 1, "amount": 1},
            headers=headers,
        )
        assert r.json()["valor"] == 234.65

    def test_plano_gratuito_nao_gera_cobranca(self, client):
        headers, _ = _cadastrar(client)
        r = client.post("/api/payments/pix/pedido", json={"plan": "free"}, headers=headers)
        assert r.status_code == 400

    def test_o_brcode_carrega_a_chave_e_o_valor(self, client):
        headers, _ = _cadastrar(client)
        p = _criar_pedido(client, headers)
        assert "digitalfistpower@gmail.com" in p["brcode"]
        assert "234.65" in p["brcode"]
        assert p["chave"] == "digitalfistpower@gmail.com"

    def test_sem_chave_configurada_recusa_em_vez_de_mostrar_tela_vazia(self, client, monkeypatch):
        monkeypatch.setenv("PIX_CHAVE", "")
        headers, _ = _cadastrar(client)
        r = client.post("/api/payments/pix/pedido", json={"plan": "premium"}, headers=headers)
        assert r.status_code == 503

    def test_recarregar_a_pagina_nao_gera_cobranca_nova(self, client):
        """Dois pedidos abertos fariam o cliente pagar duas vezes."""
        headers, _ = _cadastrar(client)
        primeiro = _criar_pedido(client, headers)
        segundo = _criar_pedido(client, headers)
        assert primeiro["id"] == segundo["id"]
        assert primeiro["txid"] == segundo["txid"]

    def test_cada_pedido_tem_identificador_proprio(self, client):
        """O txid é o que casa o dinheiro recebido com o pedido certo quando
        duas pessoas pagam o mesmo valor no mesmo minuto."""
        a, _ = _cadastrar(client)
        b, _ = _cadastrar(client)
        assert _criar_pedido(client, a)["txid"] != _criar_pedido(client, b)["txid"]


class TestAvisoDePagamento:
    def test_avisar_nao_libera_o_plano(self, client):
        """Declarar que pagou é declaração, não pagamento."""
        headers, email = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)

        assert client.get("/api/auth/me", headers=headers).json()["plan"] == "free"

    def test_o_dono_e_avisado_com_o_link(self, client, _email_falso):
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)

        avisos = [kw for tipo, kw in _email_falso if tipo == "dono"]
        assert len(avisos) == 1
        assert "/admin/confirmar-pix?t=" in avisos[0]["link_de_confirmacao"]
        assert avisos[0]["valor"] == 234.65

    def test_ninguem_avisa_por_pedido_alheio(self, client):
        """O id é sequencial: sem o dono na consulta, dava para varrer os
        pedidos dos outros."""
        dono, _ = _cadastrar(client)
        intruso, _ = _cadastrar(client)
        pedido = _criar_pedido(client, dono)

        r = client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=intruso)
        assert r.status_code == 404, "404 e não 403: 403 confirmaria que o pedido existe"

    def test_avisar_de_novo_invalida_o_link_anterior(self, client, _email_falso):
        """Dois e-mails na caixa do dono, e o antigo não pode mais liberar."""
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)

        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        primeiro = _token_do_ultimo_email(_email_falso)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        segundo = _token_do_ultimo_email(_email_falso)

        assert primeiro != segundo
        assert client.post("/api/payments/pix/confirmar", json={"token": primeiro}).status_code == 404
        assert client.post("/api/payments/pix/confirmar", json={"token": segundo}).status_code == 200


class TestOLinkDoEmail:
    """O ponto onde o dinheiro vira acesso."""

    @pytest.fixture()
    def pedido_avisado(self, client, _email_falso):
        headers, email = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        return headers, email, _token_do_ultimo_email(_email_falso)

    def test_abrir_a_pagina_nao_libera_nada(self, client, pedido_avisado):
        """ESTE é o teste que justifica a arquitetura.

        Gmail, Outlook e antivírus corporativo abrem os links do e-mail
        sozinhos, com GET, antes de qualquer humano clicar. Se o GET liberasse,
        o plano sairia de graça — e o log registraria uma confirmação que
        ninguém fez.
        """
        headers, _, token = pedido_avisado

        r = client.get(f"/api/payments/pix/confirmacao/{token}")
        assert r.status_code == 200
        assert r.json()["status"] == "avisado"
        assert client.get("/api/auth/me", headers=headers).json()["plan"] == "free"

    def test_o_post_libera(self, client, pedido_avisado):
        headers, _, token = pedido_avisado

        assert client.post("/api/payments/pix/confirmar", json={"token": token}).status_code == 200
        assert client.get("/api/auth/me", headers=headers).json()["plan"] == "premium"

    def test_confirmar_duas_vezes_nao_dobra_o_acesso(self, client, pedido_avisado):
        """Reenvio do e-mail, duplo clique e retry do navegador acontecem.
        Somar dois períodos por um pagamento só é o defeito que o webhook do
        Mercado Pago já teve."""
        headers, email, token = pedido_avisado
        client.post("/api/payments/pix/confirmar", json={"token": token})

        from db.database import SessionLocal
        from db.models import User
        db = SessionLocal()
        try:
            validade = db.query(User).filter(User.email == email).first().subscription.current_period_end
        finally:
            db.close()

        segunda = client.post("/api/payments/pix/confirmar", json={"token": token})
        assert segunda.status_code in (200, 404)

        db = SessionLocal()
        try:
            depois = db.query(User).filter(User.email == email).first().subscription.current_period_end
        finally:
            db.close()
        assert depois == validade, "a segunda confirmação somou outro período de acesso"

    def test_token_morre_no_uso(self, client, pedido_avisado):
        """O link circula por e-mail, que é encaminhável."""
        _, _, token = pedido_avisado
        client.post("/api/payments/pix/confirmar", json={"token": token})
        assert client.get(f"/api/payments/pix/confirmacao/{token}").status_code == 404

    def test_token_inventado_nao_abre_nada(self, client):
        assert client.post("/api/payments/pix/confirmar", json={"token": "chute"}).status_code == 404
        assert client.get("/api/payments/pix/confirmacao/chute").status_code == 404

    def test_token_vazio_e_recusado(self, client):
        assert client.post("/api/payments/pix/confirmar", json={"token": ""}).status_code == 400
        assert client.post("/api/payments/pix/confirmar", json={}).status_code == 400

    def test_o_token_nao_fica_em_claro_no_banco(self, client, pedido_avisado):
        """Vazamento do banco não pode virar liberação de plano de graça."""
        _, _, token = pedido_avisado

        from db.database import SessionLocal
        from db.models import PedidoPix
        db = SessionLocal()
        try:
            guardados = [p.token_hash for p in db.query(PedidoPix).all() if p.token_hash]
        finally:
            db.close()
        assert token not in guardados
        assert all(len(h) == 64 for h in guardados), "esperava SHA-256 em hexadecimal"


class TestMeuPedido:
    """A rota que a tela de checkout consulta — inclusive enquanto espera.

    Ela devolvia só `aguardando` e `avisado`. Pedido confirmado não casava com o
    filtro e saía como `{"pedido": null}`, indistinguível de "nunca houve
    pedido": quem avisou que pagou via "aguardando a conferência" para sempre, e
    recarregar a página não mudava nada, porque a liberação era exatamente o que
    fazia o pedido sumir da resposta.
    """

    def _confirmar(self, client, headers, enviados, plano="premium"):
        """Percorre o caminho real até o acesso liberado e devolve o pedido."""
        pedido = _criar_pedido(client, headers, plano=plano)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        token = _token_do_ultimo_email(enviados)
        r = client.post("/api/payments/pix/confirmar", json={"token": token})
        assert r.status_code == 200, r.text
        return pedido

    def _recuar_no_tempo(self, txid, horas):
        """Envelhece o pedido no banco — não há como esperar seis horas."""
        from datetime import timedelta

        from db.database import SessionLocal
        from db.models import PedidoPix

        db = SessionLocal()
        try:
            p = db.query(PedidoPix).filter(PedidoPix.txid == txid).first()
            assert p is not None
            recuo = timedelta(hours=horas)
            if p.confirmado_em:
                p.confirmado_em -= recuo
            p.criado_em -= recuo
            p.expira_em -= recuo
            db.commit()
        finally:
            db.close()

    def test_sem_pedido_nenhum_o_formato_e_pedido_nulo(self, client):
        headers, _ = _cadastrar(client)
        r = client.get("/api/payments/pix/meu-pedido", headers=headers)
        assert r.status_code == 200
        corpo = r.json()
        assert "pedido" in corpo, "a tela lê `pedido`; outra chave vira tela vazia em silêncio"
        assert corpo["pedido"] is None

    def test_cobranca_aguardando_volta_com_o_codigo(self, client):
        """Sem `brcode` a tela não tem o que mostrar e emite outra cobrança."""
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual["id"] == pedido["id"]
        assert atual["status"] == "aguardando"
        assert atual["chave"] == "digitalfistpower@gmail.com"
        assert atual["brcode"] == pedido["brcode"]

    def test_cobranca_avisada_continua_voltando(self, client):
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual["id"] == pedido["id"]
        assert atual["status"] == "avisado"
        assert atual["brcode"], "o cliente pode querer rever o código depois de avisar"

    def test_pedido_confirmado_ha_pouco_volta(self, client, _email_falso):
        """O bug: liberar o acesso fazia o pedido sumir da rota, e a tela do
        cliente ficava em "aguardando" para sempre."""
        headers, _ = _cadastrar(client)
        pedido = self._confirmar(client, headers, _email_falso)

        corpo = client.get("/api/payments/pix/meu-pedido", headers=headers).json()
        assert corpo["pedido"] is not None, "confirmado saía como null, igual a 'nunca houve pedido'"
        assert corpo["pedido"]["id"] == pedido["id"]
        assert corpo["pedido"]["status"] == "confirmado"
        assert corpo["pedido"]["confirmadoEm"]

    def test_pedido_confirmado_nao_volta_com_codigo_pagavel(self, client, _email_falso):
        """Código ao lado de "acesso liberado" convida a um segundo PIX."""
        headers, _ = _cadastrar(client)
        self._confirmar(client, headers, _email_falso)

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert not atual.get("brcode")
        assert not atual.get("chave")

    def test_pedido_confirmado_ha_muito_tempo_nao_volta(self, client, _email_falso):
        """Senão o checkout vira aviso permanente: quem pagou ontem e hoje quer
        contratar outro plano encontraria a liberação velha no lugar da
        cobrança nova."""
        headers, _ = _cadastrar(client)
        pedido = self._confirmar(client, headers, _email_falso)
        self._recuar_no_tempo(pedido["txid"], horas=24)

        corpo = client.get("/api/payments/pix/meu-pedido", headers=headers).json()
        assert corpo["pedido"] is None

    def test_codigo_vencido_nao_volta_como_cobranca_em_aberto(self, client):
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        self._recuar_no_tempo(pedido["txid"], horas=2)

        assert client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"] is None

    def test_cobranca_nova_vence_a_confirmacao_recente(self, client, _email_falso):
        """O que o cliente está tentando pagar agora vale mais que a notícia do
        pedido anterior — senão a tela do plano novo anunciaria acesso liberado
        e nunca mostraria o código a pagar."""
        headers, _ = _cadastrar(client)
        self._confirmar(client, headers, _email_falso, plano="pro")
        novo = _criar_pedido(client, headers, plano="premium")

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual["id"] == novo["id"]
        assert atual["status"] == "aguardando"

    def test_a_sequencia_que_a_tela_percorre(self, client, _email_falso):
        """O contrato que a verificação periódica consome, na ordem real:
        avisado enquanto espera, confirmado quando o acesso sai — sempre com o
        mesmo `id`, que é como a tela reconhece que a novidade é do pedido dela.
        """
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)

        durante = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert durante["id"] == pedido["id"] and durante["status"] == "avisado"

        client.post(
            "/api/payments/pix/confirmar",
            json={"token": _token_do_ultimo_email(_email_falso)},
        )

        depois = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert depois["id"] == pedido["id"], "id diferente faria a tela ignorar a confirmação"
        assert depois["status"] == "confirmado"

    def test_conferencia_demorada_ainda_chega_na_tela(self, client, _email_falso):
        """O caso comum: a conferência é manual e sai depois dos 30 minutos do
        código. O prazo vale para pagar, não para receber a resposta — se o
        pedido vencido deixasse de voltar mesmo confirmado, a tela de quem já
        pagou continuaria em "aguardando" para sempre."""
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        self._recuar_no_tempo(pedido["txid"], horas=1)  # o código venceu
        client.post(
            "/api/payments/pix/confirmar",
            json={"token": _token_do_ultimo_email(_email_falso)},
        )

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual is not None and atual["status"] == "confirmado"

    def test_aviso_pendente_sobrevive_ao_vencimento_do_codigo(self, client):
        """O prazo vale para o código, não para o aviso já dado.

        Quem paga no minuto 29 e clica "já fiz o PIX" fica com um pedido
        `avisado` cujo `expira_em` vence minutos depois — a conferência é
        humana e sai muito além disso. Enquanto `/meu-pedido` descartava
        qualquer pedido vencido, esse cliente recarregava a página e recebia
        `{"pedido": null}`: a tela não reconhecia o aviso, emitia uma cobrança
        nova com outro txid e o convidava a pagar de novo pelo mesmo acesso —
        exatamente o segundo PIX que o resto deste módulo evita.

        `_publico` já concordava com isto: ele só carimba "expirado" em pedido
        `aguardando`. Era a rota que discordava.
        """
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        self._recuar_no_tempo(pedido["txid"], horas=2)

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual is not None, "o aviso sumiu com o prazo do código e a tela emitiria outra cobrança"
        assert atual["id"] == pedido["id"]
        assert atual["status"] == "avisado", "aviso pendente não vira 'expirado'"

    def test_aviso_pendente_nao_ganha_segunda_cobranca(self, client):
        """A outra porta para o mesmo defeito, esta em `POST /pedido`.

        Voltar ao checkout do mesmo plano depois do prazo (o que acontece ao
        trocar de plano e voltar, quando a comparação de plano do frontend
        manda emitir) abria uma cobrança nova enquanto a que o cliente pagou
        ficava `avisado` no banco, invisível para ele: `/meu-pedido` devolve o
        pedido mais recente, e o mais recente passava a ser a cobrança nova.
        """
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        self._recuar_no_tempo(pedido["txid"], horas=2)

        de_novo = _criar_pedido(client, headers)
        assert de_novo["id"] == pedido["id"], "abriu uma segunda cobrança por cima de um PIX já avisado"
        assert de_novo["txid"] == pedido["txid"]

    def test_codigo_vencido_sem_aviso_ainda_gera_cobranca_nova(self, client):
        """O contrapeso do teste acima — sem ele a correção compraria silêncio.

        Quem deixou o prazo passar SEM avisar continua precisando de um código
        novo. Se o reaproveitamento passasse a valer para todo pedido em
        aberto, este cliente receberia de volta um código vencido e não teria
        como pagar.
        """
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        self._recuar_no_tempo(pedido["txid"], horas=2)

        outro = _criar_pedido(client, headers)
        assert outro["id"] != pedido["id"], "o código venceu sem aviso: tinha de sair cobrança nova"
        assert outro["status"] == "aguardando"

    def test_aviso_orfao_de_outro_plano_nao_esconde_a_liberacao(self, client, _email_falso):
        """Cobrar de novo um plano que já está pago e ativo.

        Quem clica "já fiz o PIX" e nunca paga deixa um pedido `avisado` que
        fica em aberto para sempre — e o reaproveitamento do pedido avisado o
        torna permanente. Enquanto a rota entregava "cobrança em aberto antes
        de tudo", esse órfão era devolvido no lugar da liberação do plano
        comprado depois. A tela compara o plano, não reconhecia o órfão como
        dela e emitia cobrança nova: segundo PIX por um acesso já liberado.
        """
        headers, _ = _cadastrar(client)
        orfao = _criar_pedido(client, headers, plano="pro")
        client.post("/api/payments/pix/avisei", json={"pedidoId": orfao["id"]}, headers=headers)

        pago = self._confirmar(client, headers, _email_falso, plano="premium")

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual["id"] == pago["id"], "o aviso órfão escondeu a liberação do plano pago"
        assert atual["status"] == "confirmado"
        assert atual["plano"] == "premium"

    def test_aviso_pendente_vencido_ainda_traz_o_codigo(self, client):
        """A tela reexibe o código deste pedido, então ele precisa vir aqui.

        Depois de `avisei`, a tela esconde o código e oferece "avisei sem
        querer — mostrar o código de novo". Enquanto o vencimento também
        desligava esse botão, quem clicou por engano ficava sem forma nenhuma
        de pagar: `POST /pedido` reaproveita o pedido avisado, então recarregar
        devolvia a mesma tela sem código. O botão voltou a valer para pedido
        avisado, e ele mostra o `brcode` desta resposta — se a rota parar de
        mandá-lo, a tela fica com o aviso e sem o que exibir.

        Vale porque o BR Code não carrega validade: o payload leva chave, valor
        e txid (ver `api/pix_brcode.py`), então o mesmo código continua pagável
        e continua caindo no mesmo pedido na hora da conferência.
        """
        headers, _ = _cadastrar(client)
        pedido = _criar_pedido(client, headers)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=headers)
        self._recuar_no_tempo(pedido["txid"], horas=2)

        atual = client.get("/api/payments/pix/meu-pedido", headers=headers).json()["pedido"]
        assert atual["brcode"] == pedido["brcode"], "sem código a tela não tem o que reexibir"
        assert atual["chave"] == "digitalfistpower@gmail.com"
        assert atual["txid"] == pedido["txid"], "outro txid quebraria a conciliação do que já foi pago"

    def test_liberacao_pelo_painel_tambem_chega_na_tela_do_cliente(self, client):
        """O outro caminho de confirmação — e ele depende de um carimbo.

        A janela de seis horas é medida por `confirmado_em`, e sem data
        `_confirmado_ha_pouco` responde "não". Se a confirmação pelo painel
        deixasse de carimbar o campo, a rota voltaria a devolver `null` para
        quem acabou de ser liberado: a tela do cliente ficaria em "aguardando a
        conferência" outra vez, e por um motivo invisível — o acesso está ativo
        e nada estoura.
        """
        cliente, _ = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=cliente)

        admin, _ = _cadastrar(client, admin=True)
        r = client.post(f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", json={}, headers=admin)
        assert r.status_code == 200, r.text

        atual = client.get("/api/payments/pix/meu-pedido", headers=cliente).json()["pedido"]
        assert atual is not None, "liberado pelo painel, o cliente via a tela de espera para sempre"
        assert atual["id"] == pedido["id"]
        assert atual["status"] == "confirmado"
        assert atual["confirmadoEm"], "sem carimbo a janela de exibição não tem como ser medida"

    def test_ninguem_ve_o_pedido_de_outro(self, client, _email_falso):
        headers, _ = _cadastrar(client)
        self._confirmar(client, headers, _email_falso)

        intruso, _ = _cadastrar(client)
        assert client.get("/api/payments/pix/meu-pedido", headers=intruso).json()["pedido"] is None

    def test_exige_login(self, client):
        r = client.get("/api/payments/pix/meu-pedido")
        assert r.status_code in (401, 403)


def _rodar_codigo_vencido(casos):
    """Executa o `pix.ts` do frontend no Node e devolve o que ele respondeu.

    O Node 22+ remove as anotações de tipo sozinho, então o arquivo publicado
    roda sem build — é ele que responde, não uma tradução dele para Python.
    Mesma técnica de `tests/test_fuso_do_laudo.py`.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("Node não encontrado no PATH — a regra de prazo da tela não foi exercitada")

    versao = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=60)
    maior = int(re.sub(r"^v", "", versao.stdout.strip()).split(".")[0] or 0)
    if maior < 22:
        pytest.skip(f"Node {versao.stdout.strip()} não remove tipos de .ts (precisa de 22+)")

    driver = f"""
    import {{ codigoVencido }} from {json.dumps(PIX_TS.as_uri())};
    const saida = {json.dumps(casos)}.map(([status, restante]) => codigoVencido(status, restante));
    process.stdout.write(JSON.stringify(saida));
    """
    r = subprocess.run(
        [node, "--input-type=module", "-e", driver],
        capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    # Falha do Node é falha do teste, nunca lista vazia: erro engolido aqui
    # transformaria "a tela não foi verificada" em "a tela passou".
    assert r.returncode == 0, f"o Node não conseguiu executar {PIX_TS.name}:\n{r.stderr}"
    return json.loads(r.stdout)


class TestOPrazoDaTelaDePix:
    """Quem decide se a tela ainda oferece um código pagável.

    A resposta da API sozinha não fecha esta questão: o contador local vence
    entre uma resposta e outra, e é a combinação dos dois que a tela usa. Como a
    regra decide entre "pague por aqui" e "não há mais o que pagar", ela é
    exercitada de verdade, no arquivo que o navegador carrega.
    """

    def test_cobranca_em_dia_oferece_o_codigo(self):
        assert _rodar_codigo_vencido([["aguardando", 900_000]]) == [False]

    def test_o_contador_local_derruba_o_codigo(self):
        """Sem este juiz, a tela ofereceria por minutos um código já vencido —
        até a próxima resposta do servidor."""
        assert _rodar_codigo_vencido([["aguardando", 0], ["aguardando", -1]]) == [True, True]

    def test_o_carimbo_do_servidor_derruba_o_codigo(self):
        """E sem ESTE, um relógio local adiantado esconderia o vencimento."""
        assert _rodar_codigo_vencido([["expirado", 900_000]]) == [True]

    def test_contador_ainda_sem_leitura_nao_e_vencimento(self):
        """`null` é "ainda não sei": a cobrança acabou de chegar e o contador
        não rodou. Tratar como vencido esconderia o código de uma cobrança boa
        no primeiro quadro."""
        assert _rodar_codigo_vencido([["aguardando", None]]) == [False]

    def test_aviso_ja_dado_nao_vence(self):
        """A regressão que custa dinheiro.

        Quem clicou "já fiz o PIX" — inclusive por engano — via o botão de
        rever o código sumir no minuto 30. E `POST /pedido` reaproveita o
        pedido avisado, então recarregar a página devolvia a mesma tela sem
        código: nenhuma forma de pagar, para sempre. O prazo é do código, não
        do aviso; o servidor concorda e continua mandando o mesmo `brcode`.
        """
        assert _rodar_codigo_vencido([["avisado", -7_200_000], ["avisado", None]]) == [False, False]

    def test_pagamento_conferido_nao_vence(self):
        """"Expirou, gere outro" para quem já foi liberado convida ao segundo
        PIX pelo mesmo acesso."""
        assert _rodar_codigo_vencido([["confirmado", -1]]) == [False]


class TestPainelAdmin:
    @pytest.fixture()
    def alvos_reais(self, client):
        """Rotas administrativas apontadas para recursos que EXISTEM.

        A primeira versão deste teste usava `/pedidos-pix/1/cancelar` com um id
        inventado. Removida a guarda do router de propósito, ele continuou
        passando: a rota respondia 404 por "pedido não encontrado", e o teste
        lia isso como "bloqueado". Um id que não existe torna a falta de
        autorização indistinguível da falta do recurso — e o teste vira
        decoração.

        Com pedido e usuário reais, 404 só pode vir da guarda.
        """
        cliente, email = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)

        from db.database import SessionLocal
        from db.models import User
        db = SessionLocal()
        try:
            user_id = db.query(User).filter(User.email == email).first().id
        finally:
            db.close()

        return [
            ("get", "/api/admin/resumo", None),
            ("get", "/api/admin/pedidos-pix", None),
            ("get", "/api/admin/usuarios", None),
            ("post", f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", {}),
            ("post", f"/api/admin/pedidos-pix/{pedido['id']}/cancelar", {}),
            ("post", f"/api/admin/usuarios/{user_id}/plano", {"plano": "premium"}),
        ]

    def test_nenhuma_rota_admin_responde_a_anonimo(self, client, alvos_reais):
        for metodo, rota, corpo in alvos_reais:
            r = (getattr(client, metodo)(rota, json=corpo) if corpo is not None
                 else getattr(client, metodo)(rota))
            assert r.status_code in (401, 403, 404), f"{rota} respondeu {r.status_code} para anônimo"

    def test_nenhuma_rota_admin_responde_a_usuario_comum(self, client, alvos_reais):
        """Cada rota daqui expõe dados de todos os clientes ou concede acesso
        pago. Uma esquecida sem guarda vale mais para um atacante do que
        qualquer outra falha da API."""
        headers, _ = _cadastrar(client)
        for metodo, rota, corpo in alvos_reais:
            r = (getattr(client, metodo)(rota, json=corpo, headers=headers) if corpo is not None
                 else getattr(client, metodo)(rota, headers=headers))
            assert r.status_code == 404, f"{rota} respondeu {r.status_code} para usuário comum"

    def test_o_usuario_comum_nao_conseguiu_efeito_nenhum(self, client, alvos_reais):
        """404 sem efeito colateral. Uma rota pode recusar a RESPOSTA e ainda
        assim ter executado a ação — e neste conjunto isso significaria plano
        liberado de graça."""
        headers, email = _cadastrar(client)
        for metodo, rota, corpo in alvos_reais:
            if corpo is not None:
                getattr(client, metodo)(rota, json=corpo, headers=headers)

        assert client.get("/api/auth/me", headers=headers).json()["plan"] == "free"

    def test_admin_ve_o_pedido_que_espera_confirmacao(self, client, _email_falso):
        cliente, email = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)
        client.post("/api/payments/pix/avisei", json={"pedidoId": pedido["id"]}, headers=cliente)

        admin, _ = _cadastrar(client, admin=True)
        r = client.get("/api/admin/pedidos-pix?status=avisado", headers=admin)
        assert r.status_code == 200
        assert any(p["txid"] == pedido["txid"] for p in r.json()["pedidos"])

    def test_admin_libera_pelo_painel(self, client):
        cliente, _ = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)
        admin, _ = _cadastrar(client, admin=True)

        r = client.post(f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", json={}, headers=admin)
        assert r.status_code == 200, r.text
        assert client.get("/api/auth/me", headers=cliente).json()["plan"] == "premium"

    def test_quem_liberou_fica_registrado(self, client):
        """Numa conferência de caixa, "confirmado" sem autor não responde a
        pergunta que importa."""
        cliente, _ = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)
        admin, _ = _cadastrar(client, admin=True)
        client.post(f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", json={}, headers=admin)

        r = client.get("/api/admin/pedidos-pix", headers=admin)
        registro = next(p for p in r.json()["pedidos"] if p["id"] == pedido["id"])
        assert registro["confirmadoPor"].startswith("admin:")

    def test_confirmar_duas_vezes_pelo_painel_nao_dobra_o_acesso(self, client):
        cliente, email = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)
        admin, _ = _cadastrar(client, admin=True)

        client.post(f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", json={}, headers=admin)

        from db.database import SessionLocal
        from db.models import User
        db = SessionLocal()
        try:
            validade = db.query(User).filter(User.email == email).first().subscription.current_period_end
        finally:
            db.close()

        client.post(f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", json={}, headers=admin)
        db = SessionLocal()
        try:
            depois = db.query(User).filter(User.email == email).first().subscription.current_period_end
        finally:
            db.close()
        assert depois == validade

    def test_cancelar_pedido_ja_pago_e_recusado(self, client):
        """Cancelar cobrança não é retirar acesso. Juntar as duas coisas numa
        ação só é como se retira acesso de quem pagou."""
        cliente, _ = _cadastrar(client)
        pedido = _criar_pedido(client, cliente)
        admin, _ = _cadastrar(client, admin=True)
        client.post(f"/api/admin/pedidos-pix/{pedido['id']}/confirmar", json={}, headers=admin)

        r = client.post(f"/api/admin/pedidos-pix/{pedido['id']}/cancelar", json={}, headers=admin)
        assert r.status_code == 409
        assert client.get("/api/auth/me", headers=cliente).json()["plan"] == "premium"

    def test_troca_manual_de_plano(self, client):
        cliente, email = _cadastrar(client)
        admin, _ = _cadastrar(client, admin=True)

        from db.database import SessionLocal
        from db.models import User
        db = SessionLocal()
        try:
            user_id = db.query(User).filter(User.email == email).first().id
        finally:
            db.close()

        r = client.post(f"/api/admin/usuarios/{user_id}/plano", json={"plano": "premium"}, headers=admin)
        assert r.status_code == 200, r.text
        assert client.get("/api/auth/me", headers=cliente).json()["plan"] == "premium"

    def test_rebaixar_para_free_desliga_o_espelho_tambem(self, client):
        """`User.subscription_status` é lido pelo frontend. Deixá-lo "active"
        com a assinatura cancelada faz o cliente continuar vendo o plano
        antigo."""
        cliente, email = _cadastrar(client)
        admin, _ = _cadastrar(client, admin=True)

        from db.database import SessionLocal
        from db.models import User
        db = SessionLocal()
        try:
            user_id = db.query(User).filter(User.email == email).first().id
        finally:
            db.close()

        client.post(f"/api/admin/usuarios/{user_id}/plano", json={"plano": "premium"}, headers=admin)
        client.post(f"/api/admin/usuarios/{user_id}/plano", json={"plano": "free"}, headers=admin)

        me = client.get("/api/auth/me", headers=cliente).json()
        assert me["plan"] == "free"
        assert me["subscription_status"] != "active"

    def test_plano_inventado_e_recusado(self, client):
        admin, _ = _cadastrar(client, admin=True)
        r = client.post("/api/admin/usuarios/1/plano", json={"plano": "vitalicio"}, headers=admin)
        assert r.status_code == 400
