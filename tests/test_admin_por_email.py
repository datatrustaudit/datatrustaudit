"""Contas administradoras definidas por e-mail.

A lista decide quem tem acesso irrestrito ao produto e ao painel — e o painel
libera plano pago. Errar para o lado de promover demais não volta; errar para
o lado de não promover é recuperável (define-se a variável e segue). Por isso
tudo aqui verifica os dois lados: quem entra, e principalmente quem NÃO entra.
"""
import os
import uuid

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.auth import emails_administradores, promover_se_for_administrador


class _Conta:
    """Só o que a promoção lê — evita depender do banco para testar a regra."""

    def __init__(self, email, is_admin=False):
        self.email = email
        self.is_admin = is_admin


class TestQuemEntraNaLista:
    def test_email_da_lista_e_promovido(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAILS", "dono@exemplo.com")
        conta = _Conta("dono@exemplo.com")
        assert promover_se_for_administrador(conta) is True
        assert conta.is_admin is True

    def test_lista_com_varios_emails(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAILS", "um@exemplo.com, dois@exemplo.com ,tres@exemplo.com")
        assert emails_administradores() == {"um@exemplo.com", "dois@exemplo.com", "tres@exemplo.com"}

    def test_maiuscula_e_espaco_nao_impedem(self, monkeypatch):
        """E-mail digitado no cadastro raramente casa byte a byte com o que
        alguém escreveu no .env."""
        monkeypatch.setenv("ADMIN_EMAILS", " Dono@Exemplo.com ")
        conta = _Conta("dono@exemplo.com")
        assert promover_se_for_administrador(conta) is True

    def test_promover_quem_ja_e_admin_nao_mexe_em_nada(self, monkeypatch):
        """O retorno False é o que evita um `commit` a cada requisição
        autenticada — a promoção roda em todas elas."""
        monkeypatch.setenv("ADMIN_EMAILS", "dono@exemplo.com")
        assert promover_se_for_administrador(_Conta("dono@exemplo.com", is_admin=True)) is False


class TestQuemFicaDeFora:
    def test_variavel_vazia_nao_promove_ninguem(self, monkeypatch):
        """Falha FECHADA. Um padrão embutido no código promoveria contas em
        qualquer deploy que esquecesse de definir a variável — e o repositório
        é público."""
        monkeypatch.setenv("ADMIN_EMAILS", "")
        assert emails_administradores() == set()
        assert promover_se_for_administrador(_Conta("qualquer@exemplo.com")) is False

    def test_variavel_ausente_nao_promove_ninguem(self, monkeypatch):
        monkeypatch.delenv("ADMIN_EMAILS", raising=False)
        assert promover_se_for_administrador(_Conta("qualquer@exemplo.com")) is False

    def test_email_fora_da_lista_nao_entra(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAILS", "dono@exemplo.com")
        conta = _Conta("estranho@exemplo.com")
        assert promover_se_for_administrador(conta) is False
        assert conta.is_admin is False

    def test_nao_basta_conter_o_email_da_lista(self, monkeypatch):
        """Casar por substring deixaria "dono@exemplo.com.br" e
        "outrodono@exemplo.com" entrarem — domínios que qualquer um registra."""
        monkeypatch.setenv("ADMIN_EMAILS", "dono@exemplo.com")
        for impostor in ("dono@exemplo.com.br", "outrodono@exemplo.com", "dono@exemplo.como"):
            assert promover_se_for_administrador(_Conta(impostor)) is False, impostor

    def test_conta_sem_email_nao_estoura(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAILS", "dono@exemplo.com")
        assert promover_se_for_administrador(_Conta(None)) is False
        assert promover_se_for_administrador(None) is False

    def test_virgula_solta_nao_vira_email_vazio(self, monkeypatch):
        """`"a@x.com,,"` gerando `""` na lista faria toda conta sem e-mail
        virar administradora."""
        monkeypatch.setenv("ADMIN_EMAILS", "a@x.com,, ,")
        assert emails_administradores() == {"a@x.com"}


class TestEfeitoNaConta:
    """Admin não precisa de assinatura: `User.plan` e o limite semanal já
    consultam `is_admin`. Criar uma assinatura falsa apareceria no painel
    como venda que nunca houve."""

    def _cadastrar(self, client, email):
        r = client.post("/api/auth/register", json={
            "email": email, "password": "SenhaForte#2026", "name": "Dono",
        })
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    def test_cadastro_na_lista_ja_nasce_premium_e_ilimitado(self, client, monkeypatch):
        email = f"dono-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        monkeypatch.setenv("ADMIN_EMAILS", email)

        me = client.get("/api/auth/me", headers=self._cadastrar(client, email)).json()
        assert me["is_admin"] is True
        assert me["plan"] == "premium"
        assert me["scans_limit"] == -1

    def test_conta_antiga_e_promovida_ao_usar_o_sistema(self, client, monkeypatch):
        """As contas da lista podem existir de antes de a variável ser
        definida — a promoção precisa alcançá-las sem recadastro."""
        email = f"antigo-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        monkeypatch.delenv("ADMIN_EMAILS", raising=False)
        headers = self._cadastrar(client, email)
        assert client.get("/api/auth/me", headers=headers).json()["is_admin"] is False

        monkeypatch.setenv("ADMIN_EMAILS", email)
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["is_admin"] is True
        assert me["plan"] == "premium"

    def test_admin_alcanca_o_painel(self, client, monkeypatch):
        email = f"painel-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        monkeypatch.setenv("ADMIN_EMAILS", email)
        headers = self._cadastrar(client, email)

        assert client.get("/api/admin/resumo", headers=headers).status_code == 200

    def test_quem_nao_esta_na_lista_nao_alcanca_o_painel(self, client, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAILS", "outro@exemplo.com")
        headers = self._cadastrar(client, f"comum-{uuid.uuid4().hex[:8]}@datatrust-teste.com")

        assert client.get("/api/admin/resumo", headers=headers).status_code == 404
        assert client.get("/api/auth/me", headers=headers).json()["plan"] == "free"

    def test_promover_nao_cria_assinatura_paga(self, client, monkeypatch):
        """O resumo do painel soma o que foi vendido. Uma assinatura paga
        criada só para dar acesso ao dono entraria nessa conta como venda.

        Toda conta nasce com uma `Subscription` — o construtor do User define
        `plan="free"`, e o setter cria uma, cujo status tem "active" como
        padrão da coluna. O que não pode existir é `plan_name` pago.
        """
        email = f"semvenda-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        monkeypatch.setenv("ADMIN_EMAILS", email)
        headers = self._cadastrar(client, email)

        from db.database import SessionLocal
        from db.models import Subscription, User
        db = SessionLocal()
        try:
            u = db.query(User).filter(User.email == email).first()
            assinatura = db.query(Subscription).filter(Subscription.user_id == u.id).first()
        finally:
            db.close()

        assert assinatura is None or assinatura.plan_name in (None, "free"), (
            f"a promoção a admin criou assinatura de plano {assinatura.plan_name!r} — "
            "ela apareceria no painel como venda que nunca houve"
        )

    def test_o_painel_nao_conta_conta_gratuita_como_pagante(self, client, monkeypatch):
        """`Subscription.status == "active"` sozinho contava TODO MUNDO: toda
        conta nova nasce com uma assinatura ativa de plano gratuito. O painel
        exibiria dezenas de pagantes com zero venda."""
        email = f"resumo-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        monkeypatch.setenv("ADMIN_EMAILS", email)
        admin = self._cadastrar(client, email)

        antes = client.get("/api/admin/resumo", headers=admin).json()["pagantes"]
        self._cadastrar(client, f"gratuito-{uuid.uuid4().hex[:8]}@datatrust-teste.com")
        depois = client.get("/api/admin/resumo", headers=admin).json()["pagantes"]

        assert depois == antes, "um cadastro gratuito entrou na contagem de pagantes"
