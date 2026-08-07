"""Limiter compartilhado.

Fica num módulo próprio porque tanto main.py quanto os routers em api/ precisam
dele — se morasse no main.py, api/auth.py importar de lá fecharia um ciclo
(main → api.auth → main).

Os limites saem do ambiente para poderem ser afrouxados sem deploy.

Produção com mais de um processo: defina RATE_LIMIT_STORAGE_URI apontando para
o Redis (ex.: redis://host:6379/1). Com o padrão "memory://" cada worker conta
separado, e o teto real vira N × o configurado.
"""
import os

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=os.getenv("RATE_LIMIT_STORAGE_URI", "memory://"),
)

RATE_LIMIT_SCAN = os.getenv("RATE_LIMIT_SCAN", "10/hour")
RATE_LIMIT_DEEP_SCAN = os.getenv("RATE_LIMIT_DEEP_SCAN", "3/hour")
RATE_LIMIT_CHAT = os.getenv("RATE_LIMIT_CHAT", "20/hour")
RATE_LIMIT_LOGIN = os.getenv("RATE_LIMIT_LOGIN", "10/minute")
RATE_LIMIT_REGISTER = os.getenv("RATE_LIMIT_REGISTER", "5/hour")
