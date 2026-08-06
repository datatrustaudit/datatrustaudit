import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from api.rate_limit import limiter, RATE_LIMIT_LOGIN, RATE_LIMIT_REGISTER
from db.database import get_db
from db.models import User, utcnow

# Configuration
# Sem valor padrão de propósito: com o fallback anterior
# ("super-secret-key-change-in-production"), qualquer deploy que subisse sem a
# variável definida usava uma chave pública — e quem a conhecesse assinaria um
# JWT válido para qualquer e-mail, virando qualquer usuário do sistema.
# Falhar no boot é melhor do que subir autenticação de mentira.
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
MIN_SECRET_KEY_LENGTH = 32

if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY não definida. Gere uma com: python -c \"import secrets; print(secrets.token_urlsafe(48))\" "
        "e coloque no .env antes de subir a aplicação."
    )
if len(SECRET_KEY) < MIN_SECRET_KEY_LENGTH:
    raise RuntimeError(
        f"SECRET_KEY curta demais ({len(SECRET_KEY)} caracteres; mínimo {MIN_SECRET_KEY_LENGTH})."
    )

ALGORITHM = os.getenv("ALGORITHM", "HS256")
# Estava fixo em 7 dias no código, ignorando a variável de mesmo nome no .env.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24)))

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128  # bcrypt trunca em 72 bytes; acima disso é só custo de CPU

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token", auto_error=False)

# Hash descartável usado para gastar o mesmo tempo quando o e-mail não existe.
# Sem isso, o login responde na hora para e-mail inexistente e só depois de um
# bcrypt para e-mail real: a diferença de tempo permite descobrir quem tem conta.
_DUMMY_HASH = pwd_context.hash("timing-attack-placeholder")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- Pydantic Models ---
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None

class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: Optional[str]
    plan: str
    scans_used: int
    scans_limit: int

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

# --- Utils ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = utcnow() + expires_delta
    else:
        expire = utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    if not token:
        return None # Return None for public/unauthenticated access (Free 1-time scan)
        
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return current_user


VALID_PLANS = {"free", "pro", "premium"}


def resolve_effective_plan(current_user: Optional[User]) -> str:
    """Plano válido para esta requisição — decidido só pelo banco.

    Nunca aceita o plano vindo do corpo da requisição. Antes, tanto /analyze
    quanto /api/audit usavam o campo `plan` do cliente quando não havia usuário
    logado: mandar {"plan": "premium"} (ou "full" em /analyze) devolvia o
    relatório pago inteiro, sem login e sem pagamento.
    """
    if current_user is None:
        return "free"
    plan = getattr(current_user, "plan", None)
    return plan if plan in VALID_PLANS else "free"

# --- Routes ---

@router.post("/register", response_model=Token)
@limiter.limit(RATE_LIMIT_REGISTER)
def register_user(request: Request, user: UserCreate, db: Session = Depends(get_db)):
    if len(user.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"A senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.",
        )
    if len(user.password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"A senha pode ter no máximo {MAX_PASSWORD_LENGTH} caracteres.",
        )

    email = user.email.strip().lower()
    db_user = db.query(User).filter(User.email == email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = get_password_hash(user.password)
    new_user = User(
        email=email,
        hashed_password=hashed_password,
        name=user.name,
        plan="free"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": new_user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/token", response_model=Token)
@limiter.limit(RATE_LIMIT_LOGIN)
def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username.strip().lower()).first()

    # Verifica a senha mesmo sem usuário, contra um hash descartável, para que
    # e-mail existente e inexistente levem o mesmo tempo de resposta.
    hash_para_conferir = user.hashed_password if user else _DUMMY_HASH
    senha_confere = verify_password(form_data.password, hash_para_conferir)

    if not user or not senha_confere:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserOut)
def read_users_me(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Dados do usuário logado, com o uso real do mês.

    `scans_used` vinha de Subscription.scans_used_this_month, campo que nenhum
    fluxo jamais incrementava — o painel mostrava 0 auditorias usadas enquanto
    o limite, que conta pela tabela `scans`, já barrava o usuário com 403.
    """
    from api.audit import _monthly_usage

    usados, limite = _monthly_usage(db, current_user, current_user.plan)
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        plan=current_user.plan,
        scans_used=usados,
        scans_limit=limite,
    )
