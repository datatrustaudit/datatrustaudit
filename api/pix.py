"""PIX direto na chave, confirmado à mão.

O dinheiro não passa por intermediário: o cliente paga na chave do recebedor e
alguém confirma que entrou. Isso troca a taxa do gateway por um passo manual —
e é esse passo que precisa ser à prova de erro, porque ele libera acesso pago.

Quatro decisões de segurança, e o porquê de cada uma:

1. **O botão do e-mail leva a uma página, não a um endpoint que já libera.**
   Scanners de link do Gmail, do Outlook e de antivírus corporativo abrem os
   links de um e-mail sozinhos, antes de qualquer humano clicar. Um `GET` que
   libera plano seria disparado por eles, e o acesso sairia de graça sem
   ninguém ter apertado nada. Aqui o `GET` só LÊ o pedido; quem libera é um
   `POST`, que scanner nenhum dispara.

2. **O token é guardado como hash.** O valor em claro só existe no e-mail.
   Vazamento do banco não vira liberação de graça.

3. **A confirmação é idempotente.** Reenvio do e-mail, duplo clique e retry do
   navegador acontecem. Confirmar duas vezes somaria dois períodos de acesso
   por um pagamento só — foi assim que o webhook do Mercado Pago já somou um
   ano a cada reentrega.

4. **O valor é gravado na criação e nunca recalculado.** É o valor que o
   cliente viu e pagou; recalcular na confirmação faria uma mudança de tabela
   reescrever o passado.
"""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from api import emails
from api.auth import get_current_active_user
from api.payments import VALID_PAID_PLANS, _ativar_plano, preco_com_metodo
from api.pix_brcode import gerar_brcode
from db.database import get_db
from db.models import PedidoPix, User, utcnow

router = APIRouter(prefix="/api/payments/pix", tags=["PIX"])

#: Prazo do código de pagamento. Só vale para o cliente pagar — a confirmação
#: do dono continua possível depois, senão um PIX legítimo feito no minuto 29
#: ficaria impossível de liberar.
MINUTOS_ATE_EXPIRAR = int(os.getenv("PIX_MINUTOS_VALIDADE", "30"))


def _chave_pix() -> str:
    return (os.getenv("PIX_CHAVE") or "").strip()


def _hash_do_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _expirado(pedido: PedidoPix) -> bool:
    fim = pedido.expira_em
    if fim is None:
        return False
    # SQLite devolve naive; `utcnow()` também é naive de propósito. Comparar
    # aware com naive levanta TypeError e derrubaria justamente a rota que
    # libera acesso já pago.
    if fim.tzinfo is not None:
        fim = fim.replace(tzinfo=None)
    return utcnow() > fim


def _publico(pedido: PedidoPix) -> Dict[str, Any]:
    """O que a tela do cliente precisa. Sem token e sem hash."""
    return {
        "id": pedido.id,
        "txid": pedido.txid,
        "plano": pedido.plano,
        "valor": round(pedido.valor, 2),
        "status": "expirado" if (pedido.status == "aguardando" and _expirado(pedido)) else pedido.status,
        "criadoEm": pedido.criado_em.isoformat() if pedido.criado_em else None,
        "expiraEm": pedido.expira_em.isoformat() if pedido.expira_em else None,
        "avisadoEm": pedido.avisado_em.isoformat() if pedido.avisado_em else None,
        "confirmadoEm": pedido.confirmado_em.isoformat() if pedido.confirmado_em else None,
    }


