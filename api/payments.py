import hashlib
import hmac
import os
from datetime import timedelta
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
SUBSCRIPTION_PERIOD_DAYS = int(os.getenv("SUBSCRIPTION_PERIOD_DAYS", "30"))


def _price(plan: str, default: str) -> float:
    """Preço do plano em BRL.

    Lê PRICE_PRO_BRL / PRICE_PREMIUM_BRL — os nomes que existem no .env. O
    código lia PRICE_PRO / PRICE_PREMIUM, que nunca foram definidos, então caía
    sempre no default embutido: premium era cobrado a 297 enquanto o .env
    define 247.
    """
    raw = os.getenv(f"PRICE_{plan.upper()}_BRL") or os.getenv(f"PRICE_{plan.upper()}") or default
    try:
        return float(str(raw).replace(",", "."))
    except ValueError:
        raise RuntimeError(f"PRICE_{plan.upper()}_BRL inválido no .env: {raw!r}")


PRICES = {
    "free": 0.0,
    "pro": _price("pro", "97"),
    "premium": _price("premium", "247"),
}


@router.post("/create-preference")
def create_preference(
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    plan = payload.get("plan") or payload.get("plan_id") or "pro"

    if plan not in VALID_PAID_PLANS:
        raise HTTPException(status_code=400, detail="Plano inválido")

    amount = PRICES[plan]

    if not sdk:
        # Fallback se não tiver MercadoPago configurado
        return {"init_point": "/checkout/fallback", "id": "fallback"}

    preference_data = {
            "items": [
            {
                "title": f"Assinatura DataTrust Audit - {plan.capitalize()}",
                "quantity": 1,
                "currency_id": "BRL",
                "unit_price": amount
            }
        ],
        "payer": {
            "email": current_user.email,
        },
        "back_urls": {
            "success": os.getenv("FRONTEND_URL", "http://localhost:3000") + "/payment/success",
            "failure": os.getenv("FRONTEND_URL", "http://localhost:3000") + "/payment/failed",
            "pending": os.getenv("FRONTEND_URL", "http://localhost:3000") + "/payment/pending"
        },
        "auto_return": "approved",
        # separador "|": o plano é lido de volta no webhook por split, e e-mail
        # ou id com "_" embaralhava os campos.
        "external_reference": f"{current_user.id}|{plan}",
    }

    try:
        preference_response = sdk.preference().create(preference_data)
        preference = preference_response["response"]
        return {"id": preference["id"], "init_point": preference["init_point"]}
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


def _ativar_plano(db: Session, user: User, plan_name: str) -> None:
    """Aplica o plano e carimba a validade.

    Antes só fazia `user.plan = plan_name`: current_period_end ficava nulo e
    status nunca era conferido, então um pagamento único valia como assinatura
    vitalícia — cancelar ou parar de pagar não tirava o acesso.
    """
    if plan_name not in VALID_PAID_PLANS:
        print(f"[payments] plano desconhecido no webhook: {plan_name!r} — ignorado")
        return

    assinatura = user.subscription
    if assinatura is None:
        assinatura = Subscription(user_id=user.id)
        db.add(assinatura)

    assinatura.plan_name = plan_name
    assinatura.status = "active"
    assinatura.current_period_end = utcnow() + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)


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

    if MP_WEBHOOK_SECRET:
        if not _assinatura_valida(str(payment_id), x_signature or "", x_request_id or ""):
            raise HTTPException(status_code=401, detail="Assinatura do webhook inválida.")
    else:
        # Sem segredo configurado não há como distinguir o MP de um terceiro.
        print("[payments] AVISO: MP_WEBHOOK_SECRET não configurado — webhook sem verificação de origem.")

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

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        print(f"[payments] pagamento {payment_id} aprovado para user {user_id} inexistente")
        return {"status": "ignored"}

    _ativar_plano(db, user, plan_name)

    # Registra o pagamento — idempotente: o MP reenvia o mesmo evento
    existing_payment = db.query(Payment).filter(Payment.mp_payment_id == str(payment_id)).first()
    if not existing_payment:
        db.add(Payment(
            user_id=user_id,
            mp_payment_id=str(payment_id),
            amount=float(payment_details.get("transaction_amount", 0)),
            status="approved",
            plan_purchased=plan_name
        ))
    else:
        existing_payment.status = "approved"

    db.commit()
    return {"status": "success"}
