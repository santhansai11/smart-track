"""Bounded maintenance, dry-run by default. Completed-lap evidence is never purged."""

import argparse
from datetime import timedelta
from sqlalchemy import text
from app.db import engine
from app.config import settings
from app.models import now


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--verified-backup", help="Verified backup reference, required for deletion"
    )
    args = parser.parse_args()
    if args.apply and not args.verified_backup:
        parser.error("Provide a verified backup reference")
    cutoff = now() - timedelta(days=max(1, settings().gps_retention_days))
    with engine().begin() as conn:
        rows = conn.execute(
            text(
                """SELECT g.session_id,g.seq FROM gps_track_points g
          JOIN running_sessions s ON s.id=g.session_id JOIN competition_participants p ON p.id=s.participant_id
          JOIN competitions c ON c.id=p.competition_id WHERE c.status='COMPLETED' AND c.published_at<:cutoff AND g.captured_at<:cutoff
          AND NOT EXISTS(SELECT 1 FROM lap_records l WHERE l.session_id=g.session_id AND g.seq BETWEEN l.from_seq AND l.to_seq)
          ORDER BY g.session_id,g.seq LIMIT 10000"""
            ),
            {"cutoff": cutoff},
        ).all()
        print(
            f"{len(rows)} eligible GPS points in this bounded batch; lap evidence is excluded."
        )
        if args.apply and rows:
            conn.execute(text("SET LOCAL smarttrack.retention='enabled'"))
            conn.execute(
                text("DELETE FROM gps_track_points WHERE session_id=:sid AND seq=:seq"),
                [{"sid": r.session_id, "seq": r.seq} for r in rows],
            )
            import uuid, json

            conn.execute(
                text(
                    "INSERT INTO audit_logs(id,created_at,action,details) VALUES(:id,now(),'gps.retention',CAST(:details AS json))"
                ),
                {
                    "id": uuid.uuid4(),
                    "details": json.dumps(
                        {
                            "deleted": len(rows),
                            "backup": args.verified_backup,
                            "cutoff": cutoff.isoformat(),
                        }
                    ),
                },
            )


if __name__ == "__main__":
    main()
