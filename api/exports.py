import io
import re
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime
import openpyxl

from db.database import get_db
from db.models import Scan, User
from api.auth import get_current_active_user

router = APIRouter(prefix="/api/exports", tags=["Exports"])

PAID_PLANS = {"pro", "premium"}


def _safe_filename_part(url: str) -> str:
    """Sanitiza o host para uso em Content-Disposition.

    O host vem da URL que o usuário mandou auditar: sem filtro, um valor com
    CRLF, aspas ou ponto-e-vírgula quebra (ou injeta) o cabeçalho HTTP.
    """
    host = urlparse(url).netloc or "scan"
    host = re.sub(r"[^A-Za-z0-9._-]", "_", host)
    return host[:60] or "scan"


def _load_paid_scan(scan_id: int, current_user: User, db: Session, formato: str) -> Scan:
    """Valida plano e posse do scan. Compartilhado por XLSX e PDF."""
    if current_user.plan not in PAID_PLANS:
        raise HTTPException(
            status_code=403,
            detail=f"Exportação para {formato} está disponível apenas nos planos Pro e Premium.",
        )

    scan = db.query(Scan).filter(Scan.id == scan_id, Scan.user_id == current_user.id).first()
    if not scan or not scan.raw_data:
        raise HTTPException(status_code=404, detail="Scan data not found or still processing.")
    return scan


# NOTA: as chaves de scan.raw_data são snake_case. raw_data vem de
# jsonable_encoder(audit_result), que serializa a dataclass via asdict e
# ignora o to_dict() camelCase dos models. Ler "estimatedRiskExposure" aqui
# devolve sempre vazio.

@router.get("/xlsx/{scan_id}")
@router.get("/excel/{scan_id}")  # alias: o frontend chama /excel
def export_scan_xlsx(
    scan_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Exports Scan findings to XLSX. Available only for Pro/Premium."""
    scan = _load_paid_scan(scan_id, current_user, db, "XLSX")

    wb = openpyxl.Workbook()

    # Overview Sheet
    ws1 = wb.active
    ws1.title = "Resumo do Scan"
    ws1.append(["URL Auditada:", scan.url])
    ws1.append(["Data do Scan:", str(scan.completed_at)])
    ws1.append(["Score de Conformidade:", f"{scan.score}/100"])

    data = scan.raw_data or {}
    tags = data.get("tags") or []
    privacy = data.get("privacy") or {}
    duplicates = data.get("duplicates") or []

    ws1.append(["Total de Tags Detectadas:", len(tags)])
    ws1.append(["Ferramenta de Consentimento:", "Sim" if privacy.get("has_consent_tool") else "Não"])
    if privacy.get("total_violations"):
        ws1.append(["Violações de Privacidade:", privacy.get("total_violations")])
        ws1.append(["Exposição Estimada:", privacy.get("estimated_risk_exposure", "")])

    # Tags Sheet
    ws2 = wb.create_sheet("Tags e Analytics")
    ws2.append(["ID", "Name", "Type", "Risk", "Found on Line", "Loaded Before Consent?"])
    for t in tags:
        ws2.append([
            t.get("tagId", "N/A"),
            t.get("name", "Unknown"),
            t.get("type", "Unknown"),
            t.get("lgpdRisk", "medium"),
            t.get("lineNumber", "Unknown"),
            "Sim" if t.get("isBeforeConsent") else "Não"
        ])

    # Privacy Violations Sheet
    if privacy.get("violations"):
        ws3 = wb.create_sheet("Violações de Privacidade")
        ws3.append(["Severidade", "Resumo", "Descrição", "Recomendação"])
        for v in privacy.get("violations"):
            ws3.append([
                v.get("severity", "medium"),
                v.get("summary", ""),
                v.get("description", ""),
                v.get("recommendation", "")
            ])

    # Duplicates Sheet
    if duplicates:
        ws4 = wb.create_sheet("Duplicidades Identificadas")
        ws4.append(["Severidade", "Entidade", "Nome", "Contagem", "Recomendação"])
        for d in duplicates:
            ws4.append([
                d.get("severity", ""),
                d.get("entity_type", ""),
                d.get("name", ""),
                d.get("occurrence_count", 0),
                d.get("recommendation", "")
            ])

    # Save to memory stream
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"GTM_Audit_{_safe_filename_part(scan.url)}_{datetime.now().strftime('%Y%m%d')}.xlsx"

    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/pdf/{scan_id}")
def export_scan_pdf(
    scan_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Exports Scan findings to PDF. Available only for Pro/Premium."""
    scan = _load_paid_scan(scan_id, current_user, db, "PDF")

    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=letter)

    # Title
    c.setFont("Helvetica-Bold", 20)
    c.drawString(50, 750, "DataTrust Audit - Relatório de Scan")

    c.setFont("Helvetica", 12)
    c.drawString(50, 720, f"URL: {scan.url}")
    c.drawString(50, 700, f"Data: {scan.completed_at}")
    c.drawString(50, 680, f"Score de Conformidade: {scan.score}/100")

    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 640, "Resumo Executivo")
    c.setFont("Helvetica", 12)

    data = scan.raw_data or {}
    privacy = data.get("privacy") or {}
    tags = data.get("tags") or []
    duplicates = data.get("duplicates") or []

    c.drawString(50, 620, f"Total de Tags: {len(tags)}")
    has_cmp = "Sim" if privacy.get("has_consent_tool") else "Não"
    c.drawString(50, 600, f"Gestão de Consentimento Ativa (CMP): {has_cmp}")
    c.drawString(50, 580, f"Violações Encontradas: {privacy.get('total_violations', 0)}")

    if privacy.get("estimated_risk_exposure"):
        c.drawString(50, 560, f"Risco de Exposição: {privacy.get('estimated_risk_exposure')}")

    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 520, "Tags Detectadas")
    c.setFont("Helvetica", 10)

    y = 500
    for t in tags[:10]:  # Limit to top 10 for basic PDF to avoid pagination complexity
        tag_str = f"- {t.get('name')} ({t.get('type')}) - Risco LGPD: {t.get('lgpdRisk')} - Antes do Cookie: {'Sim' if t.get('isBeforeConsent') else 'Não'}"
        c.drawString(50, y, tag_str)
        y -= 20
        if y < 50:
            break

    if len(tags) > 10:
        c.drawString(50, y, f"... mais {len(tags) - 10} tags encontradas.")

    y -= 40
    if y > 100 and duplicates:
        c.setFont("Helvetica-Bold", 14)
        c.drawString(50, y, "Duplicidades Recorrentes")
        y -= 20
        c.setFont("Helvetica", 10)
        for d in duplicates[:5]:
            c.drawString(50, y, f"- {d.get('name')} (Risco: {d.get('severity')}) - {d.get('occurrence_count')}x")
            y -= 20

    c.save()
    stream.seek(0)

    filename = f"GTM_Audit_{_safe_filename_part(scan.url)}.pdf"

    return StreamingResponse(
        stream,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
