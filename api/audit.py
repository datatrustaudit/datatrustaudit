import asyncio
import socket
from dataclasses import asdict, fields as dc_fields, is_dataclass
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user, resolve_effective_plan
from audit_engine.browser_fetcher import browser_scan
from audit_engine.orchestrator import run_audit
from audit_engine.credit_rules import (
    should_consume_scan_credit,
    get_evidence_count,
    can_perform_scan,
    get_weekly_limit,
)
from audit_engine.url_guard import validate_public_url, UnsafeURLError
from db.database import get_db
from db.models import User, Scan, utcnow


router = APIRouter(prefix="/api/audit", tags=["Audit"])

FETCH_TIMEOUT_MS = 25000


class AuditRequest(BaseModel):
    url: str
    plan: Optional[str] = "free"


def _friendly_message(code: str) -> str:
    messages = {
        "INVALID_URL": "Please enter a valid website URL.",
        "FETCH_FAILED": "We could not access this website. Please check the URL and try again.",
        "BLOCKED": "The website may have blocked the scan. Basic or partial results are shown when available.",
        "TIMEOUT": "The website took too long to respond. Please try again.",
        "PROTOCOL_ERROR": "The runtime scan was interrupted by a protocol failure. No confirmed runtime findings were generated.",
        "DNS_FAILURE": "Could not resolve the website domain. Please check the URL.",
    }
    return messages.get(code, messages["FETCH_FAILED"])


def _safe_dict(value: Any) -> Any:
    if value is None:
        return None
    if is_dataclass(value) and not isinstance(value, type):
        if hasattr(value, "to_dict"):
            return value.to_dict()
        # Percorre campo a campo em vez de usar asdict(): asdict converte os
        # dataclasses aninhados sozinho e descarta o to_dict() de cada um,
        # devolvendo snake_case onde este módulo lê camelCase. Eram 18 campos
        # da resposta saindo sempre vazios — "consentDetected" aparecia False
        # em site com CMP, e a exposição de risco vinha em branco.
        return {campo.name: _safe_dict(getattr(value, campo.name)) for campo in dc_fields(value)}
    if isinstance(value, list):
        return [_safe_dict(item) for item in value]
    if isinstance(value, tuple):
        return [_safe_dict(item) for item in value]
    if isinstance(value, dict):
        return {k: _safe_dict(v) for k, v in value.items()}
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return value


def _dedupe_strings(values: List[str]) -> List[str]:
    seen = set()
    out = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def _risk_from_privacy(privacy: Dict[str, Any], law: str) -> Optional[str]:
    if not privacy:
        return None
    violations = privacy.get("violations") or []
    if any(v.get("severity") == "critical" for v in violations if isinstance(v, dict)):
        return "critical"
    if any(v.get("severity") == "high" for v in violations if isinstance(v, dict)):
        return "high"
    if violations:
        return "medium"
    if law and privacy.get("hasConsentTool") is False:
        return "needs_manual_verification"
    return "low"


def _issue_from_recommendation(rec: Dict[str, Any], locked: bool = False) -> Dict[str, Any]:
    severity = rec.get("severity") or rec.get("priority") or "info"
    return {
        "severity": severity if severity in {"critical", "high", "medium", "low", "info"} else "info",
        "title": rec.get("title") or rec.get("category") or "Audit recommendation",
        "description": rec.get("detail") or rec.get("description") or "",
        "impact": rec.get("impact") or "May affect analytics data quality, privacy compliance, or debugging reliability.",
        "howToFix": rec.get("fix") or rec.get("recommendation") or "Review the implementation in GTM, GA4, CMP, and site source.",
        "confidence": rec.get("confidence") or "medium",
        "planRequirement": "premium" if locked else rec.get("planRequirement"),
    }


def _build_debugging(scan: Any, audit: Dict[str, Any]) -> Dict[str, Any]:
    datalayer = audit.get("datalayer_findings") or audit.get("datalayerFindings") or []
    scripts = getattr(scan, "all_script_urls", []) or []
    network = getattr(scan, "intercepted_requests", []) or []
    network_hints = []
    for req in network[:50]:
        req_dict = _safe_dict(req) if req else {}
        network_hints.append({
            "url": req_dict.get("url"),
            "domain": req_dict.get("domain"),
            "resourceType": req_dict.get("resource_type") or req_dict.get("resourceType"),
            "status": "detected",
            "verification": "Detected from browser/network scan" if not getattr(scan, "fallback_used", False) else "Unavailable in static scan",
        })

    return {
        "scriptsInspected": scripts[:100],
        "dataLayerPushes": datalayer if isinstance(datalayer, list) else [],
        "javascriptErrors": [],
        "networkHints": network_hints,
        "spaBehaviorHints": [
            {
                "status": "needs_manual_verification",
                "message": "Single-page app route changes and post-login flows require manual verification or Premium deep scan.",
            }
        ],
    }


