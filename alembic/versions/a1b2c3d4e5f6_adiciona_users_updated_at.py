"""adiciona users.updated_at

Bancos criados antes do Alembic (por create_all) não têm essa coluna. A
migration é idempotente porque o mesmo esquema pode chegar aqui por dois
caminhos: banco novo, criado pela migration inicial (que já traz a coluna), e
banco antigo, carimbado com `alembic stamp` pelo scripts/setup_db.py.

Revision ID: a1b2c3d4e5f6
Revises: 75f2e022606a
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '75f2e022606a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tem_coluna(nome_tabela: str, nome_coluna: str) -> bool:
    inspetor = sa.inspect(op.get_bind())
    if nome_tabela not in inspetor.get_table_names():
        return True  # tabela ausente: nada a fazer aqui
    return nome_coluna in {c["name"] for c in inspetor.get_columns(nome_tabela)}


def upgrade() -> None:
    if not _tem_coluna("users", "updated_at"):
        op.add_column("users", sa.Column("updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    if _tem_coluna("users", "updated_at"):
        op.drop_column("users", "updated_at")
