"""Cria a tabela de pedidos de PIX confirmados à mão.

O PIX passou a ir direto para a chave do recebedor, sem intermediário: o
cliente paga, avisa, e alguém confirma que o dinheiro entrou. Essa tabela é o
registro desse caminho — e precisa existir porque é ele que libera acesso pago.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""
from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pedidos_pix",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("plano", sa.String(), nullable=False),
        sa.Column("valor", sa.Float(), nullable=False),
        sa.Column("txid", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="aguardando"),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("expira_em", sa.DateTime(), nullable=False),
        sa.Column("avisado_em", sa.DateTime(), nullable=True),
        sa.Column("confirmado_em", sa.DateTime(), nullable=True),
        sa.Column("confirmado_por", sa.String(), nullable=True),
        sa.Column("token_hash", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pedidos_pix_id"), "pedidos_pix", ["id"])
    op.create_index(op.f("ix_pedidos_pix_user_id"), "pedidos_pix", ["user_id"])
    op.create_index(op.f("ix_pedidos_pix_status"), "pedidos_pix", ["status"])
    op.create_index(op.f("ix_pedidos_pix_token_hash"), "pedidos_pix", ["token_hash"])
    # Único: o txid identifica a cobrança na conciliação bancária. Repetido,
    # deixaria de servir para casar o dinheiro recebido com o pedido certo.
    op.create_index(op.f("ix_pedidos_pix_txid"), "pedidos_pix", ["txid"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_pedidos_pix_txid"), table_name="pedidos_pix")
    op.drop_index(op.f("ix_pedidos_pix_token_hash"), table_name="pedidos_pix")
    op.drop_index(op.f("ix_pedidos_pix_status"), table_name="pedidos_pix")
    op.drop_index(op.f("ix_pedidos_pix_user_id"), table_name="pedidos_pix")
    op.drop_index(op.f("ix_pedidos_pix_id"), table_name="pedidos_pix")
    op.drop_table("pedidos_pix")
