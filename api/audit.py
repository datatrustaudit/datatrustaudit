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
        # _safe_dict devolve o próprio objeto quando ele não é dataclass nem
        # tem to_dict — e aí o .get() abaixo estoura AttributeError, derrubando
        # a auditoria inteira por causa da seção de depuração.
        req_dict = _safe_dict(req) if req else {}
        if not isinstance(req_dict, dict):
            req_dict = {
                "url": getattr(req, "url", None),
                "domain": getattr(req, "domain", None),
                "resource_type": getattr(req, "resource_type", None),
            }
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


def _storage_para_o_plano(storage: Any, plan: str) -> Optional[Dict[str, Any]]:
    """Cookies, ordem de disparo e teste de recusa, cortados pelo plano.

    O achado em si aparece para todo mundo — é o que dá valor ao laudo grátis e
    motiva o upgrade. O que o plano pago libera é o detalhe: a lista completa de
    cookies, a linha do tempo inteira e o passo a passo de correção.
    """
    if not isinstance(storage, dict):
        return None

    from audit_engine.guia_de_correcao import quantidade_visivel

    completo = plan == "premium"
    cookies = storage.get("cookiesWithoutConsent") or storage.get("cookies_sem_consentimento") or []
    armazenamento = storage.get("storageWithoutConsent") or storage.get("storage_sem_consentimento") or []
    linha_do_tempo = storage.get("firingTimeline") or storage.get("linha_do_tempo") or []
    achados_recusa = storage.get("rejectionFindings") or storage.get("achados_da_recusa") or []
    ordem = storage.get("orderIssues") or storage.get("problemas_de_ordem") or []

    def corta(itens):
        return itens if completo else itens[:quantidade_visivel(len(itens), plan)]

    def sem_guia(achados):
        """Plano free vê o problema; o passo a passo é do plano pago."""
        if completo or plan == "pro":
            return achados
        return [{k: v for k, v in a.items() if k != "guide"} for a in achados]

    return {
        "cookiesWithoutConsent": corta(cookies),
        "totalCookiesWithoutConsent": len(cookies),
        "storageWithoutConsent": corta(armazenamento),
        "firingTimeline": linha_do_tempo if completo else linha_do_tempo[:8],
        "totalTimelineEvents": len(linha_do_tempo),
        "rejectionFindings": sem_guia(achados_recusa),
        "orderIssues": sem_guia(ordem),
        "rejectionTest": storage.get("rejectionTest") or storage.get("recusa"),
        "guidesLocked": not (completo or plan == "pro"),
    }


#: Eventos de e-commerce do GA4. Espelha `ECOMMERCE_EVENTS` do
#: `event_auditor` — usada só quando o motor não devolveu o agregado pronto.
_EVENTOS_DE_ECOMMERCE = frozenset({
    "add_payment_info", "add_shipping_info", "add_to_cart", "add_to_wishlist",
    "begin_checkout", "purchase", "refund", "remove_from_cart", "select_item",
    "select_promotion", "view_cart", "view_item", "view_item_list",
    "view_promotion",
})


