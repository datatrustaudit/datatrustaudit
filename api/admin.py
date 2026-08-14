"""Painel interno: pedidos de PIX e troca manual de plano.

Este é o primeiro conjunto de rotas administrativas do produto, e cada uma
delas ou expõe dados de todos os clientes ou concede acesso pago. Uma rota
esquecida sem guarda aqui vale mais para um atacante do que qualquer falha do
resto da API.

Por isso a checagem é uma dependência única (`somente_admin`), declarada no
`APIRouter` e não em cada função: rota nova entra protegida por padrão, e
esquecer de adicionar o `Depends` deixa de ser possível. Divergência silenciosa
de autenticação em rota nova já expôs dados de frota inteira em outro projeto.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.auth import get_current_active_user, _serialize_user
from api.payments import VALID_PAID_PLANS, _ativar_plano
from db.database import get_db
from db.models import PedidoPix, Subscription, User, utcnow


def somente_admin(current_user: User = Depends(get_current_active_user)) -> User:
    """404, não 403.

    403 confirma que a rota existe e que só falta permissão — informação que
    não interessa a quem não é admin. Para quem não pode entrar, o painel
    simplesmente não existe.
    """
    if not bool(getattr(current_user, "is_admin", False)):
        raise HTTPException(status_code=404, detail="Not found")
    return current_user


router = APIRouter(
    prefix="/api/admin",
    tags=["Admin"],
    dependencies=[Depends(somente_admin)],
)


def _pedido_para_o_painel(pedido: PedidoPix, cliente: Optional[User]) -> Dict[str, Any]:
    return {
        "id": pedido.id,
        "txid": pedido.txid,
        "plano": pedido.plano,
        "valor": round(pedido.valor, 2),
        "status": pedido.status,
        "criadoEm": pedido.criado_em.isoformat() if pedido.criado_em else None,
        "expiraEm": pedido.expira_em.isoformat() if pedido.expira_em else None,
        "avisadoEm": pedido.avisado_em.isoformat() if pedido.avisado_em else None,
        "confirmadoEm": pedido.confirmado_em.isoformat() if pedido.confirmado_em else None,
        "confirmadoPor": pedido.confirmado_por,
        "cliente": {
            "id": cliente.id if cliente else None,
            "email": cliente.email if cliente else None,
            "nome": cliente.name if cliente else None,
            "plano": cliente.plan if cliente else None,
        },
    }


@router.get("/pedidos-pix")
def listar_pedidos(
    status: Optional[str] = None,
    limite: int = 100,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Pedidos mais recentes primeiro. `?status=avisado` filtra os que esperam."""
    consulta = db.query(PedidoPix)
    if status:
        consulta = consulta.filter(PedidoPix.status == status)

    # Teto: sem ele, a lista cresce com o produto até a rota estourar o tempo.
    limite = max(1, min(int(limite or 100), 500))
    pedidos = consulta.order_by(PedidoPix.id.desc()).limit(limite).all()

    # Uma consulta para todos os clientes, não uma por pedido.
    ids = {p.user_id for p in pedidos}
    clientes = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}

    return {
        "pedidos": [_pedido_para_o_painel(p, clientes.get(p.user_id)) for p in pedidos],
        "aguardandoConfirmacao": db.query(PedidoPix).filter(PedidoPix.status == "avisado").count(),
    }


