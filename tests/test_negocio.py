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

    def test_preco_vem_das_variaveis_com_sufixo_brl(self):
        from api.payments import PRICES
        assert PRICES["pro"] == 97.0
        assert PRICES["premium"] == 247.0


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
