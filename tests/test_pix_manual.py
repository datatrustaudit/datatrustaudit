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
import os
import uuid

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)


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