@router.post("/pedido")
def criar_pedido(
    payload: dict,
    tarefas: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Cria a cobrança e devolve a chave, o valor e o copia-e-cola."""
    plano = str(payload.get("plan") or payload.get("plano") or "premium").lower()
    if plano not in VALID_PAID_PLANS:
        raise HTTPException(status_code=400, detail="Plano inválido")

    chave = _chave_pix()
    if not chave:
        # Sem chave o cliente veria uma tela de pagamento sem para onde pagar.
        raise HTTPException(
            status_code=503,
            detail="Pagamento por PIX indisponível no momento.",
        )

    # O valor sai da tabela do servidor com o desconto do PIX aplicado aqui —
    # nunca do que o cliente mandou. Aceitar `valor` do corpo deixaria comprar
    # o premium por um real.
    valor = preco_com_metodo(plano, "pix")
    if valor <= 0:
        raise HTTPException(status_code=400, detail="Plano sem preço configurado.")

    # Reaproveita um pedido ainda válido do mesmo usuário e plano: recarregar a
    # página não pode gerar cobrança nova, senão o cliente paga duas vezes e o
    # painel enche de pedidos órfãos.
    existente = (
        db.query(PedidoPix)
        .filter(
            PedidoPix.user_id == current_user.id,
            PedidoPix.plano == plano,
            PedidoPix.status.in_(("aguardando", "avisado")),
        )
        .order_by(PedidoPix.id.desc())
        .first()
    )
    if existente is not None and not _expirado(existente):
        pedido = existente
    else:
        agora = utcnow()
        pedido = PedidoPix(
            user_id=current_user.id,
            plano=plano,
            valor=valor,
            # Curto, sem hífen e sem ambiguidade — vai no BR Code, onde só
            # letras e números são aceitos.
            txid=f"DTA{secrets.token_hex(5).upper()}",
            status="aguardando",
            criado_em=agora,
            expira_em=agora + timedelta(minutes=MINUTOS_ATE_EXPIRAR),
        )
        db.add(pedido)
        db.commit()
        db.refresh(pedido)

    brcode = gerar_brcode(
        chave=chave,
        valor=pedido.valor,
        nome_recebedor=os.getenv("PIX_NOME_RECEBEDOR") or "DataTrust Audit",
        cidade=os.getenv("PIX_CIDADE") or "Sao Paulo",
        txid=pedido.txid,
    )

    # Em segundo plano: a tela não pode esperar o Resend para mostrar a chave.
    tarefas.add_task(
        emails.instrucoes_de_pix_ao_cliente,
        email_do_cliente=current_user.email,
        plano=pedido.plano,
        valor=pedido.valor,
        chave=chave,
        brcode=brcode,
        minutos=MINUTOS_ATE_EXPIRAR,
    )

    return {**_publico(pedido), "chave": chave, "brcode": brcode, "minutos": MINUTOS_ATE_EXPIRAR}


@router.post("/avisei")
def cliente_avisa_que_pagou(
    payload: dict,
    tarefas: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """O cliente declara ter pago. Isso NÃO libera nada — só avisa o dono."""
    pedido_id = payload.get("pedidoId") or payload.get("pedido_id")
    pedido = (
        db.query(PedidoPix)
        .filter(PedidoPix.id == pedido_id, PedidoPix.user_id == current_user.id)
        .first()
    )
    if pedido is None:
        # 404 e não 403: confirmar que o id existe permitiria varrer os pedidos
        # dos outros.
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    if pedido.status == "confirmado":
        return {**_publico(pedido), "jaConfirmado": True}

    # Token novo a cada aviso, e o anterior deixa de valer: se o cliente
    # avisar duas vezes, o dono pode ter dois e-mails na caixa, e o antigo não
    # pode continuar liberando.
    token = secrets.token_urlsafe(32)
    pedido.token_hash = _hash_do_token(token)
    pedido.status = "avisado"
    pedido.avisado_em = utcnow()
    db.commit()
    db.refresh(pedido)

    frontend = (os.getenv("FRONTEND_URL") or "http://localhost:8080").rstrip("/")
    tarefas.add_task(
        emails.avisar_dono_de_pix,
        email_do_cliente=current_user.email,
        nome_do_cliente=current_user.name,
        plano=pedido.plano,
        valor=pedido.valor,
        txid=pedido.txid,
        # Página de confirmação, não endpoint de liberação — ver o docstring
        # do módulo sobre scanner de link.
        link_de_confirmacao=f"{frontend}/admin/confirmar-pix?t={token}",
    )

    return _publico(pedido)


@router.get("/meu-pedido")
def meu_pedido_atual(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Devolve o pedido em aberto do usuário, se houver.

    É o que faz a tela sobreviver a um F5 sem criar cobrança nova.
    """
    pedido = (
        db.query(PedidoPix)
        .filter(
            PedidoPix.user_id == current_user.id,
            PedidoPix.status.in_(("aguardando", "avisado")),
        )
        .order_by(PedidoPix.id.desc())
        .first()
    )
    if pedido is None or _expirado(pedido):
        return {"pedido": None}

    chave = _chave_pix()
    brcode = (
        gerar_brcode(
            chave=chave,
            valor=pedido.valor,
            nome_recebedor=os.getenv("PIX_NOME_RECEBEDOR") or "DataTrust Audit",
            cidade=os.getenv("PIX_CIDADE") or "Sao Paulo",
            txid=pedido.txid,
        )
        if chave
        else None
    )
    return {"pedido": {**_publico(pedido), "chave": chave, "brcode": brcode}}


@router.get("/confirmacao/{token}")
def dados_para_confirmar(token: str, db: Session = Depends(get_db)):
    """Dados do pedido, para a página de confirmação mostrar antes do clique.

    Sem autenticação de propósito: quem tem o token é o dono do e-mail. Esta
    rota só LÊ — é ela que os scanners de link vão abrir sozinhos, e abrir não
    pode ter efeito nenhum.
    """
    pedido = db.query(PedidoPix).filter(PedidoPix.token_hash == _hash_do_token(token)).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Link inválido ou já utilizado")

    cliente = db.query(User).filter(User.id == pedido.user_id).first()
    return {
        **_publico(pedido),
        "cliente": {
            "email": cliente.email if cliente else None,
            "nome": cliente.name if cliente else None,
        },
    }


@router.post("/confirmar")
def confirmar_pagamento(
    payload: dict,
    tarefas: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Libera o acesso. `POST` porque scanner de link não faz POST."""
    token = str(payload.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token ausente")

    pedido = db.query(PedidoPix).filter(PedidoPix.token_hash == _hash_do_token(token)).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Link inválido ou já utilizado")

    # Idempotente: reenvio do e-mail, duplo clique e retry do navegador
    # acontecem. Somar dois períodos por um pagamento só é o defeito que o
    # webhook do Mercado Pago já teve.
    if pedido.status == "confirmado":
        return {**_publico(pedido), "jaConfirmado": True}

    cliente = db.query(User).filter(User.id == pedido.user_id).first()
    if cliente is None:
        raise HTTPException(status_code=404, detail="Conta do pedido não existe mais")

    _ativar_plano(db, cliente, pedido.plano, metodo="pix")
    pedido.status = "confirmado"
    pedido.confirmado_em = utcnow()
    pedido.confirmado_por = "link"
    # O token morre no uso. Sem isto, o mesmo link continuaria valendo — e ele
    # circula por e-mail, que é encaminhável.
    pedido.token_hash = None
    db.commit()
    db.refresh(pedido)

    validade = cliente.subscription.current_period_end if cliente.subscription else None
    tarefas.add_task(
        emails.confirmar_pix_ao_cliente,
        email_do_cliente=cliente.email,
        plano=pedido.plano,
        valor=pedido.valor,
        ate_quando=validade.strftime("%d/%m/%Y") if validade else "—",
    )

    return {**_publico(pedido), "cliente": {"email": cliente.email}}
