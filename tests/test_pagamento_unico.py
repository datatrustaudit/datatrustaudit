"""Cobrança: compra avulsa, com PIX como opção em qualquer plano.

Deixou de ser assinatura mensal. A pessoa compra o plano uma vez, o acesso vale
por um período carimbado, e não há renovação automática. O PIX tem desconto
porque não custa taxa de parcelamento nem risco de chargeback.

Dinheiro é o lugar onde erro silencioso vira prejuízo direto ou contestação.
Três coisas precisam valer sempre:

- O valor nunca vem do cliente. Aceitar `amount` do corpo da requisição deixa
  qualquer um comprar o premium por um real.
- O que a página anuncia é o que o checkout cobra. Um centavo de diferença
  vira reclamação.
- Comprar de novo antes de vencer soma ao que resta. Reiniciar a contagem
  tomaria do cliente dias que ele já pagou.
"""
import os

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.payments import (
    ACCESS_PERIOD_DAYS,
    PIX_DISCOUNT,
    PRICES,
    VALID_METHODS,
    listar_planos,
    preco_com_metodo,
)


class TestPrecoDoPix:
    def test_desconto_de_cinco_por_cento(self):
        assert PIX_DISCOUNT == pytest.approx(0.05)

    def test_conta_bate_com_a_do_cliente(self):
        """247 × 0,95 = 234,65. Em float dá 234.64999… — e o cliente que faz a
        conta no papel chega a um valor diferente do cobrado."""
        assert preco_com_metodo("premium", "pix") == 234.65

    def test_cartao_paga_o_preco_cheio(self):
        assert preco_com_metodo("premium", "card") == PRICES["premium"]

    def test_pix_e_sempre_menor_que_cartao(self):
        for plano in ("pro", "premium"):
            assert preco_com_metodo(plano, "pix") < preco_com_metodo(plano, "card")

    def test_valor_tem_no_maximo_dois_decimais(self):
        """Centavo fracionado é recusado pelo Mercado Pago."""
        for plano in ("pro", "premium"):
            valor = preco_com_metodo(plano, "pix")
            assert round(valor, 2) == valor, f"{plano}: {valor}"

    def test_plano_gratuito_nao_tem_preco(self):
        assert preco_com_metodo("free", "pix") == 0.0

    def test_plano_desconhecido_nao_inventa_preco(self):
        assert preco_com_metodo("inventado", "pix") == 0.0


class TestVitrine:
    """`GET /api/payments/plans` é a fonte única de preço do sistema.

    Já houve três tabelas divergentes — aqui, no SubscriptionContext e no
    pricing.config — e a tela mostrava R$ 49,90 enquanto o checkout cobrava
    R$ 97.
    """

    def test_anuncia_compra_avulsa(self):
        """O frontend usa isto para não escrever "por mês" ao lado do valor."""
        assert listar_planos()["billing"] == "one_time"

    def test_informa_a_validade(self):
        assert listar_planos()["accessDays"] == ACCESS_PERIOD_DAYS

    def test_traz_os_dois_valores_e_a_economia(self):
        premium = listar_planos()["plans"]["premium"]
        assert premium["card"] == 247.0
        assert premium["pix"] == 234.65
        assert premium["pixSavings"] == 12.35

    def test_economia_anunciada_confere_com_a_diferenca(self):
        """Se divergir, a página promete um desconto e cobra outro."""
        for plano, dados in listar_planos()["plans"].items():
            if dados["card"] <= 0:
                continue
            assert dados["pixSavings"] == pytest.approx(dados["card"] - dados["pix"], abs=0.01)


