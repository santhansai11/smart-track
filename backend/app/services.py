import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import select, func, insert
from sqlalchemy.orm import Session
from .models import *
from .gps import Matcher, route_length
from .config import settings

TERMINAL = {"FINISHED", "WITHDRAWN", "DISQUALIFIED"}


def fail(message, code=409):
    raise HTTPException(code, message)


def get(db, model, id, lock=False):
    stmt = select(model).where(model.id == id)
    row = db.scalar(
        stmt.with_for_update().execution_options(populate_existing=True)
        if lock
        else stmt
    )
    if not row:
        fail("Record not found", 404)
    return row


def audit(db, user, action, entity=None, **details):
    db.add(
        AuditLog(
            actor_id=user.id if user else None,
            action=action,
            entity_id=entity,
            details=details,
        )
    )


def status(db, p, value, actor, reason=""):
    p.status = value
    db.add(
        StatusHistory(
            participant_id=p.id, status=value, actor_id=actor.id, reason=reason
        )
    )


def room_access(db, room_id, user):
    room = get(db, Room, room_id)
    if user.role != "ROOT" and not db.get(RoomMember, (room_id, user.id)):
        fail("Room membership required", 403)
    return room


def comp_access(db, cid, user, lock=False):
    c = get(db, Competition, cid, lock)
    room_access(db, c.room_id, user)
    return c


def active_ms(db, session_id, until=None):
    until = until or now()
    segments = db.scalars(select(Segment).where(Segment.session_id == session_id)).all()
    return sum(
        max(
            0,
            int(
                (as_utc(s.ended_at or until) - as_utc(s.started_at)).total_seconds()
                * 1000
            ),
        )
        for s in segments
    )


def as_utc(t):
    return (
        t.replace(tzinfo=timezone.utc)
        if t.tzinfo is None
        else t.astimezone(timezone.utc)
    )


def create_route(db, data, user, route_id=None):
    points = [list(p) for p in data.coordinates]
    if points[0] == points[-1]:
        points.pop()
    length = route_length(points)
    if not 100 <= length <= 100000:
        fail("Closed route must be between 100 m and 100 km", 422)
    from .gps import distance

    if any(distance(a, b) < 2 for a, b in zip(points, points[1:] + points[:1])):
        fail("Adjacent route vertices must be at least 2 m apart", 422)
    route = get(db, Route, route_id, True) if route_id else Route(created_by=user.id)
    route.name, route.description = data.name, data.description
    db.add(route)
    db.flush()
    version = (
        db.scalar(
            select(func.max(RouteVersion.version)).where(
                RouteVersion.route_id == route.id
            )
        )
        or 0
    ) + 1
    rv = RouteVersion(
        route_id=route.id,
        version=version,
        coordinates=points,
        length_m=length,
        tolerance_m=data.tolerance_m,
    )
    db.add(rv)
    db.flush()
    audit(db, user, "route.version_created", route.id, version=version)
    return rv


def create_room(db, data, user):
    rv = get(db, RouteVersion, data.route_version_id)
    if not get(db, Route, rv.route_id).active:
        fail("Route is disabled")
    code = secrets.token_hex(8).upper()
    room = Room(
        **data.model_dump(), invitation_hash=hashlib.sha256(code.encode()).hexdigest()
    )
    db.add(room)
    db.flush()
    audit(db, user, "room.created", room.id)
    return room, code


def join_room(db, code, user):
    if user.role != "STUDENT":
        fail("Only students may join competitions", 403)
    digest = hashlib.sha256(code.strip().upper().encode()).hexdigest()
    room = db.scalar(
        select(Room).where(Room.invitation_hash == digest).with_for_update()
    )
    if not room:
        fail("Invitation code not found", 404)
    if db.get(RoomMember, (room.id, user.id)):
        return room
    if room.locked or room.archived:
        fail("Registration is closed")
    count = db.scalar(
        select(func.count())
        .select_from(RoomMember)
        .where(RoomMember.room_id == room.id)
    )
    if count >= room.capacity:
        fail("Room is full")
    db.add(RoomMember(room_id=room.id, user_id=user.id))
    return room


