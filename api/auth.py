import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from pydantic import BaseModel, EmailStr

from api.rate_limit import limiter, RATE_LIMIT_LOGIN, RATE_LIMIT_REGISTER
from db.database import get_db
from db.models import User, utcnow

# Configuration
# Sem valor padrão de propósito: com o fallback anterior
# ("super-secret-key-change-in-production"), qualquer deploy que subisse sem a
# variável definida usava uma chave pública — e quem a conhecesse assinava um
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
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128  # bcrypt trunca em 72 bytes; acima disso é só custo de CPU

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token", auto_error=False)

# Hash descartável para gastar o mesmo tempo quando o e-mail não existe: sem
# isso, login de e-mail inexistente responde na hora e o de e-mail real só
# depois de um bcrypt — a diferença revela quem tem conta.
_DUMMY_HASH = pwd_context.hash("timing-attack-placeholder")

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
    is_admin: bool = False
    subscription_status: str = "inactive"
    effective_plan: str = "free"
    scans_limit: int = 10
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str


def auth_error(message: str, error_code: str, status_code: int = 400, errors: Optional[list] = None):
    return JSONResponse(
        {
            "success": False,
            "message": message,
            "errorCode": error_code,
            "errors": errors or [],
        },
        status_code=status_code,
    )

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

    email = None
    supabase_user_name = None

    # Try local JWT first
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
    except JWTError:
        pass

    # If local JWT failed, try Supabase JWT
    if not email and SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token, SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False}
            )
            email = payload.get("email")
            # Extract user metadata for auto-creation
            user_metadata = payload.get("user_metadata", {})
            supabase_user_name = user_metadata.get("full_name") or user_metadata.get("name", "")
        except JWTError:
            pass

    if not email:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()

    # Auto-create user from Supabase if not found locally
    if user is None and supabase_user_name is not None:
        try:
            new_user = User(
                email=email,
                hashed_password=get_password_hash(os.urandom(32).hex()),
                name=supabase_user_name or email.split("@")[0],
                plan="free"
            )
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            user = new_user
        except (IntegrityError, SQLAlchemyError):
            db.rollback()
            user = db.query(User).filter(User.email == email).first()

    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return current_user

# --- Weekly scan limits ---
WEEKLY_SCAN_LIMITS = {
    "free": 10,
    "pro": 50,
    "premium": 200,
    "admin": -1,  # unlimited
}

def _get_scans_limit(user: User) -> int:
    """Return the weekly scan limit for the user."""
    if user.is_admin:
        return -1
    return WEEKLY_SCAN_LIMITS.get(user.plan, 10)

def _serialize_user(user: User, db: Optional[Session] = None) -> dict:
    """Build user response dict with admin fields.

    Com `db`, `scans_used` vem da contagem real da tabela `scans` — a mesma
    fonte que o limite usa. Sem isso, o valor vinha de
    Subscription.weekly_scan_count, campo que nenhum fluxo incrementa: o painel
    mostrava 0 auditorias usadas enquanto o usuário já levava 403 por limite.
    """
    if db is not None:
        from api.scans import contar_scans_da_semana
        scans_used = contar_scans_da_semana(db, user.id)
    else:
        scans_used = user.scans_used

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "plan": user.plan,
        "scans_used": scans_used,
        "is_admin": bool(user.is_admin),
        "subscription_status": user.subscription_status or "inactive",
        "effective_plan": user.effective_plan,
        "scans_limit": _get_scans_limit(user),
    }

# --- Routes ---

@router.post("/register", response_model=Token)
@limiter.limit(RATE_LIMIT_REGISTER)
def register_user(request: Request, user: UserCreate, db: Session = Depends(get_db)):
    if not user.name or not user.name.strip():
        return auth_error("Verifique seus dados e tente novamente.", "NAME_REQUIRED", 422)

    if len(user.password or "") < MIN_PASSWORD_LENGTH:
        return auth_error(
            f"A senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.",
            "PASSWORD_TOO_SHORT", 422,
        )
    if len(user.password or "") > MAX_PASSWORD_LENGTH:
        return auth_error("Senha longa demais.", "PASSWORD_TOO_LONG", 422)

    try:
        # e-mail normalizado: sem isso, Ale@x.com e ale@x.com viram duas contas
        # e o login por uma delas não encontra a outra.
        email = user.email.strip().lower()
        db_user = db.query(User).filter(User.email == email).first()
        if db_user:
            return auth_error("Este e-mail já pode estar cadastrado.", "EMAIL_ALREADY_REGISTERED", 409)

        hashed_password = get_password_hash(user.password)
        new_user = User(
            email=email,
            hashed_password=hashed_password,
            name=user.name.strip(),
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
    except IntegrityError:
        db.rollback()
        return auth_error("Este e-mail já pode estar cadastrado.", "EMAIL_ALREADY_REGISTERED", 409)
    except SQLAlchemyError:
        db.rollback()
        return auth_error("Não foi possível criar sua conta. Tente novamente.", "SIGNUP_FAILED", 500)
    except Exception:
        db.rollback()
        return auth_error("Não foi possível criar sua conta. Tente novamente.", "SIGNUP_FAILED", 500)

@router.post("/token", response_model=Token)
@limiter.limit(RATE_LIMIT_LOGIN)
def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username.strip().lower()).first()

    # Verifica a senha mesmo sem usuário, contra um hash descartável, para que
    # e-mail existente e inexistente levem o mesmo tempo de resposta.
    senha_confere = verify_password(
        form_data.password, user.hashed_password if user else _DUMMY_HASH
    )

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

@router.get("/me")
def read_users_me(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    return _serialize_user(current_user, db)
