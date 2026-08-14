"""Configuração comum dos testes.

As variáveis de ambiente são definidas ANTES de qualquer import do app: tanto
db.database quanto api.auth leem os.getenv no momento do import (e api.auth
levanta RuntimeError se SECRET_KEY não existir).
"""
import os
import tempfile

os.environ.setdefault("SECRET_KEY", "chave-de-teste-com-mais-de-32-caracteres-ok")
os.environ.setdefault("GOOGLE_API_KEY", "")
os.environ.setdefault("PRICE_PRO_BRL", "97")
os.environ.setdefault("PRICE_PREMIUM_BRL", "247")
os.environ.setdefault("RATE_LIMIT_LOGIN", "3/minute")
# Cadastro liberado durante os testes: o padrão de produção (5/hora) barraria
# as próprias fixtures. O limite de login fica baixo de propósito — é ele que o
# teste de força bruta exercita.
os.environ.setdefault("RATE_LIMIT_REGISTER", "1000/minute")

# Nenhum teste fala com o Mercado Pago de verdade.
#
# `db.database` chama `load_dotenv()` no import, então o `.env` do
# desenvolvedor — com o token de PRODUÇÃO — entrava no ambiente dos testes.
# `pytest` passou a criar preferências reais na conta do Mercado Pago; só não
# se percebia porque toda preferência era recusada antes, por causa do
# `auto_return` com URL http. Corrigido o `auto_return`, a suíte começou a
# criar preferências de verdade a cada execução.
#
# Vazio e não `setdefault`: aqui a intenção é sobrescrever o que veio do .env.
# Sem token, `api.payments.sdk` é None e a rota devolve 503 — que é o
# comportamento correto sem credencial. Quem precisa exercitar o caminho feliz
# instala um dublê no lugar do `sdk` (ver `tests/test_pagamento_unico.py`).
os.environ["MP_ACCESS_TOKEN"] = ""

# Banco em arquivo, não :memory: — com o pool padrão do SQLAlchemy cada conexão
# a um :memory: abre um banco novo e vazio, e as tabelas somem entre requisições.
_DB_FILE = os.path.join(tempfile.gettempdir(), "datatrust_test.db")
if os.path.exists(_DB_FILE):
    os.remove(_DB_FILE)
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_FILE}"

import pytest
from fastapi.testclient import TestClient

from db.database import Base, engine, SessionLocal
import db.models  # noqa: F401 — registra as tabelas


@pytest.fixture(scope="session", autouse=True)
def _criar_esquema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    import main
    return TestClient(main.app)


@pytest.fixture()
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()


@pytest.fixture()
def usuario_logado(client):
    """Registra um usuário novo e devolve (headers com token, e-mail)."""
    import uuid
    email = f"teste-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "senha-forte-123", "name": "Usuario de Teste"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, email