def _agregados_de_evento(events: Any, event_items: Any) -> Dict[str, Any]:
    """Contadores de evento que sobrevivem ao corte por plano.

    Prefere o que o motor calculou. Só recalcula a partir da lista quando o
    agregado não veio — que era o caso de toda resposta de `/api/audit`, porque
    a chave `events` é achatada para a lista pura antes de chegar aqui.

    Recalcular a partir da lista dá o mesmo número que o motor: ele conta
    ocorrências por nome e marca `is_duplicate` quando passa de uma.
    """
    if isinstance(events, dict):
        pronto = {
            "uniqueEventNames": events.get("uniqueEventNames", events.get("unique_event_names")),
            "duplicatedEventNames": events.get("duplicatedEventNames", events.get("duplicated_event_names")),
            "eventsWithIssues": events.get("eventsWithIssues", events.get("events_with_issues")),
            "ecommerceEventsDetected": events.get("ecommerceEventsDetected", events.get("ecommerce_events_detected")),
        }
        if all(v is not None for v in pronto.values()):
            return pronto

    itens = [e for e in (event_items or []) if isinstance(e, dict)]

    ocorrencias: Dict[str, int] = {}
    for e in itens:
        nome = e.get("name") or ""
        if nome:
            ocorrencias[nome] = ocorrencias.get(nome, 0) + 1

    # "Com problema" na mesma régua do motor: validade parcial ou malformada,
    # ou faltando parâmetro obrigatório. Evento válido e completo não conta.
    com_problema = sum(
        1 for e in itens
        if str(e.get("validity") or "").lower() in ("partial", "malformed")
        or (e.get("missing_required_params") or e.get("missingRequiredParams"))
    )

    return {
        "uniqueEventNames": len(ocorrencias),
        "duplicatedEventNames": sum(1 for c in ocorrencias.values() if c > 1),
        "eventsWithIssues": com_problema,
        "ecommerceEventsDetected": sorted(set(ocorrencias) & _EVENTOS_DE_ECOMMERCE),
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

    # Contagem por gravidade — sempre preenchida, inclusive no plano free.
    # O gating esconde o DETALHE de cada violação, mas continua informando
    # quantas são e de que gravidade: sem isso o painel exibia "23 violações"
    # ao lado de um gráfico de severidade completamente vazio, porque ele era
    # montado a partir da lista já esvaziada.
    contagem_por_gravidade = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for v in (privacy_violations or []):
        if isinstance(v, dict):
            nivel = v.get("severity") or "medium"
            if nivel in contagem_por_gravidade:
                contagem_por_gravidade[nivel] += 1
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
    from audit_engine.guia_de_correcao import (
        plano_ve_detalhe,
        quantidade_visivel,
        visibilidade_do_plano,
    )

    limit_note = None
    visible_tags = tags
    mostra_detalhe = plano_ve_detalhe(plan)

    if not mostra_detalhe:
        # O gratuito recebe o veredito, não uma lista cortada.
        visible_tags = []
        limit_note = (
            "Este é o resultado gratuito: dizemos o que foi encontrado, não onde. "
            "O plano Premium abre cada achado — a tag, a linha no código-fonte, o "
            "cookie gravado e o passo a passo da correção."
        )
    elif plan == "pro" and tags:
        visible_tags = tags[:quantidade_visivel(len(tags), plan)]
        percentual = int(visibilidade_do_plano(plan) * 100)
        ocultos = len(tags) - len(visible_tags)
        limit_note = (
            f"O plano Pro mostra {percentual}% dos achados"
            + (f" — {ocultos} ficaram ocultos." if ocultos else ".")
            + " O Premium libera o mapeamento completo do código-fonte."
        )

    # Veredito: a frase que o gratuito lê no lugar do laudo. Vai em toda
    # resposta — o plano pago também abre com ela, e o mesmo texto nos dois
    # impede que a versão gratuita diga uma coisa e a paga outra.
    from audit_engine.veredito import gerar_veredito

    cookies_sem_consentimento = len(
        ((audit.get("storage") or {}).get("cookies_without_consent")
         or (audit.get("storage") or {}).get("cookiesWithoutConsent")
         or [])
    ) if isinstance(audit.get("storage"), dict) else 0

    veredito = gerar_veredito(
        total_de_achados=privacy.get("totalViolations", len(privacy_violations or [])) if isinstance(privacy, dict) else 0,
        por_gravidade=contagem_por_gravidade,
        tem_cmp=bool(consent.get("cmpDetected") or privacy.get("hasConsentTool")) if isinstance(consent, dict) else False,
        tags_antes_do_consentimento=len([t for t in tags if isinstance(t, dict) and t.get("isBeforeConsent")]),
        cookies_sem_consentimento=cookies_sem_consentimento,
        pii_exposta=len([f for f in datalayer if isinstance(f, dict) and f.get("type") == "pii_exposure"]),
        total_de_tags=len(tags),
        violacoes=privacy_violations or [],
    )

    response = {
        "success": True,
        "status": "completed" if not getattr(scan, "error", None) else "partial",
        "plan": plan,
        "url": url,
        "score": int(max(0, min(100, score))),
        # Sempre presente: é o que o gratuito lê inteiro, e o que abre o pago.
        "veredito": veredito,
        "showsDetail": mostra_detalhe,
        "summary": {
            "totalTags": len(tags),
            "totalEvents": events.get("totalEvents", len(event_items)) if isinstance(events, dict) else len(event_items or []),
            "totalViolations": privacy.get("totalViolations", len(privacy_violations or [])) if isinstance(privacy, dict) else 0,
            "totalRecommendations": len(recommendations),
            "consentDetected": bool(consent.get("cmpDetected") or privacy.get("hasConsentTool")) if isinstance(consent, dict) else False,
            "hasUniversalAnalytics": bool(privacy.get("hasUniversalAnalytics")) if isinstance(privacy, dict) else False,
            "violationsCount": privacy.get("totalViolations", len(privacy_violations or [])) if isinstance(privacy, dict) else 0,
            # Agregado por gravidade: sobrevive ao corte por plano, ao
            # contrário da lista de violações.
            "violationsBySeverity": contagem_por_gravidade,
            "estimatedFine": privacy.get("estimatedRiskExposure") if isinstance(privacy, dict) else None,
            "eventsDetected": events.get("totalEvents", len(event_items)) if isinstance(events, dict) else len(event_items or []),
            # Os outros agregados de evento, pelo mesmo motivo de
            # `violationsBySeverity`: a resposta só carregava a lista, e a aba
            # Eventos lia `uniqueEventNames`/`duplicatedEventNames`/
            # `eventsWithIssues` de um objeto que não existia. Todos caíam no
            # zero padrão, e a tela exibia "13 eventos · 0 únicos · 0
            # duplicados · 0 com problemas" — a primeira dupla é impossível, e
            # a última afirma conformidade que ninguém mediu.
            #
            # O motor calcula os quatro em `event_auditor`; era só a resposta
            # que os descartava.
            **_agregados_de_evento(events, event_items),
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
        # Cookies sem consentimento, ordem real de disparo, teste do "Recusar" e
        # os guias de correção. Sem expor aqui, todo esse trabalho fica no motor
        # e nunca chega à tela do cliente.
        "storage": _storage_para_o_plano(audit.get("storage"), plan),
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

    if not mostra_detalhe:
        # O gratuito recebe o veredito e os números — nunca o detalhe.
        #
        # Os agregados de `summary` (violationsCount, violationsBySeverity)
        # ficam de pé de propósito: dizer "22 achados" sem listá-los é o que
        # motiva o upgrade, enquanto zerar a contagem junto faria a tela
        # parecer defeituosa em vez de limitada.
        response["violations"] = []
        response["events"] = []
        response["recommendations"] = []
        response["privacy"]["violations"] = []
        response["privacy"]["tagsBeforeConsent"] = []
        response["ga4"]["measurementIds"] = []
        response["ga4"]["events"] = []
        response["gtm"]["containerIds"] = []
        response["gtm"]["issues"] = []
        response["debugging"] = {}
        response["storage"] = None
        response["dataQualityNotes"] = []
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


def _corpo_de_falha(code: str, errors: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Mesmo conteúdo de `_failed_response`, como dicionário.

    O Deep Scan precisa registrar a falha de uma página sem interromper as
    outras, então não pode receber um JSONResponse pronto.
    """
    return {
        "success": False,
        "status": "failed",
        "errorCode": code,
        "message": _friendly_message(code),
        "errors": errors or [],
    }


async def auditar_pagina(url: str, plan: str) -> Dict[str, Any]:
    """Auditoria de uma página pelo `audit_engine`, no formato da API.

    Fonte única do que é "auditar". Existia só dentro de `run_direct_audit`, e
    o `/deep-analyze` mantinha um caminho próprio com o motor legado do
    `main.py` — que compara posição no HTML em vez de olhar a rede. O mesmo
    site recebia dois laudos diferentes conforme a aba escolhida, e o Deep,
    justamente o modo mais caro, era o que enxergava menos.

    Não persiste nem consome cota: quem chama decide isso. Devolve o corpo de
    falha em vez de levantar, para que uma página ruim não derrube a varredura.

    As chaves `_audit_result` e `_scan` carregam os objetos do motor para quem
    precisa deles (persistência, extração de links) e devem ser removidas antes
    de a resposta ir para a rede.
    """
    try:
        scan = await asyncio.wait_for(
            asyncio.to_thread(browser_scan, url, FETCH_TIMEOUT_MS),
            timeout=(FETCH_TIMEOUT_MS / 1000) + 20,
        )
    except asyncio.TimeoutError:
        return _corpo_de_falha("TIMEOUT", [{"message": "Backend fetch timed out."}])
    except Exception as exc:
        return _corpo_de_falha("FETCH_FAILED", [{"message": str(exc)}])

    try:
        audit_result = run_audit(url, scan, use_view_source=(plan == "premium"))
        response = _normalize_audit_response(url, plan, scan, audit_result)
    except Exception as exc:
        return _corpo_de_falha("FETCH_FAILED", [{"message": str(exc)}])

    # HTML vazio é falha, mesmo quando o motor não levanta: sem código não há
    # o que auditar, e devolver score de página em branco vira falso negativo.
    #
    # `scan_status != "completed"` cobre o caso mais traiçoeiro: a página de
    # bloqueio anti-bot devolve HTML válido, então o teste de HTML vazio não
    # pega, e o laudo sairia com selo verde sobre uma página que nunca foi
    # vista. Um laudo que erra para mais o cliente confere e reclama; um que
    # diz "conforme" por engano, ele publica.
    scan_status = getattr(scan, "scan_status", "completed")
    if not getattr(scan, "html", "") or scan_status not in ("completed", "partial"):
        response["success"] = False
        response["status"] = scan_status if scan_status != "completed" else "failed"
        codigo = {
            "protocol_error": "PROTOCOL_ERROR",
            "blocked": "BLOCKED",
            "timeout": "TIMEOUT",
        }.get(scan_status, "FETCH_FAILED")
        response["errorCode"] = codigo
        response["message"] = _friendly_message(codigo)

    response["_audit_result"] = audit_result
    response["_scan"] = scan
    return response


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
        # Mesmo caminho que o Deep Scan percorre por página.
        response = await auditar_pagina(url, plan)
        audit_result = response.pop("_audit_result", None)
        response.pop("_scan", None)

        if audit_result is None:
            return JSONResponse(response, status_code=200)

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
