import asyncio
from datetime import datetime
from fastapi.encoders import jsonable_encoder
from celery import shared_task
from worker.celery_app import celery_app
from db.database import SessionLocal
from db.models import Scan

from audit_engine.browser_fetcher import browser_scan
from audit_engine.orchestrator import run_audit

@celery_app.task(name="run_website_audit")
def run_website_audit(scan_id: int):
    """
    Executes the Playwright audit synchronously inside the Celery worker process.
    Updates the database with the findings and raw results state.
    """
    db = SessionLocal()
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        db.close()
        return

    scan.status = "processing"
    db.commit()

    try:
        # Run the real browser scan
        print(f"[worker] Starting Playwright scan for {scan.url}")
        browser_data = browser_scan(scan.url, timeout_ms=30000)
        print(f"[worker] Playwright scan complete for {scan.url}, running analysis engine.")
        
        # Run analysis orchestration
        audit_result = run_audit(scan.url, browser_data, use_view_source=True)
        
        # Save results to DB
        scan.status = "completed"
        scan.completed_at = datetime.utcnow()
        scan.scan_method = audit_result.scan_method
        scan.score = audit_result.scores.overall if audit_result.scores else 0
        
        # Serialize complex Pydantic/dataclass objects
        raw_data = jsonable_encoder(audit_result)
        scan.raw_data = raw_data
        
        # Insert duplicate and privacy findings into JSON
        findings_list = []
        if hasattr(audit_result, "duplicates") and audit_result.duplicates:
            for finding in audit_result.duplicates:
                f_dict = finding.to_dict() if hasattr(finding, "to_dict") else getattr(finding, "__dict__", {})
                findings_list.append({
                    "category": "duplicate",
                    "severity": f_dict.get("severity", "medium"),
                    "title": f_dict.get("tag", "Unknown Tag") + " Duplicate",
                    "description": f_dict.get("recommendation", ""),
                    "is_premium": False
                })
                
        # Insert privacy issues
        if hasattr(audit_result, "privacy") and getattr(audit_result.privacy, "violations", None):
            for viol in audit_result.privacy.violations:
                v_dict = viol.to_dict() if hasattr(viol, "to_dict") else getattr(viol, "__dict__", {})
                findings_list.append({
                    "category": "privacy",
                    "severity": v_dict.get("severity", "high"),
                    "title": "LGPD Violation",
                    "description": v_dict.get("violation", "Unknown violation"),
                    "is_premium": True
                })
        
        scan.findings = findings_list
        db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()
        scan.status = "failed"
        scan.completed_at = datetime.utcnow()
        db.commit()
        print(f"[worker] Audit task failed for {scan.url}: {e}")
    finally:
        db.close()
