from fastapi.encoders import jsonable_encoder
from worker.celery_app import celery_app
from db.database import SessionLocal
from db.models import Scan, Finding, utcnow

from audit_engine.browser_fetcher import browser_scan
from audit_engine.orchestrator import run_audit

VALID_SEVERITIES = {"low", "medium", "high", "critical"}


def _severity(value, fallback: str) -> str:
    """Normaliza a severidade — o model exige NOT NULL e o front filtra por esses valores."""
    if isinstance(value, str) and value.lower() in VALID_SEVERITIES:
        return value.lower()
    return fallback


def _collect_findings(audit_result) -> list:
    """Monta os objetos Finding a partir do resultado da auditoria.

    Retorna instâncias de Finding, não dicts: `scan.findings` é um relationship,
    e atribuir dict levanta AttributeError ('dict' object has no attribute
    '_sa_instance_state'), derrubando todo scan que encontrasse algum problema.
    """
    findings = []

    duplicates = getattr(audit_result, "duplicates", None) or []
    for item in duplicates:
        data = item.to_dict() if hasattr(item, "to_dict") else getattr(item, "__dict__", {}) or {}
        tag_name = data.get("tag") or "Unknown Tag"
        findings.append(Finding(
            category="duplicate",
            severity=_severity(data.get("severity"), "medium"),
            title=f"{tag_name} Duplicate",
            description=data.get("recommendation") or "",
            is_premium=False,
        ))

    privacy = getattr(audit_result, "privacy", None)
    for viol in (getattr(privacy, "violations", None) or []):
        data = viol.to_dict() if hasattr(viol, "to_dict") else getattr(viol, "__dict__", {}) or {}
        findings.append(Finding(
            category="privacy",
            severity=_severity(data.get("severity"), "high"),
            title="LGPD Violation",
            description=data.get("violation") or "Unknown violation",
            is_premium=True,
        ))

    return findings


@celery_app.task(name="run_website_audit")
def run_website_audit(scan_id: int):
    """
    Executes the Playwright audit synchronously inside the Celery worker process.
    Updates the database with the findings and raw results state.
    """
    db = SessionLocal()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not scan:
            return

        scan.status = "processing"
        db.commit()

        try:
            print(f"[worker] Starting Playwright scan for {scan.url}")
            browser_data = browser_scan(scan.url, timeout_ms=30000)
            print(f"[worker] Playwright scan complete for {scan.url}, running analysis engine.")

            audit_result = run_audit(scan.url, browser_data, use_view_source=True)

            scan.status = "completed"
            scan.completed_at = utcnow()
            scan.scan_method = audit_result.scan_method
            scan.score = audit_result.scores.overall if audit_result.scores else 0
            scan.raw_data = jsonable_encoder(audit_result)
            scan.findings = _collect_findings(audit_result)

            db.commit()
        except Exception as e:
            import traceback
            traceback.print_exc()
            # rollback antes de marcar como failed: se a exceção veio do flush,
            # a sessão está suja e o commit seguinte também falharia.
            db.rollback()
            db.query(Scan).filter(Scan.id == scan_id).update(
                {"status": "failed", "completed_at": utcnow()}
            )
            db.commit()
            print(f"[worker] Audit task failed for scan {scan_id}: {e}")
    finally:
        db.close()
