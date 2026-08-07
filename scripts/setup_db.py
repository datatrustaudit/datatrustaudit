"""Prepara o banco para rodar — serve tanto para base nova quanto existente.

Rode uma vez antes de subir a aplicação:

    python scripts/setup_db.py

Por que existe: o banco em uso foi criado por `create_all`, antes do Alembic
entrar no projeto. Ele já tem as tabelas mas não tem a tabela de controle
`alembic_version`, então um `alembic upgrade head` direto tentaria criar tudo
de novo e falharia com "table already exists". Este script detecta a situação
e carimba a revisão inicial antes de aplicar o resto.

Não apaga nem reescreve dado nenhum: só cria a tabela de controle e aplica as
migrations que faltam.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from db.database import engine, DATABASE_URL

REVISAO_INICIAL = "75f2e022606a"


def main() -> int:
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config(os.path.join(raiz, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(raiz, "alembic"))

    destino = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL
    print(f"Banco: {destino}")

    inspetor = inspect(engine)
    tabelas = set(inspetor.get_table_names())

    if not tabelas:
        print("Banco vazio — aplicando todas as migrations.")
        command.upgrade(cfg, "head")
        print("OK: esquema criado.")
        return 0

    if "alembic_version" in tabelas:
        print("Banco já versionado — aplicando o que faltar.")
        command.upgrade(cfg, "head")
        print("OK: esquema atualizado.")
        return 0

    # Banco pré-existente, criado por create_all: carimba a revisão inicial
    # (as tabelas dela já existem) e aplica só as migrations posteriores.
    print(f"Banco existente sem controle de versão ({len(tabelas)} tabelas).")
    print(f"Carimbando a revisão inicial {REVISAO_INICIAL} sem recriar nada...")
    command.stamp(cfg, REVISAO_INICIAL)
    print("Aplicando as migrations posteriores...")
    command.upgrade(cfg, "head")
    print("OK: banco preservado e atualizado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
