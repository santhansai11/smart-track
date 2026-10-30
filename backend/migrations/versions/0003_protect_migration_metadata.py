"""Keep migration metadata inaccessible through Supabase's public Data API."""

from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON public.alembic_version FROM anon, authenticated")


def downgrade():
    # Retain access protection even when rolling back this metadata revision.
    pass
