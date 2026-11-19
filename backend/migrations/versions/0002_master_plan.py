"""Master-plan additions: pause, transcript corrections, per-device config, audio retention,
flashcards and revision notes.

Idempotent on purpose: 0001 creates tables from the ORM models, so on a fresh database these
columns and enum values already exist; on a database created by an older 0001 they are added here.

Revision ID: 0002_master_plan
Revises: 0001_initial
Create Date: 2026-11-19
"""

from __future__ import annotations

from alembic import op

revision = "0002_master_plan"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

COLUMNS = (
    ("lectures", "paused", "BOOLEAN NOT NULL DEFAULT false"),
    ("lectures", "audio_purged_at", "TIMESTAMPTZ"),
    ("transcript_segments", "edited", "BOOLEAN NOT NULL DEFAULT false"),
    ("devices", "gain", "DOUBLE PRECISION"),
    ("devices", "vad_enabled", "BOOLEAN"),
)


def upgrade() -> None:
    # ADD VALUE cannot run inside a transaction block on every PostgreSQL version.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE artifact_kind ADD VALUE IF NOT EXISTS 'flashcards'")
        op.execute("ALTER TYPE artifact_kind ADD VALUE IF NOT EXISTS 'revision'")
    for table, column, ddl in COLUMNS:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")


def downgrade() -> None:
    for table, column, _ in COLUMNS:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}")
    # PostgreSQL cannot drop enum values; remove the rows that use them instead.
    op.execute("DELETE FROM lecture_artifacts WHERE kind::text IN ('flashcards', 'revision')")
