import hashlib
import hmac
import os
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, Any

import mercadopago
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Payment, User, Subscription, utcnow
from api.auth import get_current_active_user

router = APIRouter(prefix="/api/payments", tags=["Payments"])

MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN", "")
MP_WEBHOOK_SECRET = os.getenv("MP_WEBHOOK_SECRET", "")

sdk = None
if MP_ACCESS_TOKEN:
    sdk = mercadopago.SDK(MP_ACCESS_TOKEN)

VALID_PAID_PLANS = {"pro", "premium"}

#: Por quanto tempo o acesso vale depois de pago.
#:
#: A cobrança deixou de ser assinatura: é compra avulsa, sem renovação
#: automática. A validade continua sendo carimbada — sem ela, um pagamento
#: valeria para sempre, e foi assim que `current_period_end` nulo já deu acesso
#: vitalício por uma mensalidade.
ACCESS_PERIOD_DAYS = int(os.getenv("ACCESS_PERIOD_DAYS", "365"))

#: Formas de pagamento oferecidas.
VALID_METHODS = {"pix", "card"}

#: Desconto do PIX. Cai direto no bolso: PIX não tem taxa de parcelamento nem
#: risco de chargeback, então parte disso volta para quem paga à vista.
PIX_DISCOUNT = float(os.getenv("PIX_DISCOUNT_PCT", "5")) / 100


def _price(plan: str, default: str) -> float:
    """Preço do plano em BRL, pagamento único.

    Lê PRICE_PRO_BRL / PRICE_PREMIUM_BRL — os nomes que existem no `.env`. O
    código já leu PRICE_PRO / PRICE_PREMIUM, que nunca foram definidos, e caía
    no default embutido: o premium era cobrado a 297 com o `.env` em 247.

    Este módulo é a ÚNICA fonte de preço do sistema. O frontend busca daqui via
    GET /api/payments/plans, em vez de manter a própria tabela — havia três
    listas divergentes (aqui, SubscriptionContext.tsx e pricing.config.ts), e o
    cliente via um valor na tela enquanto o checkout cobrava outro.
    """
    raw = os.getenv(f"PRICE_{plan.upper()}_BRL") or default
    try:
        valor = float(str(raw).replace(",", "."))
    except ValueError:
        raise RuntimeError(f"PRICE_{plan.upper()}_BRL inválido no .env: {raw!r}")
    if valor < 0:
        raise RuntimeError(f"PRICE_{plan.upper()}_BRL negativo: {valor}")
    return valor


PRICES = {
    "free": 0.0,
    "pro": _price("pro", "97"),
    "premium": _price("premium", "247"),
}


