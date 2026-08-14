from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from db.database import Base


def utcnow() -> datetime:
    """UTC naive — substitui datetime.utcnow(), depreciado a partir do 3.12.

    Mantém naive de propósito: as colunas DateTime não usam timezone=True, e
    misturar aware com naive quebra as comparações de data (ex.: janela semanal
    de scans em api/scans.py).
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    is_admin = Column(Boolean, default=False)  # Internal admin flag — bypasses all limits
    subscription_status = Column(String, default="inactive")  # inactive|active|pending|canceled
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    
    subscription = relationship("Subscription", back_populates="user", uselist=False)
    scans = relationship("Scan", back_populates="user")
    payments = relationship("Payment", back_populates="user")

    @property
    def plan(self):
        """Plano em vigor AGORA — considera admin, status e validade.

        Devolvia plan_name direto: nem Subscription.status (canceled/past_due),
        nem User.subscription_status, nem current_period_end eram consultados em
        lugar nenhum. Um pagamento único valia como acesso vitalício, e cancelar
        não tirava nada.
        """
        if self.is_admin:
            return "premium"

        sub = self.subscription
        if not sub or not sub.plan_name or sub.plan_name == "free":
            return "free"

        # A fonte da verdade é a própria assinatura (Subscription.status e
        # current_period_end). User.subscription_status é só um espelho para o
        # frontend, sincronizado em api/payments._ativar_plano: consultá-lo aqui
        # derrubaria para "free" todo pagante cujo espelho ficasse defasado —
        # errar contra o cliente que pagou é pior do que o inverso.
        if sub.status not in (None, "active"):
            return "free"
        if sub.current_period_end is not None and sub.current_period_end < utcnow():
            return "free"

        return sub.plan_name

    @plan.setter
    def plan(self, value):
        plan_name = value if value in {"free", "pro", "premium"} else "free"
        if self.subscription:
            self.subscription.plan_name = plan_name
        else:
            self.subscription = Subscription(plan_name=plan_name)

    @property
    def effective_plan(self):
        """Returns 'admin' if is_admin, else the normal plan name."""
        if self.is_admin:
            return "admin"
        return self.plan

    @property
    def has_active_subscription(self):
        """Pro/Premium features require active subscription OR admin override.
        Free users can always scan regardless of subscription_status."""
        if self.is_admin:
            return True
        if self.plan == "free":
            return True
        return self.subscription_status == "active"

    @property
    def scans_used(self):
        """Uso semanal registrado na assinatura.

        ATENÇÃO: `weekly_scan_count` não é incrementado por nenhum fluxo — só
        lido aqui e zerado por scripts/create_admin_user.py. Quem conta de
        verdade é a tabela `scans` (api.scans.contar_scans_da_semana), que é a
        fonte usada pelo limite. Para exibir o uso ao usuário, prefira
        api.auth._serialize_user, que recebe a sessão e consulta o valor real;
        esta property fica só para quem não tem sessão em mãos.
        """
        if self.subscription:
            return self.subscription.weekly_scan_count or 0
        return 0

class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    plan_name = Column(String, default="free") # free, pro, premium
    scans_used_this_month = Column(Integer, default=0)  # Kept for backward compat
    weekly_scan_count = Column(Integer, default=0)  # Current weekly scan usage
    weekly_scan_reset_at = Column(DateTime, nullable=True)  # When weekly counter resets
    status = Column(String, default="active") # active, past_due, canceled
    current_period_end = Column(DateTime, nullable=True)
    
    user = relationship("User", back_populates="subscription")

class Scan(Base):
    __tablename__ = "scans"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    url = Column(String, nullable=False)
    status = Column(String, default="pending") # pending, processing, completed, failed, protocol_error, blocked, timeout
    scan_credit_consumed = Column(Boolean, default=False)  # Whether this scan consumed a credit
    created_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime, nullable=True)
    scan_method = Column(String, nullable=True)
    score = Column(Float, nullable=True)
    
    raw_data = Column(JSON, nullable=True)
    
    user = relationship("User", back_populates="scans")
    findings = relationship("Finding", back_populates="scan", cascade="all, delete-orphan")

class Finding(Base):
    __tablename__ = "findings"
    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("scans.id"))
    category = Column(String, nullable=False) # duplicate, consent, parameter, etc.
    severity = Column(String, nullable=False) # low, medium, high, critical
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    evidence = Column(JSON, nullable=True)
    recommendation = Column(Text, nullable=True)
    is_premium = Column(Boolean, default=False)
    
    scan = relationship("Scan", back_populates="findings")

class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    mp_payment_id = Column(String, nullable=True)
    amount = Column(Float, nullable=False)
    status = Column(String, default="pending") # pending, approved, failed
    plan_purchased = Column(String, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="payments")


class PedidoPix(Base):
    """Uma cobrança por PIX direto na chave, confirmada à mão.

    O PIX não passa por intermediário: o cliente paga na chave e alguém
    confirma que o dinheiro entrou. Isso troca a taxa do gateway por um passo
    manual — e é esse passo que este registro precisa deixar auditável, porque
    é ele que libera acesso pago.

    Três decisões que não são óbvias lendo os campos:

    - **O token é guardado como hash.** `token_hash` recebe o SHA-256; o token
      em claro só existe no e-mail. Vazamento do banco não vira liberação de
      plano de graça.
    - **`valor` é gravado na criação, não recalculado na confirmação.** É o
      valor que o cliente viu e pagou. Recalcular depois faria uma mudança de
      preço reescrever o passado.
    - **`expira_em` vale para o pagamento, não para a confirmação.** O PIX
      expira em 30 minutos porque o cliente precisa de um prazo; a confirmação
      do dono continua possível depois disso, senão um pagamento legítimo feito
      no minuto 29 ficaria impossível de liberar.
    """
    __tablename__ = "pedidos_pix"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    plano = Column(String, nullable=False)
    valor = Column(Float, nullable=False)
    #: Curto e único — vai no BR Code e é o que casa o dinheiro recebido com
    #: este pedido quando duas pessoas pagam o mesmo valor no mesmo minuto.
    txid = Column(String, unique=True, index=True, nullable=False)

    #: aguardando → avisado → confirmado. Também: expirado, cancelado.
    status = Column(String, default="aguardando", nullable=False, index=True)

    criado_em = Column(DateTime, default=utcnow, nullable=False)
    expira_em = Column(DateTime, nullable=False)
    #: Quando o cliente declarou ter pago. É o que dispara o e-mail.
    avisado_em = Column(DateTime, nullable=True)
    confirmado_em = Column(DateTime, nullable=True)
    #: Quem liberou: "link" (botão do e-mail) ou "admin:<id>" (painel).
    confirmado_por = Column(String, nullable=True)

    token_hash = Column(String, nullable=True, index=True)

    user = relationship("User")