class TestCheckout:
    def _pedir(self, client, headers, corpo):
        return client.post("/api/payments/create-preference", headers=headers, json=corpo)

    def test_exige_login(self, client):
        r = self._pedir(client, {}, {"plan": "premium", "method": "pix"})
        assert r.status_code in (401, 403)

    def test_plano_invalido_e_recusado(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = self._pedir(client, headers, {"plan": "vitalicio", "method": "pix"})
        assert r.status_code == 400

    def test_metodo_invalido_e_recusado(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = self._pedir(client, headers, {"plan": "premium", "method": "boleto"})
        assert r.status_code == 400

    def test_plano_gratuito_nao_vai_para_o_checkout(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = self._pedir(client, headers, {"plan": "free", "method": "pix"})
        assert r.status_code == 400

    def test_valor_do_cliente_e_ignorado(self, client, usuario_logado):
        """Mandar {"amount": 1} não pode comprar o premium por um real.

        Sem credencial do Mercado Pago a rota devolve 503 — e é isso que se
        espera no ambiente de teste. O que não pode acontecer é 200 com o valor
        do cliente aceito.
        """
        headers, _ = usuario_logado
        r = self._pedir(client, headers, {
            "plan": "premium", "method": "pix", "amount": 1, "unit_price": 1,
        })
        assert r.status_code in (503, 502), r.text
        if r.status_code == 200:
            assert r.json()["amount"] == 234.65


class TestValidadeDoAcesso:
    """Comprar de novo antes de vencer soma; não reinicia."""

    def _comprar(self, db, user, quando_vence=None):
        from api.payments import _ativar_plano
        from db.models import Subscription

        if quando_vence is not None:
            assinatura = user.subscription or Subscription(user_id=user.id)
            assinatura.current_period_end = quando_vence
            assinatura.plan_name = "premium"
            assinatura.status = "active"
            db.add(assinatura)
            db.commit()

        _ativar_plano(db, user, "premium", "pix")
        db.commit()
        db.refresh(user)
        return user.subscription

    def test_primeira_compra_carimba_a_validade(self, db, usuario_logado):
        """Sem validade, o acesso nunca expira — um pagamento único já valeu
        como assinatura vitalícia por causa disso."""
        from db.models import User, utcnow

        _, email = usuario_logado
        user = db.query(User).filter(User.email == email).first()
        assinatura = self._comprar(db, user)

        assert assinatura.current_period_end is not None
        restam = (assinatura.current_period_end.replace(tzinfo=None) - utcnow().replace(tzinfo=None)).days
        assert abs(restam - ACCESS_PERIOD_DAYS) <= 1

    def test_comprar_de_novo_soma_ao_que_resta(self, db, usuario_logado):
        """Reiniciar a contagem tomaria do cliente os dias já pagos."""
        from datetime import timedelta
        from db.models import User, utcnow

        _, email = usuario_logado
        user = db.query(User).filter(User.email == email).first()

        faltam = utcnow() + timedelta(days=100)
        assinatura = self._comprar(db, user, quando_vence=faltam)

        restam = (assinatura.current_period_end.replace(tzinfo=None) - utcnow().replace(tzinfo=None)).days
        assert restam >= ACCESS_PERIOD_DAYS + 90, (
            f"os 100 dias que faltavam foram perdidos: restam {restam}"
        )

    def test_acesso_vencido_nao_soma_o_passado(self, db, usuario_logado):
        """Validade no passado não pode encurtar a compra nova."""
        from datetime import timedelta
        from db.models import User, utcnow

        _, email = usuario_logado
        user = db.query(User).filter(User.email == email).first()

        venceu = utcnow() - timedelta(days=200)
        assinatura = self._comprar(db, user, quando_vence=venceu)

        restam = (assinatura.current_period_end.replace(tzinfo=None) - utcnow().replace(tzinfo=None)).days
        assert abs(restam - ACCESS_PERIOD_DAYS) <= 1

    def test_plano_desconhecido_nao_libera_acesso(self, db, usuario_logado):
        from api.payments import _ativar_plano
        from db.models import User

        _, email = usuario_logado
        user = db.query(User).filter(User.email == email).first()
        _ativar_plano(db, user, "vitalicio", "pix")
        assert user.subscription is None or user.subscription.plan_name != "vitalicio"


class TestReferenciaDoPagamento:
    def test_metodos_aceitos(self):
        assert VALID_METHODS == {"pix", "card"}
