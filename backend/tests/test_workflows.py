import hashlib
import math
from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError, DBAPIError
from app import services as svc
from app.models import *
from app.schemas import RouteInput, RoomInput, GPSBatch, PointInput
from .conftest import identity

COORDS = [
    [
        12 + 0.0006 * math.cos(i * 2 * math.pi / 48),
        77 + 0.0006 * math.sin(i * 2 * math.pi / 48),
    ]
    for i in range(48)
]


def competition(db, users):
    root, a, b = users
    rv = svc.create_route(db, RouteInput(name="Campus loop", coordinates=COORDS), root)
    room, code = svc.create_room(
        db, RoomInput(name="Morning runners", route_version_id=rv.id), root
    )
    svc.join_room(db, code, a)
    svc.join_room(db, code, b)
    db.flush()
    c = svc.lock_room(db, room.id, root)
    svc.start_competition(db, c.id, root)
    db.flush()
    return c, room, rv, code


def points(start, seconds=3 * 3600, interval=3):
    # 48 samples per lap, ~2.9 m/s. Continuous monotonic timestamps.
    return [
        PointInput(
            seq=i + 1,
            captured_at=start + timedelta(seconds=i * interval),
            latitude=COORDS[i % 48][0],
            longitude=COORDS[i % 48][1],
            accuracy_m=5,
        )
        for i in range(seconds // interval + 1)
    ]


def test_registration_cannot_promote(db):
    p = identity(db, "Any domain")
    assert p.role == "STUDENT"
    with pytest.raises(DBAPIError), db.begin_nested():
        p.role = "ROOT"
        db.flush()


def test_root_unique(db, users):
    root, a, b = users
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("SET LOCAL smarttrack.bootstrap='enabled'"))
        a.role = "ROOT"
        db.flush()


def test_room_snapshot_duplicate_and_locked(db, users):
    c, r, rv, code = competition(db, users)
    svc.join_room(db, code, users[1])
    db.flush()
    assert (
        db.scalar(
            select(func.count())
            .select_from(RoomMember)
            .where(RoomMember.room_id == r.id)
        )
        == 2
    )
    late = identity(db, "Late runner")
    with pytest.raises(HTTPException):
        svc.join_room(db, code, late)
    newrv = svc.create_route(
        db,
        RouteInput(name="Edited route", coordinates=COORDS, tolerance_m=30),
        users[0],
        rv.route_id,
    )
    assert newrv.id != c.route_version_id
    with pytest.raises(DBAPIError), db.begin_nested():
        rv.tolerance_m = 30
        db.flush()


def test_three_hour_batch_idempotence_and_laps(db, users):
    c, r, rv, code = competition(db, users)
    s = svc.start_session(db, c.id, users[1])
    db.flush()
    start = now() - timedelta(hours=3, seconds=10)
    segment = db.scalar(select(Segment).where(Segment.session_id == s.id))
    segment.started_at = start
    db.flush()
    track = points(start)
    for i in range(0, len(track), 200):
        batch = GPSBatch(points=track[i : i + 200])
        result = svc.ingest(db, s.id, batch, users[1])
        db.flush()
        assert result["rejected"] == 0
        retry = svc.ingest(db, s.id, batch, users[1])
        assert retry["accepted"] == 0
    assert s.last_seq == 3601
    assert 73 <= s.lap_count <= 75
    assert 30000 < s.distance_m < 33000
    assert (
        db.scalar(
            select(func.count())
            .select_from(GPSPoint)
            .where(GPSPoint.session_id == s.id)
        )
        == 3601
    )
    altered = track[-1].model_copy(update={"latitude": 12.5})
    with pytest.raises(HTTPException):
        svc.ingest(db, s.id, GPSBatch(points=[altered]), users[1])


