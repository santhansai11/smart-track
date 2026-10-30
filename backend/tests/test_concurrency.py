from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from app import services as svc
from app.models import *
from .conftest import identity
from .test_workflows import competition


def test_simultaneous_finish_publishes_once(pg_engine):
    # This test commits fixtures so independent connections see the same records.
    with Session(pg_engine) as db, db.begin():
        # No root needed for internal service fixtures; API checks are tested separately.
        admin = identity(db, "Concurrency administrator")
        a, b = identity(db, "Concurrent A"), identity(db, "Concurrent B")
        c, r, rv, code = competition(db, (admin, a, b))
        sa = svc.start_session(db, c.id, a)
        sb = svc.start_session(db, c.id, b)
        db.flush()
        cid, aid, bid, sida, sidb = c.id, a.id, b.id, sa.id, sb.id

    def finish(data):
        sid, uid = data
        with Session(pg_engine) as db, db.begin():
            svc.stop_session(db, sid, db.get(Profile, uid), 0, True)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(finish, [(sida, aid), (sidb, bid), (sida, aid), (sidb, bid)]))
    with Session(pg_engine) as db, db.begin():
        c = db.get(Competition, cid)
        assert c.status == "FINALIZING"
        c.finalize_after = now() - timedelta(seconds=1)

    def publish(_):
        with Session(pg_engine) as db, db.begin():
            return svc.finalize(db, cid)

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(publish, range(4))) == 1
    with Session(pg_engine) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Result)
                .join(Participant, Participant.id == Result.participant_id)
                .where(Participant.competition_id == cid)
            )
            == 2
        )