def preco_com_metodo(plano: str, metodo: str) -> float:
    """Valor a cobrar, já com o desconto do método.

    A conta é feita em `Decimal`, não em float. Com float, `247 * 0.95` dá
    234.64999… e o cliente que faz a conta no papel chega a 234,65 — um centavo
    de diferença entre o que a página anuncia e o que o checkout cobra é
    exatamente o tipo de coisa que vira contestação.
    """
    base = PRICES.get(plano, 0.0)
    if base <= 0:
        return 0.0
    if metodo != "pix":
        return base

    valor = (Decimal(str(base)) * (Decimal("1") - Decimal(str(PIX_DISCOUNT)))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return float(valor)


@router.get("/plans")
def listar_planos():
    """Preços vigentes — fonte única para o frontend.

    Sem isso o frontend mantinha a própria tabela e divergia do que o checkout
    de fato cobra.
    """
    return {
        "currency": "BRL",
        # Compra avulsa, sem renovação automática — o frontend usa isto para
        # não escrever "por mês" ao lado do valor.
        "billing": "one_time",
        "accessDays": ACCESS_PERIOD_DAYS,
        "pixDiscountPct": round(PIX_DISCOUNT * 100),
        "plans": {
            plano: {
                "price": PRICES[plano],
                "pix": preco_com_metodo(plano, "pix"),
                "card": preco_com_metodo(plano, "card"),
                "pixSavings": round(PRICES[plano] - preco_com_metodo(plano, "pix"), 2),
            }
            for plano in ("free", "pro", "premium")
        },
    }


@router.post("/create-preference")
def create_preference(
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    plan = payload.get("plan") or payload.get("plan_id") or "premium"
    metodo = (payload.get("method") or payload.get("metodo") or "card").lower()

    if plan not in VALID_PAID_PLANS:
        raise HTTPException(status_code=400, detail="Plano inválido")
    if metodo not in VALID_METHODS:
        raise HTTPException(status_code=400, detail="Forma de pagamento inválida")

    # O valor sai da tabela do servidor, nunca do que o cliente mandou — e o
    # desconto do PIX é aplicado aqui, não aceito de fora: mandar
    # {"amount": 1} não pode comprar o plano por um real.
    amount = preco_com_metodo(plan, metodo)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Plano sem preço configurado.")

    if not sdk:
        # Sem credencial do Mercado Pago não há como cobrar. Antes devolvia um
        # link de fallback que levava a lugar nenhum e o usuário achava que
        # tinha assinado.
        raise HTTPException(
            status_code=503,
            detail="Pagamento indisponível no momento. Tente novamente em instantes.",
        )

    frontend = os.getenv("FRONTEND_URL", "http://localhost:3000")
    meses = round(ACCESS_PERIOD_DAYS / 30)
    titulo = (
        f"DataTrust Audit {plan.capitalize()} — acesso por "
        f"{'1 ano' if ACCESS_PERIOD_DAYS >= 360 else f'{meses} meses'}"
    )

    preference_data = {
        "items": [
            {
                "title": titulo,
                "quantity": 1,
                "currency_id": "BRL",
                "unit_price": amount,
            }
        ],
        "payer": {
            "email": current_user.email,
        },
        "back_urls": {
            "success": frontend + "/payment/success",
            "failure": frontend + "/payment/failed",
            "pending": frontend + "/payment/pending",
        },
        "auto_return": "approved",
        # separador "|": o plano é lido de volta no webhook por split, e e-mail
        # ou id com "_" embaralhava os campos.
        # O método viaja junto porque o valor difere entre PIX e cartão — sem
        # ele não dá para conferir, depois, quanto deveria ter sido cobrado.
        "external_reference": f"{current_user.id}|{plan}|{metodo}",
    }

    if metodo == "pix":
        # O desconto é do PIX: se o checkout aceitasse cartão nesta preferência,
        # daria para pagar parcelado pelo preço à vista.
        preference_data["payment_methods"] = {
            "excluded_payment_types": [
                {"id": "credit_card"},
                {"id": "debit_card"},
                {"id": "ticket"},        # boleto
                {"id": "atm"},
                {"id": "prepaid_card"},
            ],
            "installments": 1,
        }
        # PIX expira; sem prazo o pagamento fica pendente para sempre e o
        # cliente acha que comprou.
        preference_data["expires"] = True
        preference_data["date_of_expiration"] = (
            (utcnow() + timedelta(minutes=30)).isoformat().replace("+00:00", "Z")
        )
    else:
        preference_data["payment_methods"] = {
            "excluded_payment_types": [{"id": "ticket"}, {"id": "atm"}],
        }

    try:
        preference_response = sdk.preference().create(preference_data)
        preference = preference_response["response"]
        return {
            "id": preference["id"],
            "init_point": preference["init_point"],
            # Devolvidos para a tela confirmar o que será cobrado — sem isso
            # ela precisaria recalcular o desconto por conta própria, e é assim
            # que preço na tela passa a divergir do preço no checkout.
            "amount": amount,
            "method": metodo,
            "listPrice": PRICES[plan],
        }
    except Exception as e:
        print(f"[payments] erro ao criar preferência para user {current_user.id}: {e}")
        raise HTTPException(status_code=502, detail="Não foi possível iniciar o pagamento. Tente novamente.")


def _assinatura_valida(request_body_id: str, x_signature: str, x_request_id: str) -> bool:
    """Confere o HMAC que o Mercado Pago manda no header x-signature.

    MP_WEBHOOK_SECRET era lido no topo do arquivo e nunca usado: a rota aceitava
    qualquer POST de qualquer origem.

    Formato do header: "ts=<timestamp>,v1=<hmac_sha256>", e o texto assinado é
    "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
    """
    if not x_signature:
        return False

    partes = {}
    for pedaco in x_signature.split(","):
        if "=" in pedaco:
            chave, _, valor = pedaco.partition("=")
            partes[chave.strip()] = valor.strip()

    ts = partes.get("ts")
    recebido = partes.get("v1")
    if not ts or not recebido:
        return False

    manifest = f"id:{request_body_id};request-id:{x_request_id};ts:{ts};"
    esperado = hmac.new(
        MP_WEBHOOK_SECRET.encode("utf-8"),
        manifest.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(esperado, recebido)


def _ativar_plano(db: Session, user: User, plan_name: str, metodo: str = "card") -> None:
    """Aplica o plano comprado e carimba até quando ele vale.

    A validade continua existindo mesmo sendo compra avulsa: sem ela,
    `current_period_end` fica nulo e o acesso nunca expira — foi assim que um
    pagamento único já valeu como assinatura vitalícia.

    Comprar de novo antes de vencer SOMA ao que resta, em vez de reiniciar a
    contagem. Reiniciar tomaria do cliente os dias que ele já tinha pago.
    """
    if plan_name not in VALID_PAID_PLANS:
        print(f"[payments] plano desconhecido no webhook: {plan_name!r} — ignorado")
        return

    assinatura = user.subscription
    if assinatura is None:
        assinatura = Subscription(user_id=user.id)
        db.add(assinatura)

    agora = utcnow()
    restante = assinatura.current_period_end
    # `current_period_end` pode vir naive do banco (SQLite não guarda tzinfo);
    # comparar naive com aware levanta TypeError e derrubaria o webhook, que é
    # justamente o caminho que libera o acesso já pago.
    if restante is not None and restante.tzinfo is None:
        restante = restante.replace(tzinfo=agora.tzinfo)

    base = restante if (restante and restante > agora) else agora

    assinatura.plan_name = plan_name
    assinatura.status = "active"
    assinatura.current_period_end = base + timedelta(days=ACCESS_PERIOD_DAYS)

    # Espelho consultado por User.has_active_subscription e pelo frontend.
    # Precisa andar junto com a assinatura, senão os dois campos divergem.
    user.subscription_status = "active"


@router.post("/webhook")
async def mp_webhook(
    request: Request,
    x_signature: Optional[str] = Header(None, alias="x-signature"),
    x_request_id: Optional[str] = Header(None, alias="x-request-id"),
    db: Session = Depends(get_db),
):
    # Mercado Pago Webhook para atualizar o plano
    data = await request.json()

    if data.get("type") != "payment":
        return {"status": "ignored"}

    payment_id = data.get("data", {}).get("id")
    if not payment_id:
        return {"status": "ignored"}

    # Falha fechado: sem o segredo não há como distinguir o Mercado Pago de um
    # terceiro qualquer, e cada requisição aceita vira uma consulta à API do MP
    # com um id escolhido por quem chamou. Aceitar "por enquanto" é o tipo de
    # configuração pendente que chega em produção sem ninguém perceber — o
    # webhook responde 503 até MP_WEBHOOK_SECRET estar definido.
    if not MP_WEBHOOK_SECRET:
        print("[payments] ERRO: MP_WEBHOOK_SECRET não configurado — webhook recusado.")
        raise HTTPException(
            status_code=503,
            detail="Webhook não configurado. Defina MP_WEBHOOK_SECRET.",
        )

    if not _assinatura_valida(str(payment_id), x_signature or "", x_request_id or ""):
        raise HTTPException(status_code=401, detail="Assinatura do webhook inválida.")

    if not sdk:
        return {"status": "mp_not_configured"}

    try:
        payment_info = sdk.payment().get(payment_id)
    except Exception as e:
        print(f"[payments] falha ao consultar pagamento {payment_id}: {e}")
        # 502 faz o Mercado Pago reenviar depois
        raise HTTPException(status_code=502, detail="Falha ao consultar o pagamento.")

    if payment_info.get("status") != 200:
        return {"status": "not_found"}

    payment_details = payment_info["response"]

    if payment_details.get("status") != "approved":
        return {"status": "ignored"}

    external_ref = payment_details.get("external_reference") or ""
    separador = "|" if "|" in external_ref else "_"
    parts = external_ref.split(separador)
    if len(parts) < 2:
        print(f"[payments] external_reference inesperada: {external_ref!r}")
        return {"status": "ignored"}

    try:
        user_id = int(parts[0])
    except ValueError:
        print(f"[payments] user_id inválido em external_reference: {external_ref!r}")
        return {"status": "ignored"}

    plan_name = parts[1]
    # A terceira parte era o ciclo de cobrança (monthly/annual) e hoje é a forma
    # de pagamento. Referências antigas ainda podem chegar — o Mercado Pago
    # reenvia eventos por dias —, então valores desconhecidos caem em "card" e
    # não impedem a liberação de um pagamento que já entrou.
    metodo = parts[2] if len(parts) > 2 and parts[2] in VALID_METHODS else "card"

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        print(f"[payments] pagamento {payment_id} aprovado para user {user_id} inexistente")
        return {"status": "ignored"}

    # A checagem de duplicata vem ANTES de liberar o acesso.
    #
    # `_ativar_plano` soma o período ao que resta — comportamento correto para
    # quem compra de novo, e desastroso para reentrega: o Mercado Pago reenvia
    # o mesmo evento por dias até receber 200, e cada reenvio somava mais um
    # ano de acesso. Uma compra virava três, cinco, dez anos.
    #
    # O registro do pagamento é o que marca "já processei este id". Ativar
    # antes de consultá-lo tornava o registro inútil como trava.
    ja_processado = db.query(Payment).filter(Payment.mp_payment_id == str(payment_id)).first()

    if ja_processado:
        # Reentrega do mesmo pagamento. Confirma o status e não mexe na
        # validade — o acesso já foi concedido na primeira vez.
        if ja_processado.status != "approved":
            ja_processado.status = "approved"
            db.commit()
        return {"status": "already_processed"}

    _ativar_plano(db, user, plan_name, metodo)

    db.add(Payment(
        user_id=user_id,
        mp_payment_id=str(payment_id),
        amount=float(payment_details.get("transaction_amount", 0)),
        status="approved",
        plan_purchased=plan_name
    ))

    db.commit()
    return {"status": "success"}