def lock_room(db, room_id, user):
    room = get(db, Room, room_id, True)
    current = db.scalar(
        select(Competition).where(
            Competition.room_id == room_id, Competition.status != "COMPLETED"
        )
    )
    if current:
        return current
    members = db.scalars(
        select(RoomMember.user_id)
        .join(Profile, Profile.id == RoomMember.user_id)
        .where(RoomMember.room_id == room_id, Profile.active == True)
    ).all()
    if not members:
        fail("Add at least one active participant before locking")
    if room.archived:
        fail("Room is archived")
    c = Competition(room_id=room.id, route_version_id=room.route_version_id)
    db.add(c)
    db.flush()
    db.execute(
        insert(Participant),
        [
            {
                "id": __import__("uuid").uuid4(),
                "competition_id": c.id,
                "user_id": uid,
                "status": "REGISTERED",
            }
            for uid in members
        ],
    )
    room.locked = True
    audit(
        db,
        user,
        "room.locked",
        room.id,
        competition_id=str(c.id),
        participants=len(members),
    )
    return c


def start_competition(db, cid, user):
    c = get(db, Competition, cid, True)
    if c.status == "RUNNING":
        return c
    if c.status != "LOCKED":
        fail("Competition must be locked before starting")
    c.started_at, c.status = now(), "RUNNING"
    audit(db, user, "competition.started", c.id)
    return c


def session_context(db, sid, user, competition_lock=True):
    s = get(db, RunningSession, sid)
    p = get(db, Participant, s.participant_id)
    if p.user_id != user.id and user.role != "ROOT":
        fail("Session is private", 403)
    c = get(db, Competition, p.competition_id, competition_lock)
    s = get(db, RunningSession, sid, True)
    # A withdrawal or finish may have committed while this request waited.
    db.refresh(p)
    db.refresh(c)
    return s, p, c


def start_session(db, cid, user, consent=False):
    c = comp_access(db, cid, user, True)
    if c.status != "RUNNING":
        fail("Competition is not running")
    p = db.scalar(
        select(Participant).where(
            Participant.competition_id == cid, Participant.user_id == user.id
        )
    )
    if not p:
        fail("You are not in this competition snapshot", 403)
    s = db.scalar(select(RunningSession).where(RunningSession.participant_id == p.id))
    if p.status == "RUNNING" and s:
        return s
    if p.status != "REGISTERED":
        fail("Recovery approval is required to continue")
    s = RunningSession(participant_id=p.id, location_consent=consent)
    db.add(s)
    db.flush()
    db.add(Segment(session_id=s.id))
    status(db, p, "RUNNING", user)
    return s


