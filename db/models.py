from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from db.database import Base


def utcnow() -> datetime:
    """UTC naive — substitui datetime.utcnow(), removido/deprecado a partir do 3.12.

    Mantém naive de propósito: as colunas DateTime não usam timezone=True, e
    misturar aware com naive quebra as comparações de data (ex.: filtro de
    scans do mês em api/scans.py).
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    
    subscription = relationship("Subscription", back_populates="user", uselist=False)
    scans = relationship("Scan", back_populates="user")
    payments = relationship("Payment", back_populates="user")

    @property
    def plan(self):
        """Plano em vigor AGORA — considera status e validade da assinatura.

        Antes devolvia plan_name direto: quem pagasse uma vez ficava pro para
        sempre, porque nem `status` (canceled/past_due) nem `current_period_end`
        eram consultados em lugar nenhum do sistema.
        """
        sub = self.subscription
        if not sub or not sub.plan_name or sub.plan_name == "free":
            return "free"
        if sub.status != "active":
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

class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    plan_name = Column(String, default="free") # free, pro, premium
    # OBSOLETO: nunca foi incrementado por nenhum fluxo. O uso do mês é contado
    # na tabela `scans` (api.audit._monthly_usage). Coluna mantida porque
    # existe no banco; remover exige migration.
    scans_used_this_month = Column(Integer, default=0)
    status = Column(String, default="active") # active, past_due, canceled
    current_period_end = Column(DateTime, nullable=True)
    
    user = relationship("User", back_populates="subscription")

class Scan(Base):
    __tablename__ = "scans"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    url = Column(String, nullable=False)
    status = Column(String, default="pending") # pending, processing, completed, failed
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
