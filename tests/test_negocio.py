"""Regressão das regras de negócio: preço, validade da assinatura e webhook."""
import hashlib
import hmac
from datetime import timedelta

import pytest

from db.models import User, Subscription, utcnow


def _usuario(db, email, **assinatura):
    u = User(email=email, hashed_password="hash-irrelevante-no-teste")
    db.add(u)
    db.flush()
    if assinatura:
        db.add(Subscription(user_id=u.id, **assinatura))
    db.commit()
    db.refresh(u)
    return u


class TestPrecos:
    """O código lia PRICE_PRO/PRICE_PREMIUM; o .env define PRICE_PRO_BRL/
    PRICE_PREMIUM_BRL. Nunca batiam, então valia o default embutido — premium
    era cobrado a 297 com o .env configurado a 247."""

    def test_preco_mensal_vem_das_variaveis_com_sufixo_brl(self):
        from api.payments import PRICES
        assert PRICES["monthly"]["pro"] == 97.0
        assert PRICES["monthly"]["premium"] == 247.0

    def test_preco_anual_tem_desconto_sobre_o_mensal(self):
        from api.payments import PRICES
        for plano in ("pro", "premium"):
            anual = PRICES["annual"][plano]
            doze_meses = PRICES["monthly"][plano] * 12
            assert 0 < anual < doze_meses, f"{plano}: anual ({anual}) deveria ser menor que 12x mensal ({doze_meses})"

    def test_endpoint_de_planos_e_a_fonte_unica_do_frontend(self, client):
        """Havia três tabelas de preço divergentes: api/payments.py,
        SubscriptionContext.tsx e pricing.config.ts. O cliente via R$ 49,90 na
        tela e o checkout cobrava R$ 97."""
        from api.payments import PRICES
        corpo = client.get("/api/payments/plans").json()
        assert corpo["currency"] == "BRL"
        for plano in ("free", "pro", "premium"):
            assert corpo["plans"][plano]["monthly"] == PRICES["monthly"][plano]
            assert corpo["plans"][plano]["annual"] == PRICES["annual"][plano]


class TestCicloDeCobranca:
    def test_ciclo_invalido_e_recusado(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = client.post("/api/payments/create-preference",
                        json={"plan": "pro", "billing_cycle": "decenal"}, headers=headers)
        assert r.status_code == 400

    def test_plano_invalido_e_recusado(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = client.post("/api/payments/create-preference",
                        json={"plan": "vitalicio"}, headers=headers)
        assert r.status_code == 400

    def test_checkout_exige_autenticacao(self, client):
        r = client.post("/api/payments/create-preference", json={"plan": "pro"})
        assert r.status_code == 401

    def test_validade_anual_e_maior_que_a_mensal(self, db):
        """O ciclo viaja no external_reference; sem ele, quem pagasse o anual
        receberia validade de 30 dias."""
        from api.payments import _ativar_plano
        mensal = _usuario(db, "mensal@exemplo-teste.com")
        anual = _usuario(db, "anual@exemplo-teste.com")
        _ativar_plano(db, mensal, "pro", "monthly")
        _ativar_plano(db, anual, "pro", "annual")
        db.commit()
        assert anual.subscription.current_period_end > mensal.subscription.current_period_end


class TestValidadeDaAssinatura:
    """`plan` devolvia plan_name direto: status e current_period_end não eram
    consultados em lugar nenhum, então um pagamento único valia para sempre."""

    def test_assinatura_ativa_e_vigente_vale(self, db):
        u = _usuario(db, "vigente@exemplo-teste.com", plan_name="pro", status="active",
                     current_period_end=utcnow() + timedelta(days=10))
        assert u.plan == "pro"

    def test_assinatura_vencida_cai_para_free(self, db):
        u = _usuario(db, "vencida@exemplo-teste.com", plan_name="pro", status="active",
                     current_period_end=utcnow() - timedelta(days=1))
        assert u.plan == "free"

    @pytest.mark.parametrize("situacao", ["canceled", "past_due"])
    def test_assinatura_inativa_cai_para_free(self, db, situacao):
        u = _usuario(db, f"{situacao}@exemplo-teste.com", plan_name="premium", status=situacao,
                     current_period_end=utcnow() + timedelta(days=10))
        assert u.plan == "free"

    def test_sem_assinatura_e_free(self, db):
        assert _usuario(db, "sem-plano@exemplo-teste.com").plan == "free"


class TestWebhookMercadoPago:
    def test_pagamento_aprovado_carimba_validade(self, db):
        from api.payments import _ativar_plano
        u = _usuario(db, "pagante@exemplo-teste.com")
        _ativar_plano(db, u, "pro")
        db.commit()
        db.refresh(u)
        assert u.plan == "pro"
        assert u.subscription.current_period_end is not None, "assinatura sem validade = acesso vitalício"

    def test_plano_desconhecido_e_ignorado(self, db):
        from api.payments import _ativar_plano
        u = _usuario(db, "plano-estranho@exemplo-teste.com", plan_name="pro", status="active",
                     current_period_end=utcnow() + timedelta(days=10))
        _ativar_plano(db, u, "plano-inventado")
        db.commit()
        db.refresh(u)
        assert u.plan == "pro"

    def test_assinatura_hmac(self, monkeypatch):
        """MP_WEBHOOK_SECRET era lido no topo do módulo e nunca usado: a rota
        aceitava POST de qualquer origem."""
        import importlib
        monkeypatch.setenv("MP_WEBHOOK_SECRET", "segredo-do-mp")
        import api.payments as pagamentos
        importlib.reload(pagamentos)

        manifest = "id:12345;request-id:req-1;ts:1700000000;"
        correta = hmac.new(b"segredo-do-mp", manifest.encode(), hashlib.sha256).hexdigest()

        assert pagamentos._assinatura_valida("12345", f"ts=1700000000,v1={correta}", "req-1")
        assert not pagamentos._assinatura_valida("12345", "ts=1700000000,v1=deadbeef", "req-1")
        assert not pagamentos._assinatura_valida("12345", "", "req-1")
        # id trocado invalida o manifest
        assert not pagamentos._assinatura_valida("99999", f"ts=1700000000,v1={correta}", "req-1")