def ingest(db, sid, batch, user):
    # GPS locks only the session; batches from different runners proceed independently.
    s, p, c = session_context(db, sid, user, False)
    if p.user_id != user.id:
        fail("Only the runner may upload points", 403)
    ordered = batch.points
    if any(b.seq != a.seq + 1 for a, b in zip(ordered, ordered[1:])):
        fail("Batch sequences must be contiguous and ascending", 422)
    digests = {
        v.seq: hashlib.sha256(
            json.dumps(v.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        for v in ordered
    }
    existing = dict(
        db.execute(
            select(GPSPoint.seq, GPSPoint.payload_hash).where(
                GPSPoint.session_id == sid,
                GPSPoint.seq >= ordered[0].seq,
                GPSPoint.seq <= min(s.last_seq, ordered[-1].seq),
            )
        ).all()
    )
    for pt in ordered:
        if pt.seq <= s.last_seq and existing.get(pt.seq) != digests[pt.seq]:
            fail("Previously acknowledged data differs or is past retention")
    fresh = [pt for pt in ordered if pt.seq > s.last_seq]
    if not fresh:
        return {"ack_seq": s.last_seq, "accepted": 0, "rejected": 0}
    if c.status != "RUNNING" or p.status != "RUNNING":
        fail("Session is not accepting new GPS points")
    segment = db.scalar(
        select(Segment).where(Segment.session_id == sid, Segment.ended_at == None)
    )
    if not segment:
        fail("Resume tracking before uploading points")
    if fresh[0].seq != s.last_seq + 1:
        fail(f"Expected sequence {s.last_seq+1}")
    rv = get(db, RouteVersion, c.route_version_id)
    matcher = Matcher(rv.coordinates, rv.tolerance_m)
    # Pause/recovery intervals are fetched once per batch, never once per lap.
    segments = db.scalars(select(Segment).where(Segment.session_id == sid)).all()
    state = dict(s.progress)
    rows, accepted = [], 0
    for pt in fresh:
        if as_utc(pt.captured_at) < as_utc(
            segment.started_at
        ) or pt.captured_at > now() + timedelta(seconds=10):
            fail("GPS timestamp is outside the active segment", 422)
        state, validation, advance, lap = matcher.step(state, pt)
        accepted += validation == "VALID"
        s.distance_m += advance
        if lap:
            s.lap_count += 1
            start_at = datetime.fromtimestamp(lap["start"], timezone.utc)
            end_at = datetime.fromtimestamp(lap["end"], timezone.utc)
            lap_ms = sum(
                max(
                    0,
                    int(
                        (
                            min(svc_end, end_at) - max(svc_start, start_at)
                        ).total_seconds()
                        * 1000
                    ),
                )
                for seg in segments
                for svc_start, svc_end in [
                    (as_utc(seg.started_at), as_utc(seg.ended_at or end_at))
                ]
            )
            db.add(
                Lap(
                    session_id=sid,
                    number=s.lap_count,
                    from_seq=lap["from_seq"],
                    to_seq=lap["to_seq"],
                    started_at=start_at,
                    finished_at=end_at,
                    active_ms=lap_ms,
                )
            )
        rows.append(
            {
                "session_id": sid,
                **pt.model_dump(),
                "validation": validation,
                "payload_hash": digests[pt.seq],
            }
        )
    db.execute(insert(GPSPoint), rows)
    s.progress, s.last_seq = state, fresh[-1].seq
    s.partial_m = min(rv.length_m, state.get("lap", {}).get("coverage", 0))
    return {
        "ack_seq": s.last_seq,
        "accepted": accepted,
        "rejected": len(fresh) - accepted,
    }


def close_segment(db, sid):
    seg = db.scalar(
        select(Segment).where(Segment.session_id == sid, Segment.ended_at == None)
    )
    if seg:
        seg.ended_at = now()


def stop_session(db, sid, user, last_seq, finish=False):
    s, p, c = session_context(db, sid, user)
    if p.user_id != user.id:
        fail("Only the runner may finish their session", 403)
    if s.last_seq != last_seq:
        fail("Synchronize all GPS points before stopping")
    if finish and p.status == "FINISHED":
        return s
    if p.status != "RUNNING" or c.status != "RUNNING":
        fail("Session is not running")
    close_segment(db, sid)
    # Keep partial progress for results; resume reanchors at the same route position.
    if finish:
        status(db, p, "FINISHED", user)
        db.flush()
        consider_finalization(db, c)
    return s


def resume_session(db, sid, user):
    s, p, c = session_context(db, sid, user)
    if p.user_id != user.id or p.status != "RUNNING" or c.status != "RUNNING":
        fail("Cannot resume this session", 403)
    if not db.scalar(
        select(Segment.id).where(Segment.session_id == sid, Segment.ended_at == None)
    ):
        db.add(Segment(session_id=sid))
        # Resume beside the last accepted point; never count the untracked gap.
        s.progress = {**s.progress, "resume": True}
    return s


def withdraw(db, cid, pid, user, reason, disqualify=False):
    c = get(db, Competition, cid, True)
    p = get(db, Participant, pid)
    if p.competition_id != cid:
        fail("Participant does not belong to this competition", 404)
    if c.status not in {"RUNNING", "FINALIZING"}:
        fail("Competition is not editable")
    pending = db.scalar(
        select(Recovery).where(
            Recovery.participant_id == pid, Recovery.status == "PENDING"
        )
    )
    if pending:
        fail("Resolve the pending recovery request first")
    s = db.scalar(
        select(RunningSession)
        .where(RunningSession.participant_id == pid)
        .with_for_update()
    )
    if s:
        close_segment(db, s.id)
    value = "DISQUALIFIED" if disqualify else "WITHDRAWN"
    if p.status != value:
        status(db, p, value, user, reason)
    audit(db, user, "participant." + value.lower(), p.id, reason=reason)
    db.flush()
    consider_finalization(db, c)


def request_recovery(db, cid, user, reason):
    c = comp_access(db, cid, user, True)
    p = db.scalar(
        select(Participant).where(
            Participant.competition_id == cid, Participant.user_id == user.id
        )
    )
    if not p:
        fail("Participant not found", 404)
    existing = db.scalar(
        select(Recovery).where(
            Recovery.participant_id == p.id, Recovery.status == "PENDING"
        )
    )
    if existing:
        return existing
    if c.status not in {"RUNNING", "FINALIZING"}:
        fail("Results are already published or competition has not started")
    if c.finalize_after and now() >= as_utc(c.finalize_after):
        fail("Recovery window has closed")
    if p.status not in {"FINISHED", "WITHDRAWN"}:
        fail("Only finished or withdrawn participants may request recovery")
    request = Recovery(participant_id=p.id, previous_status=p.status, reason=reason)
    db.add(request)
    status(db, p, "RECOVERY_PENDING", user, reason)
    c.status, c.finalize_after = "RUNNING", None
    db.flush()
    return request


def review_recovery(db, rid, user, approve, reason):
    req = get(db, Recovery, rid)
    p = get(db, Participant, req.participant_id)
    c = get(db, Competition, p.competition_id, True)
    db.refresh(req)
    db.refresh(p)
    if req.status != "PENDING":
        return req
    if c.status not in {"RUNNING", "FINALIZING"}:
        fail("Results have already been published")
    req.status = "APPROVED" if approve else "REJECTED"
    req.reviewed_by, req.reviewed_at, req.decision_reason = user.id, now(), reason
    s = db.scalar(
        select(RunningSession)
        .where(RunningSession.participant_id == p.id)
        .with_for_update()
    )
    status(
        db,
        p,
        ("RUNNING" if s else "REGISTERED") if approve else req.previous_status,
        user,
        reason,
    )
    if approve:
        c.status, c.finalize_after = "RUNNING", None
        # Student explicitly resumes; never count offline recovery gap as active time.
    audit(db, user, "recovery." + req.status.lower(), req.id, reason=reason)
    db.flush()
    consider_finalization(db, c)
    return req


def consider_finalization(db, c):
    if c.status not in {"RUNNING", "FINALIZING"} or c.started_at is None:
        return
    unresolved = db.scalar(
        select(func.count())
        .select_from(Participant)
        .where(Participant.competition_id == c.id, Participant.status.not_in(TERMINAL))
    )
    if unresolved:
        c.status, c.finalize_after = "RUNNING", None
    elif c.status == "RUNNING":
        c.status, c.finalize_after = "FINALIZING", now() + timedelta(
            seconds=settings().recovery_window_seconds
        )


def finalize(db, cid):
    c = get(db, Competition, cid, True)
    if (
        c.status != "FINALIZING"
        or not c.finalize_after
        or now() < as_utc(c.finalize_after)
    ):
        return False
    consider_finalization(db, c)
    if c.status != "FINALIZING":
        return False
    people = db.scalars(
        select(Participant).where(Participant.competition_id == cid)
    ).all()
    sessions = {
        s.participant_id: s
        for s in db.scalars(
            select(RunningSession)
            .join(Participant, Participant.id == RunningSession.participant_id)
            .where(Participant.competition_id == cid)
        ).all()
    }
    # One grouped query, never a per-participant history query.
    segments = db.execute(
        select(Segment.session_id, Segment.started_at, Segment.ended_at)
        .join(RunningSession, RunningSession.id == Segment.session_id)
        .join(Participant, Participant.id == RunningSession.participant_id)
        .where(Participant.competition_id == cid)
    ).all()
    duration = {}
    for sid, start, end in segments:
        if end is None:
            fail("Active session prevents finalization")
        duration[sid] = duration.get(sid, 0) + int(
            (as_utc(end) - as_utc(start)).total_seconds() * 1000
        )
    laps = dict(
        db.execute(
            select(Lap.session_id, func.count(Lap.id))
            .join(RunningSession, RunningSession.id == Lap.session_id)
            .join(Participant, Participant.id == RunningSession.participant_id)
            .where(Participant.competition_id == cid)
            .group_by(Lap.session_id)
        ).all()
    )
    ranked = []
    for p in people:
        s = sessions.get(p.id)
        if p.status == "FINISHED" and s:
            ranked.append(
                (
                    (-laps.get(s.id, 0), -round(s.partial_m, 1), duration.get(s.id, 0)),
                    str(p.id),
                    p,
                )
            )
        else:
            db.add(Result(participant_id=p.id, rank=None))
    ranked.sort(key=lambda item: (item[0], item[1]))
    previous, rank = None, 0
    for i, (key, _, p) in enumerate(ranked, 1):
        if key != previous:
            rank = i
        db.add(Result(participant_id=p.id, rank=rank))
        previous = key
    c.status, c.published_at = "COMPLETED", now()
    audit(db, None, "competition.published", c.id, participants=len(people))
    return True
