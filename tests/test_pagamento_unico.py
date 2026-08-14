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


class _PreferenciaFalsa:
    """Dublê do `sdk.preference()` do Mercado Pago.

    Guarda o payload enviado — é lá que o valor é cobrado de fato, então é lá
    que a asserção precisa olhar. Conferir só a resposta deixaria passar um
    `unit_price` errado no que foi enviado.
    """

    def __init__(self, dono):
        self._dono = dono

    def create(self, preferencia):
        self._dono.ultima_preferencia = preferencia
        return {"status": self._dono._status, "response": self._dono._corpo}


class MercadoPagoFalso:
    def __init__(self):
        self.ultima_preferencia = None
        self._status = 201
        self._corpo = {
            "id": "pref-de-teste-123",
            "init_point": "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-de-teste-123",
        }

    def responder(self, status, corpo):
        """Faz a próxima chamada devolver uma recusa."""
        self._status = status
        self._corpo = corpo

    def preference(self):
        return _PreferenciaFalsa(self)


@pytest.fixture()
def mercado_pago_falso(monkeypatch):
    """Instala o dublê no lugar do SDK real.

    Sem isto, `pytest` criava preferências de verdade na conta de produção do
    Mercado Pago: `db.database` chama `load_dotenv()` no import, e o token do
    `.env` entrava no ambiente dos testes. Passava despercebido porque toda
    preferência era recusada antes de chegar ao fim.

    `FRONTEND_URL` é restaurada no teardown porque dois testes daqui a
    sobrescrevem para exercitar o http e o https.
    """
    import api.payments as p

    falso = MercadoPagoFalso()
    frontend_original = os.environ.get("FRONTEND_URL")
    monkeypatch.setattr(p, "sdk", falso)
    yield falso
    if frontend_original is None:
        os.environ.pop("FRONTEND_URL", None)
    else:
        os.environ["FRONTEND_URL"] = frontend_original

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

    def test_sem_credencial_o_checkout_recusa_em_vez_de_fingir(self, client, usuario_logado):
        """Já devolveu um link de fallback que não levava a lugar nenhum, e o
        cliente achava que tinha assinado."""
        headers, _ = usuario_logado
        r = self._pedir(client, headers, {"plan": "premium", "method": "pix"})
        assert r.status_code == 503, r.text

    def test_valor_do_cliente_e_ignorado(self, client, usuario_logado, mercado_pago_falso):
        """Mandar {"amount": 1} não pode comprar o premium por um real.

        O que vai para o Mercado Pago é conferido no payload, não na resposta:
        é lá que o valor é cobrado de fato.
        """
        headers, _ = usuario_logado
        r = self._pedir(client, headers, {
            "plan": "premium", "method": "pix", "amount": 1, "unit_price": 1,
        })
        assert r.status_code == 200, r.text

        enviado = mercado_pago_falso.ultima_preferencia
        assert enviado["items"][0]["unit_price"] == 234.65, (
            f"o valor enviado ao Mercado Pago foi {enviado['items'][0]['unit_price']}"
        )
        assert r.json()["amount"] == 234.65

    def test_url_http_nao_manda_auto_return(self, client, usuario_logado, mercado_pago_falso):
        """`auto_return` exige `back_urls.success` em https. Com http o Mercado
        Pago recusa a preferência INTEIRA com 400 e uma mensagem que nem cita o
        https — diz que `back_url.success must be defined`, sobre um campo que
        estava lá. Em desenvolvimento o checkout falhava sempre.
        """
        headers, _ = usuario_logado
        os.environ["FRONTEND_URL"] = "http://localhost:8080"
        r = self._pedir(client, headers, {"plan": "premium", "method": "pix"})
        assert r.status_code == 200, r.text
        assert "auto_return" not in mercado_pago_falso.ultima_preferencia

    def test_url_https_manda_auto_return(self, client, usuario_logado, mercado_pago_falso):
        """Em produção o retorno automático é o comportamento desejado — não
        pode ter sido perdido junto com a correção."""
        headers, _ = usuario_logado
        os.environ["FRONTEND_URL"] = "https://datatrustaudit.com"
        r = self._pedir(client, headers, {"plan": "premium", "method": "pix"})
        assert r.status_code == 200, r.text
        assert mercado_pago_falso.ultima_preferencia["auto_return"] == "approved"

    def test_recusa_do_mercado_pago_nao_vira_keyerror(self, client, usuario_logado, mercado_pago_falso):
        """Erro do MP não levanta exceção: devolve 4xx com um corpo sem `id`, e
        `preference["id"]` estourava um KeyError seco. O log dizia só `'id'` — o
        nome da chave — enquanto a causa estava escrita no corpo."""
        headers, _ = usuario_logado
        mercado_pago_falso.responder(
            status=400,
            corpo={"error": "invalid_auto_return", "message": "auto_return invalid."},
        )
        r = self._pedir(client, headers, {"plan": "premium", "method": "pix"})
        assert r.status_code == 502, r.text
        assert "iniciar o pagamento" in r.json()["detail"]


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