def _normalize_audit_response(url: str, plan: str, scan: Any, audit_result: Any) -> Dict[str, Any]:
    audit = _safe_dict(audit_result) or {}
    tags = audit.get("tags") or []
    events = audit.get("events") or {}
    privacy = audit.get("privacy") or {}
    consent = audit.get("consent") or {}
    gtm_quality = audit.get("gtm_quality") or audit.get("gtmQuality") or {}
    scores = audit.get("scores") or {}
    recommendations = audit.get("recommendations") or []
    duplicates = audit.get("duplicates") or []
    datalayer = audit.get("datalayer_findings") or audit.get("datalayerFindings") or []

    ga4_ids = _dedupe_strings([
        tag.get("tagId") for tag in tags
        if isinstance(tag, dict) and (tag.get("id") == "ga4" or tag.get("type") == "analytics")
        and isinstance(tag.get("tagId"), str) and tag.get("tagId", "").startswith("G-")
    ])
    gtm_ids = _dedupe_strings([
        tag.get("tagId") for tag in tags
        if isinstance(tag, dict) and (tag.get("id") == "gtm" or tag.get("type") == "tag_manager")
        and isinstance(tag.get("tagId"), str) and tag.get("tagId", "").startswith("GTM-")
    ] + (gtm_quality.get("containers") or []))

    event_items = events.get("events") if isinstance(events, dict) else []
    privacy_violations = privacy.get("violations") if isinstance(privacy, dict) else []
    issue_items = [_issue_from_recommendation(rec) for rec in recommendations if isinstance(rec, dict)]

    score = scores.get("auditScore") or scores.get("overall") or audit.get("score")
    if score is None:
        score = 70 if tags else 50

    analytics_cookies = [
        "_ga", "_gid", "_gat", "_gcl_au",
    ] if ga4_ids or any("google-analytics" in str(s) for s in getattr(scan, "all_script_urls", [])) else []
    marketing_cookies = [
        "_fbp", "_fbc", "fr",
    ] if any((isinstance(tag, dict) and tag.get("type") in {"advertising", "marketing"}) for tag in tags) else []

    # Percentual vindo de audit_engine.guia_de_correcao (fonte única).
    from audit_engine.guia_de_correcao import quantidade_visivel, visibilidade_do_plano

    limit_note = None
    visible_tags = tags
    if plan in ("free", "pro") and tags:
        visible_tags = tags[:quantidade_visivel(len(tags), plan)]
        percentual = int(visibilidade_do_plano(plan) * 100)
        ocultos = len(tags) - len(visible_tags)
        if plan == "free":
            limit_note = (
                f"O plano Free mostra {percentual}% dos achados"
                + (f" — {ocultos} ficaram ocultos." if ocultos else ".")
                + " O plano Premium libera o laudo completo, com a linha exata no código-fonte."
            )
        else:
            limit_note = (
                f"O plano Pro mostra {percentual}% dos achados"
                + (f" — {ocultos} ficaram ocultos." if ocultos else ".")
                + " O Premium libera o mapeamento completo do código-fonte."
            )

    response = {
        "success": True,
        "status": "completed" if not getattr(scan, "error", None) else "partial",
        "plan": plan,
        "url": url,
        "score": int(max(0, min(100, score))),
        "summary": {
            "totalTags": len(tags),
            "totalEvents": events.get("totalEvents", len(event_items)) if isinstance(events, dict) else len(event_items or []),
            "totalViolations": privacy.get("totalViolations", len(privacy_violations or [])) if isinstance(privacy, dict) else 0,
            "totalRecommendations": len(recommendations),
            "consentDetected": bool(consent.get("cmpDetected") or privacy.get("hasConsentTool")) if isinstance(consent, dict) else False,
            "hasUniversalAnalytics": bool(privacy.get("hasUniversalAnalytics")) if isinstance(privacy, dict) else False,
            "violationsCount": privacy.get("totalViolations", len(privacy_violations or [])) if isinstance(privacy, dict) else 0,
            "estimatedFine": privacy.get("estimatedRiskExposure") if isinstance(privacy, dict) else None,
            "eventsDetected": events.get("totalEvents", len(event_items)) if isinstance(events, dict) else len(event_items or []),
            "duplicatesDetected": len(duplicates),
            "piiExposureCount": len([f for f in datalayer if isinstance(f, dict) and f.get("type") == "pii_exposure"]),
            "securityIssuesCount": 0,
        },
        "tags": visible_tags,
        "events": event_items or [],
        "violations": privacy_violations or [],
        "recommendations": issue_items,
        "privacy": {
            "jurisdiction": privacy.get("jurisdiction") if isinstance(privacy, dict) else "Unknown",
            "framework": privacy.get("framework") or privacy.get("law_full") if isinstance(privacy, dict) else "General Privacy",
            "confidenceLevel": privacy.get("confidenceLevel") if isinstance(privacy, dict) else "Static scan confidence only",
            "violations": privacy_violations or [],
            "totalViolations": privacy.get("totalViolations", len(privacy_violations or [])) if isinstance(privacy, dict) else 0,
            "hasConsentTool": bool(consent.get("cmpDetected") or privacy.get("hasConsentTool")) if isinstance(consent, dict) else False,
            "hasUniversalAnalytics": bool(privacy.get("hasUniversalAnalytics")) if isinstance(privacy, dict) else False,
            "estimatedRiskExposure": privacy.get("estimatedRiskExposure") if isinstance(privacy, dict) else None,
            "complianceScore": privacy.get("complianceScore") if isinstance(privacy, dict) else None,
            "gdprRisk": _risk_from_privacy(privacy, "GDPR"),
            "lgpdRisk": _risk_from_privacy(privacy, "LGPD"),
            "cookieConsentDetected": bool(consent.get("hasCookiePolicy") or consent.get("cmpDetected")) if isinstance(consent, dict) else None,
            "cmpDetected": bool(consent.get("cmpDetected") or privacy.get("hasConsentTool")) if isinstance(consent, dict) else None,
            "cmpName": consent.get("cmpName") if isinstance(consent, dict) else None,
            "consentModeDetected": bool(consent.get("consentModeV2")) if isinstance(consent, dict) else None,
            "tagsBeforeConsent": consent.get("tagsBeforeConsent", []) if isinstance(consent, dict) else [],
            "analyticsCookies": analytics_cookies,
            "marketingCookies": marketing_cookies,
            "manualVerification": [
                "Data retention, GA4 reporting identity, custom dimensions, server-side tagging, and authenticated funnels need manual verification.",
            ],
        },
        "ga4": {
            "detected": bool(ga4_ids),
            "measurementIds": ga4_ids,
            "events": event_items or [],
            "parameters": [],
            "keyEvents": [],
            "issues": [],
            "manualVerification": [
                "DebugView readiness, key events, attribution reports, and GA4 retention are unavailable in static scans.",
            ],
        },
        "gtm": {
            "detected": bool(gtm_ids),
            "containerIds": gtm_ids,
            "tags": visible_tags,
            "triggers": [],
            "variables": [],
            "issues": gtm_quality.get("findings", []) if isinstance(gtm_quality, dict) else [],
            "manualVerification": [
                "GTM triggers, variables, and unpublished workspace configuration require container export or authenticated access.",
            ],
        },
        "debugging": _build_debugging(scan, audit),
        "errors": ([{"code": "PARTIAL_SCAN", "message": str(getattr(scan, "error", ""))}] if getattr(scan, "error", None) else []),
        "planLimitNotice": limit_note,
        "scanMethod": audit.get("scan_method") or getattr(scan, "scan_method", "html_fallback"),
        "dataQualityNotes": audit.get("data_quality_notes") or audit.get("dataQualityNotes") or [],
        "duplicates": duplicates,
        "gtmQuality": gtm_quality,
        "consent": consent,
        "datalayerFindings": datalayer,
        "scores": scores,
        "disclaimer": audit.get("disclaimer"),
        # Scan metadata
        "scan_status": getattr(scan, "scan_status", "completed") if not getattr(scan, "error", None) else getattr(scan, "scan_status", "partial"),
        "failure_reason": getattr(scan, "failure_reason", None),
        "browser_attempts": getattr(scan, "browser_attempts", 1),
        "static_fallback_used": getattr(scan, "static_fallback_attempted", False) or getattr(scan, "fallback_used", False),
        "final_url": getattr(scan, "final_url", None),
        "started_at": getattr(scan, "started_at", None),
        "finished_at": getattr(scan, "finished_at", None),
        "warnings": getattr(scan, "warnings", []),
    }

    # Determine credit consumption
    response["evidence_count"] = get_evidence_count(response)
    response["scan_credit_consumed"] = should_consume_scan_credit(response)

    if plan == "free":
        response["violations"] = []
        response["privacy"]["manualVerification"].append("Free plan hides violation details; upgrade to Pro or Premium for full issue details.")
    elif plan == "pro":
        response["privacy"]["manualVerification"].append("Pro plan hides exact source line mapping; Premium unlocks source hints when available.")

    return response


