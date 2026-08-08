import copy
import os
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User, Scan, utcnow
from api.auth import get_current_user, get_current_active_user
from audit_engine.url_guard import validate_public_url, UnsafeURLError
from worker.tasks import run_website_audit
from audit_engine.credit_rules import WEEKLY_SCAN_LIMITS, get_weekly_limit, can_perform_scan

router = APIRouter(prefix="/api/scans", tags=["Scans"])

# Weekly scan limits (configurable via env)
FREE_MAX_SCANS = int(os.getenv("FREE_MAX_SCANS", str(WEEKLY_SCAN_LIMITS["free"])))
PRO_MAX_SCANS = int(os.getenv("PRO_MAX_SCANS", str(WEEKLY_SCAN_LIMITS["pro"])))
PREMIUM_MAX_SCANS = int(os.getenv("PREMIUM_MAX_SCANS", str(WEEKLY_SCAN_LIMITS["premium"])))

PLAN_LIMITS = {
    "free": FREE_MAX_SCANS,
    "pro": PRO_MAX_SCANS,
    "premium": PREMIUM_MAX_SCANS,
}


class ScanRequest(BaseModel):
    url: str


def inicio_da_semana():
    """Segunda-feira 00:00 UTC da semana corrente."""
    agora = utcnow()
    return (agora - timedelta(days=agora.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def contar_scans_da_semana(db: Session, user_id: int) -> int:
    return (
        db.query(Scan)
        .filter(Scan.user_id == user_id, Scan.created_at >= inicio_da_semana())
        .count()
    )


@router.post("/")
def create_scan(
    payload: ScanRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Queues a new website audit task asynchronously.

    Exige autenticação. Antes aceitava requisição anônima e, nesse caminho,
    a contagem semanal ficava fixa em 0 — bastava omitir o header Authorization
    para ter scans ilimitados no lugar do limite do plano.
    O scan grátis sem cadastro continua existindo, por /analyze e /api/audit.
    """
    plan = current_user.plan
    is_admin = bool(getattr(current_user, "is_admin", False))

    scans_this_week = contar_scans_da_semana(db, current_user.id)

    if not can_perform_scan(plan, scans_this_week, is_admin):
        limite = get_weekly_limit(plan, is_admin)
        raise HTTPException(
            status_code=403,
            detail=f"Limite semanal atingido ({scans_this_week}/{limite} auditorias para o plano {plan}). Faça upgrade para continuar.",
        )

    try:
        safe_url = validate_public_url(payload.url)
    except UnsafeURLError as e:
        raise HTTPException(status_code=400, detail=str(e))

    new_scan = Scan(user_id=current_user.id, url=safe_url, status="pending")
    db.add(new_scan)
    db.commit()
    db.refresh(new_scan)

    # Queue task natively via FastAPI
    background_tasks.add_task(run_website_audit, new_scan.id)

    return {
        "scan_id": new_scan.id,
        "status": new_scan.status,
        "scans_this_week": scans_this_week + 1,
        "weekly_limit": get_weekly_limit(plan, is_admin),
    }


@router.get("/{scan_id}")
def get_scan(
    scan_id: int,
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Polls the status of a specific scan. If complete, returns the data with appropriate plan stripping."""
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    # Todo scan tem dono e só o dono lê. Antes, scan com user_id NULL pulava a
    # checagem inteira: como o id é sequencial, dava para varrer
    # /api/scans/1,2,3… e ler a URL auditada e o relatório de qualquer visitante.
    if scan.user_id is None or not current_user or scan.user_id != current_user.id:
        # 404 em vez de 403: 403 confirmaria que o id existe.
        raise HTTPException(status_code=404, detail="Scan not found")

    plan = current_user.plan

    return {
        "id": scan.id,
        "url": scan.url,
        "status": scan.status,
        "created_at": scan.created_at.isoformat() if scan.created_at else None,
        "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
        "score": scan.score,
        "result": _plan_filtered_result(scan.raw_data, scan.status, plan),
        "plan_applied": plan,
    }


def _plan_filtered_result(raw_data, status: str, plan: str):
    """Aplica o gating de plano sobre uma CÓPIA do resultado.

    Antes mutava `scan.raw_data` direto — o mesmo objeto que a sessão do
    SQLAlchemy tem em memória. Um flush posterior na mesma sessão gravaria o
    relatório já truncado por cima do original no banco, destruindo os dados
    pagos de forma irreversível.
    """
    if not raw_data or status != "completed" or plan == "premium":
        return raw_data
    if not isinstance(raw_data, dict):
        return raw_data

    res = copy.deepcopy(raw_data)

    # 1. Truncate tags based on plan visibility
    # O percentual vem de audit_engine.guia_de_correcao — estava repetido aqui,
    # em api/audit.py e em main.py, e divergir significa entregar conteúdo pago
    # a quem não pagou (ou cortar de quem pagou).
    from audit_engine.guia_de_correcao import quantidade_visivel

    tags = res.get("tags")
    if isinstance(tags, list) and tags:
        res["tags"] = tags[:quantidade_visivel(len(tags), plan)]
        res["locked_tags"] = True

    # 2. Hide exact code lines for free and pro
    for tag in res.get("tags") or []:
        if isinstance(tag, dict):
            tag.pop("lineNumber", None)
            tag.pop("context", None)
            if plan == "free":
                tag.pop("matchedPattern", None)
                tag.pop("dataCollected", None)

    # 3. Strip privacy violation details for free
    privacy = res.get("privacy")
    if plan == "free" and isinstance(privacy, dict):
        privacy["violations"] = []
        # snake_case: é a chave que jsonable_encoder realmente grava em raw_data.
        # Escrever só "estimatedRiskExposure" deixava o valor real intacto na
        # resposta — o dado pago vazava para o plano free.
        privacy["estimated_risk_exposure"] = "Desbloqueie no plano Pro"
        privacy["estimatedRiskExposure"] = "Desbloqueie no plano Pro"
        privacy["_lockedForPlan"] = "pro"

    # 4. Strip duplicate implementations for free
    duplicates = res.get("duplicates")
    if plan == "free" and isinstance(duplicates, list) and len(duplicates) > 1:
        res["duplicates"] = duplicates[:1]
        res["locked_duplicates"] = True

    # 5. Hide viewSourceInfo
    res.pop("viewSourceInfo", None)

    return res
