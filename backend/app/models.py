"""Domain schema. No email/password copies: Supabase auth.users owns identity."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    BigInteger,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class Created:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Profile(Identity, Created, Base):
    __tablename__ = "profiles"
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(
        String(10), default="STUDENT", server_default="STUDENT"
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (
        CheckConstraint("role IN ('STUDENT','ROOT')"),
        Index(
            "one_root",
            "role",
            unique=True,
            postgresql_where="role = 'ROOT'",
            sqlite_where=__import__("sqlalchemy").text("role = 'ROOT'"),
        ),
    )


class Route(Identity, Created, Base):
    __tablename__ = "routes"
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))


class RouteVersion(Identity, Created, Base):
    __tablename__ = "route_versions"
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routes.id"))
    version: Mapped[int] = mapped_column(Integer)
    # Ordered [lat, lon] vertices; first vertex is start. Checkpoints are route fractions.
    coordinates: Mapped[list] = mapped_column(JSON)
    length_m: Mapped[float] = mapped_column(Float)
    tolerance_m: Mapped[float] = mapped_column(Float, default=20)
    __table_args__ = (
        UniqueConstraint("route_id", "version"),
        CheckConstraint("length_m >= 100"),
        CheckConstraint("tolerance_m BETWEEN 5 AND 100"),
    )


class Room(Identity, Created, Base):
    __tablename__ = "rooms"
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    route_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("route_versions.id"))
    capacity: Mapped[int] = mapped_column(Integer, default=50)
    invitation_hash: Mapped[str] = mapped_column(String(64), unique=True)
    visibility: Mapped[str] = mapped_column(String(10), default="PUBLIC")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (
        CheckConstraint("capacity BETWEEN 1 AND 1000"),
        CheckConstraint("visibility IN ('PUBLIC','PRIVATE')"),
    )


class RoomMember(Base):
    __tablename__ = "room_members"
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), primary_key=True
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (Index("member_user_rooms", "user_id", "room_id"),)


class Competition(Identity, Created, Base):
    __tablename__ = "competitions"
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id"), index=True)
    route_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("route_versions.id"))
    status: Mapped[str] = mapped_column(String(12), default="LOCKED")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalize_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ranking_rules: Mapped[dict] = mapped_column(
        JSON,
        default=lambda: {
            "version": 1,
            "order": ["laps_desc", "partial_desc", "active_ms_asc"],
            "ties": "rank",
            "dnf_ranked": False,
        },
    )
    __table_args__ = (
        CheckConstraint("status IN ('LOCKED','RUNNING','FINALIZING','COMPLETED')"),
        CheckConstraint(
            "(status = 'LOCKED' AND started_at IS NULL) OR (status <> 'LOCKED' AND started_at IS NOT NULL)"
        ),
        CheckConstraint("(status = 'COMPLETED') = (published_at IS NOT NULL)"),
        Index(
            "competition_finalization_due",
            "finalize_after",
            postgresql_where="status = 'FINALIZING'",
        ),
        Index(
            "one_open_competition_per_room",
            "room_id",
            unique=True,
            postgresql_where="status <> 'COMPLETED'",
            sqlite_where=__import__("sqlalchemy").text("status <> 'COMPLETED'"),
        ),
    )


class Participant(Identity, Base):
    __tablename__ = "competition_participants"
    competition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("competitions.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="REGISTERED")
    __table_args__ = (
        UniqueConstraint("competition_id", "user_id"),
        CheckConstraint(
            "status IN ('REGISTERED','RUNNING','FINISHED','WITHDRAWN','DISQUALIFIED','RECOVERY_PENDING')"
        ),
    )


class RunningSession(Identity, Created, Base):
    __tablename__ = "running_sessions"
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("competition_participants.id"), unique=True
    )
    last_seq: Mapped[int] = mapped_column(Integer, default=0)
    # Incremental, server-only caches; avoid scanning GPS histories for dashboards.
    distance_m: Mapped[float] = mapped_column(Float, default=0)
    partial_m: Mapped[float] = mapped_column(Float, default=0)
    lap_count: Mapped[int] = mapped_column(Integer, default=0)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    location_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (
        CheckConstraint(
            "last_seq >= 0 AND distance_m >= 0 AND partial_m >= 0 AND lap_count >= 0"
        ),
    )


class Segment(Identity, Base):
    __tablename__ = "session_segments"
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("running_sessions.id"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("ended_at IS NULL OR ended_at >= started_at"),
        Index(
            "one_active_segment",
            "session_id",
            unique=True,
            postgresql_where="ended_at IS NULL",
            sqlite_where=__import__("sqlalchemy").text("ended_at IS NULL"),
        ),
    )


class GPSPoint(Base):
    __tablename__ = "gps_track_points"
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("running_sessions.id"), primary_key=True
    )
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    speed_mps: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[float | None] = mapped_column(Float)
    validation: Mapped[str] = mapped_column(String(20))
    payload_hash: Mapped[str] = mapped_column(String(64))
    __table_args__ = (
        CheckConstraint("seq > 0"),
        CheckConstraint("latitude BETWEEN -90 AND 90"),
        CheckConstraint("longitude BETWEEN -180 AND 180"),
        CheckConstraint("accuracy_m >= 0"),
        CheckConstraint("speed_mps IS NULL OR speed_mps >= 0"),
        CheckConstraint("heading IS NULL OR (heading >= 0 AND heading < 360)"),
    )


class Lap(Identity, Base):
    __tablename__ = "lap_records"
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("running_sessions.id"))
    number: Mapped[int] = mapped_column(Integer)
    from_seq: Mapped[int] = mapped_column(Integer)
    to_seq: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    active_ms: Mapped[int] = mapped_column(BigInteger)
    __table_args__ = (
        UniqueConstraint("session_id", "number"),
        UniqueConstraint("session_id", "to_seq"),
        Index("lap_evidence_ranges", "session_id", "from_seq", "to_seq"),
        CheckConstraint(
            "number > 0 AND from_seq > 0 AND to_seq > from_seq AND active_ms > 0"
        ),
        CheckConstraint("finished_at > started_at"),
    )


class Recovery(Identity, Created, Base):
    __tablename__ = "recovery_requests"
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("competition_participants.id"), index=True
    )
    reason: Mapped[str] = mapped_column(Text)
    previous_status: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(10), default="PENDING")
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_reason: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','APPROVED','REJECTED')"),
        CheckConstraint("previous_status IN ('FINISHED','WITHDRAWN')"),
        CheckConstraint(
            "(status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)"
        ),
        Index(
            "one_pending_recovery",
            "participant_id",
            unique=True,
            postgresql_where="status = 'PENDING'",
            sqlite_where=__import__("sqlalchemy").text("status = 'PENDING'"),
        ),
    )


class StatusHistory(Identity, Created, Base):
    __tablename__ = "participant_status_history"
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("competition_participants.id"), index=True
    )
    status: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(Text, default="")
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))


class Result(Base):
    __tablename__ = "competition_results"
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("competition_participants.id"), primary_key=True
    )
    rank: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (CheckConstraint("rank IS NULL OR rank > 0"),)


class AuditLog(Identity, Created, Base):
    __tablename__ = "audit_logs"
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    action: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("audit_chronology", "created_at", "id"),)
