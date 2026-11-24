"""map application users to Supabase Auth identities

Revision ID: 0019_supabase_user_identity
Revises: 0018_capability_control_plane
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op


revision = "0019_supabase_user_identity"
down_revision = "0018_capability_control_plane"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("zid", sa.Uuid(), nullable=True))
    op.create_index("ix_users_zid", "users", ["zid"], unique=True)
    op.alter_column(
        "users",
        "username",
        existing_type=sa.String(length=100),
        type_=sa.String(length=320),
        existing_nullable=False,
    )
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=True,
        existing_nullable=False,
    )


def downgrade() -> None:
    has_supabase_users = op.get_bind().execute(
        sa.text(
            "SELECT 1 FROM users "
            "WHERE zid IS NOT NULL OR password_hash IS NULL OR length(username) > 100 "
            "LIMIT 1"
        )
    ).first()
    if has_supabase_users:
        raise RuntimeError(
            "Cannot downgrade while Supabase-linked users or widened usernames exist"
        )
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=False,
        existing_nullable=True,
    )
    op.alter_column(
        "users",
        "username",
        existing_type=sa.String(length=320),
        type_=sa.String(length=100),
        existing_nullable=False,
    )
    op.drop_index("ix_users_zid", table_name="users")
    op.drop_column("users", "zid")
