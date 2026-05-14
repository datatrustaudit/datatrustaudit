import os
import mercadopago
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any

from db.database import get_db
from db.models import Payment, User
from api.auth import get_current_user

router = APIRouter(prefix="/api/payments", tags=["Payments"])

MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN", "")
MP_WEBHOOK_SECRET = os.getenv("MP_WEBHOOK_SECRET", "")

sdk = None
if MP_ACCESS_TOKEN:
    sdk = mercadopago.SDK(MP_ACCESS_TOKEN)

# Preços base do sistema
PRICES = {
    "free": float(os.getenv("PRICE_FREE", "0")),
    "pro": float(os.getenv("PRICE_PRO", "97")),
    "premium": float(os.getenv("PRICE_PREMIUM", "297"))
}

@router.post("/create-preference")
def create_preference(
    payload: Dict[str, Any], 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    plan = payload.get("plan", "pro")
    
    if plan not in PRICES or plan == "free":
        raise HTTPException(status_code=400, detail="Plano inválido")
        
    amount = PRICES[plan]
    
    if not sdk:
        # Fallback se não tiver MercadoPago configurado
        return {"init_point": "/checkout/fallback", "id": "fallback"}
        
    preference_data = {
        "items": [
            {
                "title": f"Assinatura GTM Audit Pro - {plan.capitalize()}",
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
        "external_reference": f"{current_user.id}_{plan}",
    }

    try:
        preference_response = sdk.preference().create(preference_data)
        preference = preference_response["response"]
        return {"id": preference["id"], "init_point": preference["init_point"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/webhook")
async def mp_webhook(request: Request, db: Session = Depends(get_db)):
    # Mercado Pago Webhook para atualizar o plano
    data = await request.json()
    
    if data.get("type") == "payment":
        payment_id = data.get("data", {}).get("id")
        if not payment_id:
            return {"status": "ignored"}
            
        if not sdk:
            return {"status": "mp_not_configured"}
            
        payment_info = sdk.payment().get(payment_id)
        if payment_info["status"] == 200:
            payment_details = payment_info["response"]
            
            # Se o pagamento foi aprovado
            if payment_details.get("status") == "approved":
                # A referência externa contém {user_id}_{plan}
                external_ref = payment_details.get("external_reference")
                if external_ref and "_" in external_ref:
                    parts = external_ref.split("_")
                    user_id = int(parts[0])
                    plan_name = parts[1]
                    
                    # Atualiza o plano na base de dados
                    user = db.query(User).filter(User.id == user_id).first()
                    if user:
                        user.plan = plan_name
                        
                    # Registra o pagamento
                    # Prevent duplicate webhook processing
                    existing_payment = db.query(Payment).filter(Payment.mp_payment_id == str(payment_id)).first()
                    if not existing_payment:
                        new_payment = Payment(
                            user_id=user_id,
                            mp_payment_id=str(payment_id),
                            amount=int(float(payment_details.get("transaction_amount", 0)) * 100),
                            status="approved",
                            plan=plan_name
                        )
                        db.add(new_payment)
                    else:
                        existing_payment.status = "approved"
                    db.commit()
                    
    return {"status": "success"}
