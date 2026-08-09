"""Auditoria de percurso: o funil inteiro, a partir de um HAR.

O scanner abre a home, deslogado. Dado pessoal vaza no checkout, na área do
cliente, na confirmação do pedido — e nenhum scanner do mercado chega lá,
porque nenhum faz login. Aqui o auditor grava o DevTools percorrendo o funil
já autenticado e sobe o arquivo.

Três cuidados que definem esta rota:

- **O HAR é arquivo de fora.** Malformado, gigante ou de outra ferramenta não
  pode derrubar o processo nem encher o disco.
- **PII sai antes de qualquer persistência.** O mascaramento roda aqui, no
  servidor, mesmo havendo um no navegador: quem chamar a API direto entrega o
  arquivo cru.
- **O HAR original nunca é gravado.** Só o resultado da auditoria e a lista de
  onde havia dado pessoal — sem os valores.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from api.audit import _normalize_audit_response
from api.auth import get_current_active_user, resolve_effective_plan
from audit_engine.credit_rules import can_perform_scan, get_weekly_limit
from audit_engine.har_parser import (
    HARInvalido,
    ler_har,
    montar_passos,
    passo_para_scan,
    resumo_do_percurso,
)
from audit_engine.mascarador import mascarar_har, resumo_das_ocorrencias
from audit_engine.orchestrator import run_audit
from db.database import get_db
from db.models import Scan, User, utcnow

router = APIRouter(prefix="/api/trajeto", tags=["Trajeto"])

#: HAR de checkout com corpo de resposta passa de 10 MB sem esforço. O teto
#: existe para o upload não virar vetor de esgotamento de memória — o arquivo é
#: lido inteiro para ser parseado.
MAX_BYTES = 25 * 1024 * 1024

#: Passos auditados por percurso. Cada um roda o motor inteiro; um HAR de
#: navegação longa traria dezenas de telas e o pedido estouraria o timeout.
MAX_PASSOS = 12


def _passo_do_laudo(passo: Dict[str, Any], plano: str, indice: int) -> Dict[str, Any]:
    """Audita um passo e devolve o laudo dele, no formato de `/api/audit`."""
    scan = passo_para_scan(passo)
    resultado = run_audit(scan.url, scan)
    resposta = _normalize_audit_response(scan.url, plano, scan, resultado)
    resposta.pop("_audit_result", None)
    resposta.pop("_scan", None)
    return {
        "ordem": indice + 1,
        "nome": passo["nome"],
        "url": passo["url"],
        "requisicoes": len(passo["requisicoes"]),
        "laudo": resposta,
    }


@router.post("/har")
async def auditar_percurso(
    arquivo: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Recebe um HAR e devolve o laudo de cada passo do percurso."""
    plano = resolve_effective_plan(current_user)

    from api.scans import contar_scans_da_semana

    usados = contar_scans_da_semana(db, current_user.id)
    is_admin = bool(getattr(current_user, "is_admin", False))
    if not can_perform_scan(plano, usados, is_admin):
        limite = get_weekly_limit(plano, is_admin)
        raise HTTPException(
            status_code=403,
            detail=f"Limite semanal atingido ({usados}/{limite} auditorias no plano {plano}).",
        )

    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(status_code=400, detail="O arquivo chegou vazio.")
    if len(conteudo) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"O arquivo tem {len(conteudo) // (1024 * 1024)} MB e o limite é "
                f"{MAX_BYTES // (1024 * 1024)} MB. No DevTools, desmarque "
                f"'Preserve log' e grave só o trecho do funil que quer auditar."
            ),
        )

    try:
        log = ler_har(conteudo)
    except HARInvalido as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Mascarar ANTES de qualquer outra coisa: daqui para a frente nenhum
    # caminho do código vê dado pessoal, nem em log de exceção.
    dados_limpos, ocorrencias = mascarar_har({"log": log})
    log = dados_limpos["log"]

    passos = montar_passos(log)
    if not passos:
        raise HTTPException(
            status_code=400,
            detail="Não encontrei requisições utilizáveis neste HAR.",
        )

    cortados = max(0, len(passos) - MAX_PASSOS)
    passos = passos[:MAX_PASSOS]

    # Cada passo roda o motor completo; em thread para não travar o loop.
    laudos = await asyncio.gather(*[
        asyncio.to_thread(_passo_do_laudo, passo, plano, i)
        for i, passo in enumerate(passos)
    ])

    total_achados = sum(
        (p["laudo"].get("summary") or {}).get("violationsCount", 0) for p in laudos
    )
    gravidade: Dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for p in laudos:
        for nivel, quantos in ((p["laudo"].get("summary") or {}).get("violationsBySeverity") or {}).items():
            if nivel in gravidade:
                gravidade[nivel] += int(quantos or 0)

    # PII agrupada por passo: é o achado exclusivo deste modo, e o que a
    # varredura de home nunca encontraria.
    pii_por_passo: Dict[str, List[Dict[str, Any]]] = {}
    for o in ocorrencias:
        pii_por_passo.setdefault(o["pageref"], []).append({"tipo": o["tipo"], "onde": o["onde"]})
    for indice, passo in enumerate(passos):
        laudos[indice]["dadosPessoais"] = pii_por_passo.get(passo["ref"], [])

    resposta = {
        "success": True,
        "tipo": "trajeto",
        "arquivo": arquivo.filename,
        "resumo": {
            **resumo_do_percurso(passos),
            "passosIgnorados": cortados,
            "violationsCount": total_achados,
            "violationsBySeverity": gravidade,
            "dadosPessoaisEncontrados": resumo_das_ocorrencias(ocorrencias),
        },
        "passos": laudos,
    }

    # Grava o resultado, nunca o HAR. O arquivo original fica só na máquina de
    # quem auditou — é o que permite dizer ao cliente que o dado do checkout
    # dele não entrou no nosso banco.
    try:
        registro = Scan(
            user_id=current_user.id,
            url=passos[0]["url"],
            status="completed",
            completed_at=utcnow(),
            scan_method="har",
            score=(laudos[0]["laudo"].get("score") if laudos else None),
            raw_data=resposta,
            scan_credit_consumed=True,
        )
        db.add(registro)
        db.commit()
        db.refresh(registro)
        resposta["scan_id"] = registro.id
    except Exception as exc:
        db.rollback()
        # O laudo já está pronto; perder o registro não pode custar a resposta.
        print(f"[trajeto] falha ao persistir: {exc}")

    return JSONResponse(resposta)
