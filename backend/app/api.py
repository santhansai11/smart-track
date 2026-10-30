import hashlib
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session
from .db import database
from .auth import current_user, root_user
from .models import *
from .schemas import *
from . import services as svc
from .config import settings

api = APIRouter(prefix="/api/v1")
DB = Annotated[Session, Depends(database, scope="function")]
User = Annotated[Profile, Depends(current_user)]
Root = Annotated[Profile, Depends(root_user)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


def public(obj, exclude=()):
    return {
        c.name: getattr(obj, c.name)
        for c in obj.__table__.columns
        if c.name not in exclude
    }


@api.get("/users/me")
def me(user: User):
    return public(user)


@api.patch("/users/me")
def edit_me(data: ProfileEdit, db: DB, user: User):
    user.full_name = data.full_name
    return public(user)


@api.get("/config")
def config(user: User):
    cfg = settings()
    return {
        "gps_sample_seconds": max(2, min(5, cfg.gps_sample_seconds)),
        "gps_batch_size": max(1, min(300, cfg.gps_batch_size)),
        "recovery_window_seconds": cfg.recovery_window_seconds,
    }


@api.get("/routes")
def routes(db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    latest = (
        select(RouteVersion.route_id, func.max(RouteVersion.version).label("v"))
        .group_by(RouteVersion.route_id)
        .subquery()
    )
    q = (
        select(Route, RouteVersion)
        .join(latest, latest.c.route_id == Route.id)
        .join(
            RouteVersion,
            (RouteVersion.route_id == Route.id) & (RouteVersion.version == latest.c.v),
        )
    )
    if user.role != "ROOT":
        q = q.where(Route.active == True)
    return [
        {**public(r), "version": public(v)}
        for r, v in db.execute(
            q.order_by(Route.created_at.desc(), Route.id).limit(limit).offset(offset)
        )
    ]


@api.post("/routes", status_code=201)
def new_route(data: RouteInput, db: DB, user: Root):
    return public(svc.create_route(db, data, user))


@api.patch("/routes/{rid}")
def change_route(rid: UUID, data: RouteInput, db: DB, user: Root):
    return public(svc.create_route(db, data, user, rid))


@api.post("/routes/{rid}/active")
def route_active(rid: UUID, data: ToggleInput, db: DB, user: Root):
    r = svc.get(db, Route, rid, True)
    r.active = data.active
    svc.audit(db, user, "route.active_changed", rid, active=data.active)
    return public(r)


@api.get("/rooms")
def rooms(db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    counts = (
        select(RoomMember.room_id, func.count().label("n"))
        .group_by(RoomMember.room_id)
        .subquery()
    )
    mine = select(RoomMember.room_id).where(RoomMember.user_id == user.id)
    q = (
        select(Room, Route.name, func.coalesce(counts.c.n, 0))
        .join(RouteVersion, Room.route_version_id == RouteVersion.id)
        .join(Route, Route.id == RouteVersion.route_id)
        .outerjoin(counts, counts.c.room_id == Room.id)
        .where(Room.archived == False)
    )
    if user.role != "ROOT":
        q = q.where(or_(Room.visibility == "PUBLIC", Room.id.in_(mine)))
    memberships = set(db.scalars(mine))
    return [
        {
            **public(r, ("invitation_hash",)),
            "route_name": name,
            "member_count": n,
            "joined": r.id in memberships,
        }
        for r, name, n in db.execute(
            q.order_by(Room.created_at.desc(), Room.id).limit(limit).offset(offset)
        )
    ]


@api.post("/rooms", status_code=201)
def new_room(data: RoomInput, db: DB, user: Root):
    r, code = svc.create_room(db, data, user)
    return {**public(r, ("invitation_hash",)), "invitation_code": code}


@api.patch("/rooms/{rid}")
def edit_room(rid: UUID, data: RoomInput, db: DB, user: Root):
    r = svc.get(db, Room, rid, True)
    if db.scalar(
        select(Competition.id).where(
            Competition.room_id == rid, Competition.status != "COMPLETED"
        )
    ):
        svc.fail("Room settings are frozen until the current competition completes")
    count = db.scalar(
        select(func.count()).select_from(RoomMember).where(RoomMember.room_id == rid)
    )
    if data.capacity < count:
        svc.fail("Capacity cannot be smaller than the existing membership")
    rv = svc.get(db, RouteVersion, data.route_version_id)
    if not svc.get(db, Route, rv.route_id).active:
        svc.fail("Route is disabled")
    for key, value in data.model_dump().items():
        setattr(r, key, value)
    svc.audit(db, user, "room.updated", rid)
    return public(r, ("invitation_hash",))


@api.post("/rooms/join")
def join(data: Join, db: DB, user: User):
    return public(svc.join_room(db, data.code, user), ("invitation_hash",))


@api.get("/rooms/{rid}")
def room_detail(rid: UUID, db: DB, user: User):
    r = svc.room_access(db, rid, user)
    comps = db.scalars(
        select(Competition)
        .where(Competition.room_id == rid)
        .order_by(Competition.created_at.desc())
        .limit(20)
    ).all()
    rv = svc.get(db, RouteVersion, r.route_version_id)
    return {
        **public(r, ("invitation_hash",)),
        "route": public(rv),
        "route_name": svc.get(db, Route, rv.route_id).name,
        "competitions": [public(c) for c in comps],
    }


@api.get("/rooms/{rid}/members")
def members(rid: UUID, db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    svc.room_access(db, rid, user)
    return [
        dict(r._mapping)
        for r in db.execute(
            select(Profile.id, Profile.full_name, RoomMember.joined_at)
            .join(RoomMember, RoomMember.user_id == Profile.id)
            .where(RoomMember.room_id == rid)
            .order_by(RoomMember.joined_at, Profile.id)
            .limit(limit)
            .offset(offset)
        )
    ]


@api.post("/rooms/{rid}/lock")
def lock(rid: UUID, db: DB, user: Root):
    return public(svc.lock_room(db, rid, user))


@api.post("/rooms/{rid}/reopen")
def reopen(rid: UUID, db: DB, user: Root):
    r = svc.get(db, Room, rid, True)
    if db.scalar(
        select(Competition.id).where(
            Competition.room_id == rid, Competition.status != "COMPLETED"
        )
    ):
        svc.fail("Complete the current competition first")
    r.locked = False
    svc.audit(db, user, "room.reopened", rid)
    return public(r, ("invitation_hash",))


@api.post("/competitions/{cid}/start")
def start_comp(cid: UUID, db: DB, user: Root):
    return public(svc.start_competition(db, cid, user))


@api.get("/competitions")
def competitions(db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    q = select(Competition, Room.name).join(Room, Room.id == Competition.room_id)
    if user.role != "ROOT":
        q = q.where(
            Competition.room_id.in_(
                select(RoomMember.room_id).where(RoomMember.user_id == user.id)
            )
        )
    return [
        {**public(c), "room_name": name}
        for c, name in db.execute(
            q.order_by(Competition.created_at.desc(), Competition.id)
            .limit(limit)
            .offset(offset)
        )
    ]


@api.get("/competitions/{cid}")
def competition(cid: UUID, db: DB, user: User):
    c = svc.comp_access(db, cid, user)
    p = db.scalar(
        select(Participant).where(
            Participant.competition_id == cid, Participant.user_id == user.id
        )
    )
    s = (
        db.scalar(select(RunningSession).where(RunningSession.participant_id == p.id))
        if p
        else None
    )
    return {
        **public(c),
        "room_name": svc.get(db, Room, c.room_id).name,
        "route": public(svc.get(db, RouteVersion, c.route_version_id)),
        "participant": public(p) if p else None,
        "session": session_data(db, s) if s else None,
    }


def session_data(db, s):
    opened = db.scalar(
        select(Segment.id).where(Segment.session_id == s.id, Segment.ended_at == None)
    )
    return {
        **public(s, ("progress",)),
        "active_ms": svc.active_ms(db, s.id),
        "tracking": opened is not None,
    }


@api.get("/competitions/{cid}/participants")
def participants(cid: UUID, db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    svc.comp_access(db, cid, user)
    rows = db.execute(
        select(Participant, Profile.full_name, RunningSession, Result.rank)
        .join(Profile, Profile.id == Participant.user_id)
        .outerjoin(RunningSession, RunningSession.participant_id == Participant.id)
        .outerjoin(Result, Result.participant_id == Participant.id)
        .where(Participant.competition_id == cid)
        .order_by(Result.rank.asc().nulls_last(), Participant.id)
        .limit(limit)
        .offset(offset)
    ).all()
    sids = [s.id for _, _, s, _ in rows if s]
    durations = {}
    for seg in db.scalars(select(Segment).where(Segment.session_id.in_(sids))):
        durations[seg.session_id] = durations.get(seg.session_id, 0) + max(
            0,
            int(
                (
                    svc.as_utc(seg.ended_at or now()) - svc.as_utc(seg.started_at)
                ).total_seconds()
                * 1000
            ),
        )
    recoveries = dict(
        db.execute(
            select(Recovery.participant_id, func.count())
            .where(
                Recovery.participant_id.in_([p.id for p, _, _, _ in rows]),
                Recovery.status == "APPROVED",
            )
            .group_by(Recovery.participant_id)
        ).all()
    )
    return [
        {
            **public(p),
            "full_name": name,
            "rank": rank,
            "laps": s.lap_count if s else 0,
            "distance_m": s.distance_m if s else 0,
            "partial_m": s.partial_m if s else 0,
            "active_ms": durations.get(s.id, 0) if s else 0,
            "recoveries": recoveries.get(p.id, 0),
            "session_id": (
                s.id if s and (user.role == "ROOT" or p.user_id == user.id) else None
            ),
        }
        for p, name, s, rank in rows
    ]


@api.get("/competitions/{cid}/results")
def results(cid: UUID, db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    c = svc.comp_access(db, cid, user)
    if c.status != "COMPLETED":
        svc.fail("Results have not been published")
    return participants(cid, db, user, limit, offset)


@api.post("/competitions/{cid}/sessions/start")
def start_run(cid: UUID, data: StartInput, db: DB, user: User):
    s = svc.start_session(db, cid, user, data.location_consent)
    db.flush()
    return session_data(db, s)


@api.post("/sessions/{sid}/gps/batch")
def gps_batch(sid: UUID, data: GPSBatch, db: DB, user: User):
    return svc.ingest(db, sid, data, user)


@api.post("/sessions/{sid}/pause")
def pause(sid: UUID, data: StopInput, db: DB, user: User):
    s = svc.stop_session(db, sid, user, data.last_seq)
    db.flush()
    return session_data(db, s)


@api.post("/sessions/{sid}/finish")
def finish(sid: UUID, data: StopInput, db: DB, user: User):
    s = svc.stop_session(db, sid, user, data.last_seq, True)
    db.flush()
    return session_data(db, s)


@api.post("/sessions/{sid}/resume")
def resume(sid: UUID, db: DB, user: User):
    s = svc.resume_session(db, sid, user)
    db.flush()
    return session_data(db, s)


@api.get("/sessions")
def sessions(db: DB, user: User, limit: Limit = 30, offset: Offset = 0):
    q = (
        select(
            RunningSession, Participant.status, Participant.competition_id, Room.name
        )
        .join(Participant, Participant.id == RunningSession.participant_id)
        .join(Competition, Competition.id == Participant.competition_id)
        .join(Room, Room.id == Competition.room_id)
    )
    if user.role != "ROOT":
        q = q.where(Participant.user_id == user.id)
    return [
        {
            **public(s, ("progress",)),
            "status": st,
            "competition_id": cid,
            "room_name": name,
        }
        for s, st, cid, name in db.execute(
            q.order_by(RunningSession.created_at.desc(), RunningSession.id)
            .limit(limit)
            .offset(offset)
        )
    ]


@api.get("/sessions/{sid}/laps")
def laps(sid: UUID, db: DB, user: User, after: int = 0, limit: Limit = 50):
    svc.session_context(db, sid, user, False)
    return [
        public(l)
        for l in db.scalars(
            select(Lap)
            .where(Lap.session_id == sid, Lap.number > after)
            .order_by(Lap.number)
            .limit(limit)
        )
    ]


@api.get("/sessions/{sid}")
def session_detail(sid: UUID, db: DB, user: User):
    s, p, c = svc.session_context(db, sid, user, False)
    return {
        **session_data(db, s),
        "full_name": svc.get(db, Profile, p.user_id).full_name,
        "status": p.status,
        "competition_id": c.id,
        "route": public(svc.get(db, RouteVersion, c.route_version_id)),
        "can_view_gps": p.user_id == user.id or s.location_consent,
    }


@api.get("/analytics")
def analytics(db: DB, user: User, period: str = "week"):
    from datetime import timedelta

    cutoff = now() - timedelta(days=30 if period == "month" else 7)
    q = (
        select(
            func.date_trunc("day", RunningSession.created_at).label("day"),
            func.count().label("runs"),
            func.sum(RunningSession.distance_m).label("distance_m"),
            func.sum(RunningSession.lap_count).label("laps"),
        )
        .join(Participant, Participant.id == RunningSession.participant_id)
        .where(RunningSession.created_at >= cutoff)
    )
    if user.role != "ROOT":
        q = q.where(Participant.user_id == user.id)
    q = q.group_by(func.date_trunc("day", RunningSession.created_at)).order_by(
        func.date_trunc("day", RunningSession.created_at)
    )
    fastest = (
        select(func.min(Lap.active_ms))
        .join(RunningSession, RunningSession.id == Lap.session_id)
        .join(Participant, Participant.id == RunningSession.participant_id)
        .where(Lap.finished_at >= cutoff)
    )
    if user.role != "ROOT":
        fastest = fastest.where(Participant.user_id == user.id)
    return {
        "days": [dict(row._mapping) for row in db.execute(q)],
        "fastest_lap_ms": db.scalar(fastest),
    }


@api.get("/sessions/{sid}/gps")
def gps_history(
    sid: UUID,
    db: DB,
    user: User,
    after: int = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
):
    s, p, c = svc.session_context(db, sid, user, False)
    if user.id != p.user_id and not s.location_consent:
        svc.fail("Runner has not consented to administrator trail access", 403)
    return [
        public(pt, ("payload_hash",))
        for pt in db.scalars(
            select(GPSPoint)
            .where(GPSPoint.session_id == sid, GPSPoint.seq > after)
            .order_by(GPSPoint.seq)
            .limit(limit)
        )
    ]


@api.post("/competitions/{cid}/participants/{pid}/withdraw")
def withdraw(cid: UUID, pid: UUID, data: Reason, db: DB, user: Root):
    svc.withdraw(db, cid, pid, user, data.reason)
    return {"ok": True}


@api.post("/competitions/{cid}/participants/{pid}/disqualify")
def dq(cid: UUID, pid: UUID, data: Reason, db: DB, user: Root):
    svc.withdraw(db, cid, pid, user, data.reason, True)
    return {"ok": True}


@api.post("/competitions/{cid}/recovery-requests")
def recovery(cid: UUID, data: Reason, db: DB, user: User):
    return public(svc.request_recovery(db, cid, user, data.reason))


@api.get("/recovery-requests")
def recovery_list(db: DB, user: User, limit: Limit = 50, offset: Offset = 0):
    q = (
        select(Recovery, Profile.full_name, Participant.competition_id, Room.name)
        .join(Participant, Participant.id == Recovery.participant_id)
        .join(Profile, Profile.id == Participant.user_id)
        .join(Competition, Competition.id == Participant.competition_id)
        .join(Room, Room.id == Competition.room_id)
    )
    if user.role != "ROOT":
        q = q.where(Participant.user_id == user.id)
    return [
        {**public(r), "full_name": name, "competition_id": cid, "room_name": room}
        for r, name, cid, room in db.execute(
            q.order_by(Recovery.created_at.desc(), Recovery.id)
            .limit(limit)
            .offset(offset)
        )
    ]


@api.post("/admin/recovery-requests/{rid}/{decision}")
def review(rid: UUID, decision: str, data: Reason, db: DB, user: Root):
    if decision not in {"approve", "reject"}:
        svc.fail("Unknown decision", 404)
    return public(
        svc.review_recovery(db, rid, user, decision == "approve", data.reason)
    )


@api.get("/admin/users")
def users(db: DB, user: Root, search: str = "", limit: Limit = 50, offset: Offset = 0):
    return [
        public(p)
        for p in db.scalars(
            select(Profile)
            .where(Profile.full_name.ilike("%" + search[:120] + "%"))
            .order_by(Profile.created_at.desc(), Profile.id)
            .limit(limit)
            .offset(offset)
        )
    ]


@api.patch("/admin/users/{uid}")
def block(uid: UUID, data: BlockInput, db: DB, user: Root):
    p = svc.get(db, Profile, uid, True)
    if p.role == "ROOT":
        svc.fail("Root account cannot be blocked")
    p.active = data.active
    svc.audit(db, user, "user.active_changed", uid, active=data.active)
    return public(p)


@api.get("/admin/audit-logs")
def logs(db: DB, user: Root, limit: Limit = 50, offset: Offset = 0):
    return [
        public(a)
        for a in db.scalars(
            select(AuditLog)
            .order_by(AuditLog.created_at.desc(), AuditLog.id)
            .limit(limit)
            .offset(offset)
        )
    ]


@api.get("/dashboard")
def dashboard(db: DB, user: User):
    scope = select(Participant.id).where(Participant.user_id == user.id)
    q = select(
        func.count(RunningSession.id),
        func.coalesce(func.sum(RunningSession.distance_m), 0),
        func.coalesce(func.sum(RunningSession.lap_count), 0),
    )
    if user.role != "ROOT":
        q = q.where(RunningSession.participant_id.in_(scope))
    runs, meters, laps = db.execute(q).one()
    result = {
        "runs": runs,
        "distance_m": meters,
        "laps": laps,
        "rooms": db.scalar(
            select(func.count())
            .select_from(RoomMember)
            .where(RoomMember.user_id == user.id)
        ),
    }
    if user.role == "ROOT":
        result.update(
            users=db.scalar(select(func.count()).select_from(Profile)),
            active_users=db.scalar(
                select(func.count()).select_from(Profile).where(Profile.active == True)
            ),
            routes=db.scalar(select(func.count()).select_from(Route)),
            rooms=db.scalar(select(func.count()).select_from(Room)),
            live=db.scalar(
                select(func.count())
                .select_from(Competition)
                .where(Competition.status == "RUNNING")
            ),
            completed=db.scalar(
                select(func.count())
                .select_from(Competition)
                .where(Competition.status == "COMPLETED")
            ),
        )
    return result