def test_finish_recovery_finalization(db, users):
    c, r, rv, code = competition(db, users)
    s = svc.start_session(db, c.id, users[1])
    db.flush()
    svc.stop_session(db, s.id, users[1], 0, True)
    db.flush()
    # Registered runners are unresolved even when no one is actively tracking.
    assert c.status == "RUNNING"
    p2 = db.scalar(
        select(Participant).where(
            Participant.competition_id == c.id, Participant.user_id == users[2].id
        )
    )
    svc.withdraw(db, c.id, p2.id, users[0], "Could not attend")
    db.flush()
    assert c.status == "FINALIZING"
    request = svc.request_recovery(db, c.id, users[1], "Accidental finish")
    db.flush()
    assert c.status == "RUNNING"
    assert not svc.finalize(db, c.id)
    svc.review_recovery(db, request.id, users[0], True, "Approved to resume")
    db.flush()
    assert (
        db.scalar(
            select(func.count())
            .select_from(RunningSession)
            .where(RunningSession.participant_id == s.participant_id)
        )
        == 1
    )
    svc.resume_session(db, s.id, users[1])
    db.flush()
    svc.stop_session(db, s.id, users[1], 0, True)
    db.flush()
    c.finalize_after = now() - timedelta(seconds=1)
    db.flush()
    assert svc.finalize(db, c.id)
    db.flush()
    assert not svc.finalize(db, c.id)
    assert (
        db.scalar(
            select(func.count())
            .select_from(Result)
            .join(Participant, Participant.id == Result.participant_id)
            .where(Participant.competition_id == c.id)
        )
        == 2
    )
    with pytest.raises(HTTPException):
        svc.request_recovery(db, c.id, users[1], "Too late now")
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("DELETE FROM lap_records WHERE session_id=:sid"), {"sid": s.id})
        db.execute(text("DELETE FROM running_sessions WHERE id=:sid"), {"sid": s.id})


def test_recovery_rejection_preserves_status(db, users):
    c, r, rv, code = competition(db, users)
    p = db.scalar(
        select(Participant).where(
            Participant.competition_id == c.id, Participant.user_id == users[1].id
        )
    )
    svc.withdraw(db, c.id, p.id, users[0], "Temporary issue")
    db.flush()
    req = svc.request_recovery(db, c.id, users[1], "Please resume")
    db.flush()
    svc.review_recovery(db, req.id, users[0], False, "Not permitted")
    db.flush()
    assert p.status == "WITHDRAWN" and req.status == "REJECTED"


def test_gps_gaps_auth_and_ack(db, users):
    c, r, rv, code = competition(db, users)
    s = svc.start_session(db, c.id, users[1])
    db.flush()
    start = now() - timedelta(seconds=20)
    db.scalar(select(Segment).where(Segment.session_id == s.id)).started_at = start
    db.flush()
    data = points(start, seconds=6)
    with pytest.raises(HTTPException):
        svc.ingest(db, s.id, GPSBatch(points=[data[1]]), users[1])
    with pytest.raises(HTTPException):
        svc.ingest(db, s.id, GPSBatch(points=data), users[2])
    svc.ingest(db, s.id, GPSBatch(points=data), users[1])
    db.flush()
    with pytest.raises(HTTPException):
        svc.stop_session(db, s.id, users[1], 0, True)
    assert s.last_seq == 3


def test_rls_denies_direct_student_mutation(db, users):
    db.execute(text("SET LOCAL ROLE authenticated"))
    db.execute(
        text("SELECT set_config('request.jwt.claim.sub',:id,true)"),
        {"id": str(users[1].id)},
    )
    assert len(db.execute(text("SELECT id FROM profiles")).all()) == 1
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("UPDATE profiles SET role='ROOT'"))
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("SELECT * FROM gps_track_points"))
    db.execute(text("RESET ROLE"))


def test_database_blocks_gps_evidence_delete(db, users):
    c, r, rv, code = competition(db, users)
    s = svc.start_session(db, c.id, users[1])
    db.flush()
    start = now() - timedelta(minutes=4)
    db.scalar(select(Segment).where(Segment.session_id == s.id)).started_at = start
    db.flush()
    svc.ingest(db, s.id, GPSBatch(points=points(start, seconds=150)), users[1])
    db.flush()
    assert s.lap_count >= 1
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("SET LOCAL smarttrack.retention='enabled'"))
        db.execute(
            text("DELETE FROM gps_track_points WHERE session_id=:sid AND seq=10"),
            {"sid": s.id},
        )
