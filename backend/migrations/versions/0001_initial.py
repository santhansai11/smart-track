"""Immutable initial schema and Supabase access controls."""

from pathlib import Path
from alembic import op
from sqlalchemy import text

revision = "0001"
down_revision = None


def upgrade():
    root = Path(__file__).resolve().parents[1]
    op.execute(text((root / "schema.sql").read_text()))
    op.execute(text((root / "security.sql").read_text()))


def downgrade():
    raise RuntimeError(
        "Historical competition data is protected. Restore a verified backup instead of destructive downgrade."
    )
