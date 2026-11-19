"""Initial schema.

Creates the extensions, then the tables from the ORM models (single source of truth), then the
trigram index when pg_trgm is available (Ubuntu's postgresql-16 package ships it; some embedded
test builds do not, in which case search falls back to an unindexed ILIKE).

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-19
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

from app.db.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    has_trgm = bind.execute(text("SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'")).first()
    if has_trgm:
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    Base.metadata.create_all(bind=bind)
    if has_trgm:
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_segments_text_trgm "
            "ON transcript_segments USING gin (text gin_trgm_ops)"
        )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_segments_embedding ON transcript_segments "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
