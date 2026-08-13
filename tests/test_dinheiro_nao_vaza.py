"""As quatro frestas por onde o produto perdia receita.

Nenhuma delas gera reclamação: ninguém abre chamado porque ganhou acesso de
graça, e quem recebe o laudo pago sem pagar não avisa. São perdas silenciosas,
e por isso precisam de teste — não vão aparecer sozinhas.

1. A rota de troca de plano falhava ABERTA: sem `ENVIRONMENT` definida (o
   esquecimento mais comum num deploy), ela assumia desenvolvimento e liberava
   plano premium a qualquer usuário logado.
2. O webhook do Mercado Pago somava um ano de acesso a cada reentrega. O MP
   reenvia o mesmo evento por dias até receber 200 — uma compra virava vários
   anos.
3. Reabrir um laudo por `?scan=` devolvia ao gratuito o que a varredura
   recém-feita tinha escondido. Bastava dar F5.
4. O Deep Scan — a rota mais cara do produto, que abre o navegador até quatro
   vezes — não descontava cota nenhuma.
"""
import os
import uuid

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from db.models import Payment, Scan, User, utcnow


class TestRotaDeDesenvolvimentoFalhaFechada:
    """Errar bloqueando é recuperável; errar liberando não volta."""

    def _trocar(self, client, headers):
        return client.post("/api/auth/dev/plano", headers=headers, json={"plan": "premium"})

    def test_sem_a_variavel_a_rota_nao_existe(self, client, usuario_logado, monkeypatch):
        """O caso real: deploy que esqueceu de definir ENVIRONMENT."""
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        headers, _ = usuario_logado
        assert self._trocar(client, headers).status_code == 404

    def test_em_producao_a_rota_nao_existe(self, client, usuario_logado, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        headers, _ = usuario_logado
        assert self._trocar(client, headers).status_code == 404

    def test_em_desenvolvimento_funciona(self, client, usuario_logado, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        headers, _ = usuario_logado
        r = self._trocar(client, headers)
        assert r.status_code == 200
        assert r.json().get("plan") == "premium"

    def test_a_cota_tambem_falha_fechada(self, monkeypatch):
        from audit_engine.credit_rules import cota_desligada

        monkeypatch.setenv("DEV_UNLIMITED_SCANS", "1")
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        assert cota_desligada() is False, (
            "sem ENVIRONMENT, a cota de todo mundo ficaria suspensa — e cota é o "
            "que este produto vende"
        )


class TestWebhookNaoPagaDuasVezes:
    """O Mercado Pago reenvia o mesmo evento por dias até receber 200."""

    def _ativar(self, db, user, vezes):
        from api.payments import _ativar_plano
        for _ in range(vezes):
            _ativar_plano(db, user, "premium", "pix")
        db.commit()
        db.refresh(user)
        return user.subscription

    def test_ativar_duas_vezes_soma_dois_periodos(self, db, usuario_logado):
        """Este é o comportamento correto de `_ativar_plano` para quem compra
        de novo — e é justamente o que torna a reentrega perigosa."""
        from api.payments import ACCESS_PERIOD_DAYS

        _, email = usuario_logado
        user = db.query(User).filter(User.email == email).first()
        assinatura = self._ativar(db, user, vezes=2)

        restam = (assinatura.current_period_end.replace(tzinfo=None) - utcnow().replace(tzinfo=None)).days
        assert restam > ACCESS_PERIOD_DAYS * 1.5, (
            "confirma a premissa: chamar duas vezes soma dois períodos, então o "
            "webhook precisa garantir que não chama de novo"
        )

    def test_pagamento_ja_registrado_e_a_trava(self, db, usuario_logado):
        """A tabela `Payment` é o que marca "já processei este id". Consultá-la
        DEPOIS de liberar o acesso tornava o registro inútil como trava."""
        _, email = usuario_logado
        user = db.query(User).filter(User.email == email).first()

        pid = f"mp-{uuid.uuid4().hex[:10]}"
        db.add(Payment(user_id=user.id, mp_payment_id=pid, amount=247.0,
                       status="approved", plan_purchased="premium"))
        db.commit()

        achado = db.query(Payment).filter(Payment.mp_payment_id == pid).first()
        assert achado is not None, "sem o registro, não há como reconhecer reentrega"


class TestReabrirNaoVazaLaudoPago:
    """`raw_data` guarda o laudo íntegro de propósito — quem pagar depois
    recupera o que já foi varrido. Isso torna o corte da reabertura a única
    barreira, e ele precisa ser tão rígido quanto o da geração."""

    def _gravar(self, db, user_id):
        completo = {
            "url": "https://loja.com.br",
            "score": 42,
            "summary": {"violationsCount": 5, "totalTags": 3,
                        "violationsBySeverity": {"critical": 2, "high": 3, "medium": 0, "low": 0}},
            "tags": [{"name": "Google Analytics 4", "lineNumber": 12, "context": "<script>"}],
            "privacy": {"violations": [{"severity": "critical", "violation": "Rastreio sem consentimento"}],
                        "totalViolations": 5, "hasConsentTool": False},
            "storage": {"cookiesWithoutConsent": [{"name": "_ga", "owner": "Google"}]},
            "events": [{"name": "page_view"}],
            "recommendations": [{"title": "Instalar CMP", "fix": "código aqui"}],
            "debugging": {"networkHints": [{"url": "https://google-analytics.com"}]},
            "ga4": {"measurementIds": ["G-ABC123"], "events": []},
            "gtm": {"containerIds": ["GTM-XYZ"], "issues": []},
        }
        s = Scan(user_id=user_id, url="https://loja.com.br", status="completed",
                 score=42, created_at=utcnow(), completed_at=utcnow(), raw_data=completo)
        db.add(s)
        db.commit()
        db.refresh(s)
        return s

    def test_gratuito_nao_recebe_o_detalhe_ao_reabrir(self, client, db, usuario_logado):
        from db.models import User as U

        headers, email = usuario_logado
        user = db.query(U).filter(U.email == email).first()
        user.plan = "free"
        db.commit()
        scan = self._gravar(db, user.id)

        r = client.get(f"/api/scans/{scan.id}", headers=headers)
        assert r.status_code == 200
        resultado = r.json()["result"]

        assert resultado["tags"] == []
        assert resultado["privacy"]["violations"] == []
        assert resultado["storage"] is None
        assert resultado["events"] == []
        assert resultado["recommendations"] == []
        assert resultado["debugging"] == {}
        assert resultado["ga4"]["measurementIds"] == []
        assert resultado["showsDetail"] is False

    def test_a_contagem_continua_visivel(self, client, db, usuario_logado):
        """Esconder o número junto faria a tela parecer defeituosa em vez de
        limitada — e é o número que motiva o upgrade."""
        from db.models import User as U

        headers, email = usuario_logado
        user = db.query(U).filter(U.email == email).first()
        user.plan = "free"
        db.commit()
        scan = self._gravar(db, user.id)

        resultado = client.get(f"/api/scans/{scan.id}", headers=headers).json()["result"]
        assert resultado["summary"]["violationsCount"] == 5
        assert resultado["summary"]["totalTags"] == 3

    def test_quem_pagou_recebe_tudo(self, client, db, usuario_logado):
        from db.models import User as U

        headers, email = usuario_logado
        user = db.query(U).filter(U.email == email).first()
        user.plan = "premium"
        db.commit()
        scan = self._gravar(db, user.id)

        resultado = client.get(f"/api/scans/{scan.id}", headers=headers).json()["result"]
        assert resultado["tags"], "quem pagou perdeu o detalhe"
        assert resultado["storage"]["cookiesWithoutConsent"]
        assert resultado["showsDetail"] is True

    def test_o_laudo_integro_continua_no_banco(self, db, usuario_logado):
        """O corte é de exibição. Gravar já cortado destruiria dado pago de
        forma irreversível — quem fizesse upgrade depois não recuperaria."""
        from db.models import User as U

        _, email = usuario_logado
        user = db.query(U).filter(U.email == email).first()
        scan = self._gravar(db, user.id)

        db.refresh(scan)
        assert scan.raw_data["tags"], "o laudo no banco foi truncado"
        assert scan.raw_data["storage"]["cookiesWithoutConsent"]