@router.post("/pedidos-pix/{pedido_id}/confirmar")
def confirmar_pedido(pedido_id: int, admin: User = Depends(somente_admin), db: Session = Depends(get_db)):
    """Libera o acesso pelo painel, sem depender do link do e-mail."""
    pedido = db.query(PedidoPix).filter(PedidoPix.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    # Idempotente, como a confirmação por link: dois cliques no painel não
    # podem somar dois períodos de acesso por um pagamento só.
    if pedido.status == "confirmado":
        return {"jaConfirmado": True, "pedido": _pedido_para_o_painel(pedido, pedido.user)}

    cliente = db.query(User).filter(User.id == pedido.user_id).first()
    if cliente is None:
        raise HTTPException(status_code=404, detail="Conta do pedido não existe mais")

    _ativar_plano(db, cliente, pedido.plano, metodo="pix")
    pedido.status = "confirmado"
    pedido.confirmado_em = utcnow()
    # Quem liberou fica registrado: numa conferência de caixa, "confirmado" sem
    # autor não responde a pergunta que importa.
    pedido.confirmado_por = f"admin:{admin.id}"
    pedido.token_hash = None
    db.commit()
    db.refresh(pedido)

    return {"pedido": _pedido_para_o_painel(pedido, cliente)}


@router.post("/pedidos-pix/{pedido_id}/cancelar")
def cancelar_pedido(pedido_id: int, db: Session = Depends(get_db)):
    """Marca como cancelado — para pedido que não foi pago.

    Não mexe em plano: cancelar cobrança não é o mesmo que retirar acesso, e
    juntar as duas coisas numa ação só é como se retira acesso de quem pagou
    por engano.
    """
    pedido = db.query(PedidoPix).filter(PedidoPix.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if pedido.status == "confirmado":
        raise HTTPException(
            status_code=409,
            detail="Este pedido já foi confirmado. Para retirar o acesso, mude o plano do cliente.",
        )
    pedido.status = "cancelado"
    pedido.token_hash = None
    db.commit()
    return {"pedido": _pedido_para_o_painel(pedido, pedido.user)}


@router.get("/usuarios")
def listar_usuarios(
    busca: Optional[str] = None,
    limite: int = 50,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    consulta = db.query(User)
    if busca:
        termo = f"%{busca.strip()}%"
        consulta = consulta.filter(User.email.ilike(termo))

    limite = max(1, min(int(limite or 50), 200))
    usuarios = consulta.order_by(User.id.desc()).limit(limite).all()

    # `_serialize_user` recebe o `db` de propósito: sem ele, o uso semanal sai
    # do campo desatualizado em `Subscription` e o painel mostra 0 para todo
    # mundo. Quem conta de verdade é a tabela `scans`.
    return {"usuarios": [_serialize_user(u, db) for u in usuarios]}


@router.post("/usuarios/{user_id}/plano")
def trocar_plano(user_id: int, payload: dict, admin: User = Depends(somente_admin), db: Session = Depends(get_db)):
    """Troca o plano à mão — para venda fora do fluxo, cortesia ou correção."""
    plano = str(payload.get("plano") or payload.get("plan") or "").lower()
    if plano not in VALID_PAID_PLANS and plano != "free":
        raise HTTPException(status_code=400, detail="Plano inválido")

    cliente = db.query(User).filter(User.id == user_id).first()
    if cliente is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if plano == "free":
        # Rebaixar é encerrar a assinatura, não apagá-la: o histórico de quem
        # já pagou precisa continuar existindo.
        assinatura = cliente.subscription
        if assinatura is None:
            assinatura = Subscription(user_id=cliente.id)
            db.add(assinatura)
        assinatura.plan_name = "free"
        assinatura.status = "canceled"
        assinatura.current_period_end = None
        # O espelho lido pelo frontend precisa andar junto, senão os dois
        # campos divergem e o cliente continua vendo o plano antigo.
        cliente.subscription_status = "canceled"
    else:
        _ativar_plano(db, cliente, plano, metodo="manual")

    db.commit()
    db.refresh(cliente)
    print(f"[admin] user {admin.id} trocou o plano de {cliente.email} para {plano}")
    return {"usuario": _serialize_user(cliente, db)}


@router.get("/resumo")
def resumo(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Números do topo do painel."""
    confirmados: List[PedidoPix] = (
        db.query(PedidoPix).filter(PedidoPix.status == "confirmado").all()
    )
    return {
        "usuarios": db.query(User).count(),
        "pagantes": db.query(Subscription).filter(Subscription.status == "active").count(),
        "pedidosAguardando": db.query(PedidoPix).filter(PedidoPix.status == "avisado").count(),
        "pixConfirmados": len(confirmados),
        "totalRecebidoPix": round(sum(p.valor for p in confirmados), 2),
    }
