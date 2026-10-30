import os
import uuid
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app.models import Profile


@pytest.fixture(scope="session")
def pg_engine():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL required for real PostgreSQL integration tests")
    engine = create_engine(
        url, pool_size=10, max_overflow=10, connect_args={"prepare_threshold": None}
    )
    yield engine
    engine.dispose()


@pytest.fixture
def db(pg_engine):
    conn = pg_engine.connect()
    tx = conn.begin()
    session = Session(conn, expire_on_commit=False)
    yield session
    session.close()
    tx.rollback()
    conn.close()


def identity(db, name, role="STUDENT"):
    uid = uuid.uuid4()
    import json

    db.execute(
        text(
            "INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(:id,:email,now(),CAST(:meta AS jsonb))"
        ),
        {
            "id": uid,
            "email": f"{uid}@example.com",
            "meta": json.dumps({"full_name": name, "role": "ROOT"}),
        },
    )
    p = db.get(Profile, uid)
    if role == "ROOT":
        db.execute(text("SET LOCAL smarttrack.bootstrap='enabled'"))
        p.role = "ROOT"
        db.flush()
        db.execute(text("SET LOCAL smarttrack.bootstrap=''"))
    return p


@pytest.fixture
def users(db):
    return (
        identity(db, "Root", "ROOT"),
        identity(db, "Runner One"),
        identity(db, "Runner Two"),
    )