def _failed_response(code: str, errors: Optional[List[Dict[str, Any]]] = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        {
            "success": False,
            "status": "failed",
            "errorCode": code,
            "message": _friendly_message(code),
            "errors": errors or [],
        },
        status_code=status_code,
    )


@router.post("")
@router.post("/")
async def run_direct_audit(
    payload: AuditRequest,
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        url = validate_public_url(payload.url)
    except UnsafeURLError:
        return _failed_response("INVALID_URL", status_code=400)

    # payload.plan é ignorado de propósito: quem não está logado é sempre free.
    plan = resolve_effective_plan(current_user)

    # Cota semanal — só para quem tem conta; o visitante anônimo é contido pelo
    # rate limit por IP em main.py.
    if current_user is not None:
        from api.scans import contar_scans_da_semana

        is_admin = bool(getattr(current_user, "is_admin", False))
        usados = contar_scans_da_semana(db, current_user.id)
        if not can_perform_scan(plan, usados, is_admin):
            limite = get_weekly_limit(plan, is_admin)
            return JSONResponse(
                {
                    "success": False,
                    "status": "failed",
                    "errorCode": "LIMIT_REACHED",
                    "message": f"Limite semanal atingido ({usados}/{limite} auditorias para o plano {plan}). Faça upgrade para continuar.",
                    "scansUsed": usados,
                    "scansLimit": limite,
                },
                status_code=403,
            )

    try:
        scan = await asyncio.wait_for(
            asyncio.to_thread(browser_scan, url, FETCH_TIMEOUT_MS),
            timeout=(FETCH_TIMEOUT_MS / 1000) + 20,
        )
    except asyncio.TimeoutError:
        return _failed_response("TIMEOUT", [{"message": "Backend fetch timed out."}])
    except (socket.gaierror, OSError) as exc:
        return _failed_response("FETCH_FAILED", [{"message": str(exc)}])
    except Exception as exc:
        return _failed_response("FETCH_FAILED", [{"message": str(exc)}])

    try:
        audit_result = run_audit(url, scan, use_view_source=(plan == "premium"))
        response = _normalize_audit_response(url, plan, scan, audit_result)

        scan_status = getattr(scan, "scan_status", "completed")
        if not getattr(scan, "html", ""):
            response["success"] = False
            response["status"] = scan_status if scan_status != "completed" else "failed"
            if scan_status == "protocol_error":
                response["errorCode"] = "PROTOCOL_ERROR"
                response["message"] = _friendly_message("PROTOCOL_ERROR")
            elif scan_status == "blocked":
                response["errorCode"] = "BLOCKED"
                response["message"] = _friendly_message("BLOCKED")
            elif scan_status == "timeout":
                response["errorCode"] = "TIMEOUT"
                response["message"] = _friendly_message("TIMEOUT")
            else:
                response["errorCode"] = "FETCH_FAILED"
                response["message"] = _friendly_message("FETCH_FAILED")

        # Persiste o resultado. Este endpoint é o que o frontend usa de fato, e
        # não gravava nada: sem linha em `scans`, o histórico ficava vazio, a
        # cota do plano nunca subia e o front recebia scan_id undefined — a
        # exportação chamava /api/exports/pdf/undefined.
        response["scan_id"] = _persist_scan(db, current_user, url, audit_result, response)

        return JSONResponse(response)
    except Exception as exc:
        return _failed_response("FETCH_FAILED", [{"message": str(exc)}])


def _persist_scan(db: Session, current_user: Optional[User], url: str, audit_result, response: dict) -> Optional[int]:
    """Grava o scan e devolve o id. Nunca derruba a auditoria já concluída."""
    try:
        scores = getattr(audit_result, "scores", None)
        registro = Scan(
            user_id=current_user.id if current_user else None,
            url=url,
            status="completed" if response.get("success") else "failed",
            completed_at=utcnow(),
            scan_method=getattr(audit_result, "scan_method", None),
            score=getattr(scores, "overall", None) if scores else response.get("score"),
            raw_data=jsonable_encoder(audit_result),
            # crédito só é consumido quando a auditoria produziu evidência real
            scan_credit_consumed=bool(response.get("success")),
        )
        db.add(registro)
        db.commit()
        db.refresh(registro)
        return registro.id
    except Exception as exc:
        db.rollback()
        # o relatório já está pronto; perder o registro não pode custar a resposta
        print(f"[audit] falha ao persistir scan de {url}: {exc}")
        return None
