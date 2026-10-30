"""Synthetic 3-hour sessions, real PostgreSQL transactions. Use a disposable test DB."""

import argparse, json, math, os, time, statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from app.models import *
from app import services as svc
from app.schemas import GPSBatch, RouteInput, RoomInput, PointInput
from tests.conftest import identity


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runners", type=int, default=12)
    parser.add_argument("--interval", type=int, choices=[2, 3, 5], default=3)
    parser.add_argument("--output", default="benchmark-results.json")
    args = parser.parse_args()
    url = os.environ["TEST_DATABASE_URL"]
    if "smarttrack_test" not in url:
        raise SystemExit("Benchmark requires a dedicated smarttrack_test database")
    engine = create_engine(
        url,
        pool_size=min(args.runners, 20),
        max_overflow=0,
        connect_args={"prepare_threshold": None},
    )
    coords = [
        [
            12 + 0.0006 * math.cos(i * 2 * math.pi / 96),
            77 + 0.0006 * math.sin(i * 2 * math.pi / 96),
        ]
        for i in range(96)
    ]
    start = now() - timedelta(hours=3, minutes=1)
    with Session(engine) as db, db.begin():
        admin = identity(db, "Benchmark operator")
        rv = svc.create_route(
            db, RouteInput(name="Benchmark track", coordinates=coords), admin
        )
        r, code = svc.create_room(
            db,
            RoomInput(
                name="Synthetic benchmark",
                route_version_id=rv.id,
                capacity=args.runners,
            ),
            admin,
        )
        runners = [identity(db, f"Benchmark {i}") for i in range(args.runners)]
        for runner in runners:
            svc.join_room(db, code, runner)
        db.flush()
        c = svc.lock_room(db, r.id, admin)
        svc.start_competition(db, c.id, admin)
        db.flush()
        tasks = []
        for runner in runners:
            s = svc.start_session(db, c.id, runner)
            db.flush()
            db.scalar(select(Segment).where(Segment.session_id == s.id)).started_at = (
                start
            )
            tasks.append((runner.id, s.id))
    latencies = []

    def upload(task):
        uid, sid = task
        local = []
        # ~2.9 m/s, 144-second laps independent of sample interval.
        points = []
        for i in range(10800 // args.interval + 1):
            theta = (i * args.interval / 144) * 2 * math.pi
            points.append(
                PointInput(
                    seq=i + 1,
                    captured_at=start + timedelta(seconds=i * args.interval),
                    latitude=12 + 0.0006 * math.cos(theta),
                    longitude=77 + 0.0006 * math.sin(theta),
                    accuracy_m=5,
                )
            )
        for i in range(0, len(points), 200):
            begin = time.perf_counter()
            with Session(engine) as db, db.begin():
                svc.ingest(
                    db, sid, GPSBatch(points=points[i : i + 200]), db.get(Profile, uid)
                )
            local.append(time.perf_counter() - begin)
        return local

    begin = time.perf_counter()
    with ThreadPoolExecutor(max_workers=min(args.runners, 20)) as pool:
        for result in pool.map(upload, tasks):
            latencies.extend(result)
    elapsed = time.perf_counter() - begin
    with engine.connect() as conn:
        conn.execute(text("ANALYZE gps_track_points"))
        storage = conn.execute(
            text(
                "SELECT pg_total_relation_size('gps_track_points'),(SELECT count(*) FROM gps_track_points)"
            )
        ).one()
        plan = (
            conn.execute(
                text(
                    "EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM gps_track_points WHERE session_id=:sid AND seq>1000 ORDER BY seq LIMIT 200"
                ),
                {"sid": tasks[0][1]},
            )
            .scalars()
            .all()
        )
        summary_plan = (
            conn.execute(
                text(
                    "EXPLAIN (ANALYZE,BUFFERS) SELECT lap_count,distance_m,partial_m FROM running_sessions WHERE participant_id=(SELECT participant_id FROM running_sessions WHERE id=:sid)"
                ),
                {"sid": tasks[0][1]},
            )
            .scalars()
            .all()
        )
    report = {
        "database": "PostgreSQL local test instance; not a Supabase capacity guarantee",
        "runners": args.runners,
        "simulated_hours_each": 3,
        "sample_seconds": args.interval,
        "points_uploaded": args.runners * (10800 // args.interval + 1),
        "wall_seconds": round(elapsed, 3),
        "batch_p50_ms": round(statistics.median(latencies) * 1000, 2),
        "batch_p95_ms": round(sorted(latencies)[int(len(latencies) * 0.95)] * 1000, 2),
        "gps_relation_bytes": storage[0],
        "gps_total_rows": storage[1],
        "bytes_per_point_including_index": round(storage[0] / storage[1], 1),
        "history_query_plan": plan,
        "summary_query_plan": summary_plan,
    }
    from pathlib import Path

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if "plan" not in k}, indent=2))


if __name__ == "__main__":
    main()
