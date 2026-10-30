"""Indexes for finalizer and evidence queries; protect snapshot/ranking mutations."""

from alembic import op
from sqlalchemy import text

revision = "0002"
down_revision = "0001"


def upgrade():
    op.execute(
        text(
            "CREATE INDEX competition_finalization_due ON competitions(finalize_after) WHERE status='FINALIZING'"
        )
    )
    op.execute(
        text(
            "CREATE INDEX lap_evidence_ranges ON lap_records(session_id,from_seq,to_seq)"
        )
    )
    op.execute(
        text(
            """CREATE FUNCTION public.freeze_ranking_rules() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.ranking_rules::text<>OLD.ranking_rules::text THEN RAISE EXCEPTION 'Ranking snapshot is immutable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER freeze_ranking_rules BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION public.freeze_ranking_rules();"""
        )
    )
    # Security-definer auth triggers need an owner; application DML uses the
    # configured private database role and is never exposed through the Data API.
    op.execute(
        text(
            """CREATE FUNCTION public.guard_lap_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
      BEGIN
       IF NOT EXISTS(SELECT 1 FROM public.gps_track_points WHERE session_id=NEW.session_id AND seq=NEW.from_seq)
          OR NOT EXISTS(SELECT 1 FROM public.gps_track_points WHERE session_id=NEW.session_id AND seq=NEW.to_seq)
       THEN RAISE EXCEPTION 'Lap requires original GPS evidence'; END IF;
       RETURN NEW;
      END $$;
      CREATE CONSTRAINT TRIGGER require_lap_evidence AFTER INSERT ON lap_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_lap_evidence();"""
        )
    )


def downgrade():
    op.execute("DROP TRIGGER require_lap_evidence ON lap_records")
    op.execute("DROP FUNCTION public.guard_lap_evidence()")
    op.execute("DROP TRIGGER freeze_ranking_rules ON competitions")
    op.execute("DROP FUNCTION public.freeze_ranking_rules()")
    op.drop_index("lap_evidence_ranges")
    op.drop_index("competition_finalization_due")
