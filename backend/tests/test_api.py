from fastapi.testclient import TestClient
from app.main import app
from app.db import database
from app.auth import current_user
from .test_workflows import COORDS


def test_api_end_to_end(db, users):
    actor = [users[0]]
    app.dependency_overrides[database] = lambda: db
    app.dependency_overrides[current_user] = lambda: actor[0]
    client = TestClient(app)
    try:
        route = client.post(
            "/api/v1/routes", json={"name": "API route", "coordinates": COORDS}
        )
        assert route.status_code == 201, route.text
        room = client.post(
            "/api/v1/rooms",
            json={"name": "API room", "route_version_id": route.json()["id"]},
        )
        assert room.status_code == 201, room.text
        rid = room.json()["id"]
        actor[0] = users[1]
        assert (
            client.post(
                "/api/v1/rooms/join", json={"code": room.json()["invitation_code"]}
            ).status_code
            == 200
        )
        assert client.post("/api/v1/rooms/" + rid + "/lock").status_code == 403
        assert (
            client.patch(
                "/api/v1/users/me", json={"full_name": "Runner", "role": "ROOT"}
            ).status_code
            == 422
        )
        actor[0] = users[0]
        locked = client.post("/api/v1/rooms/" + rid + "/lock")
        assert locked.status_code == 200, locked.text
        cid = locked.json()["id"]
        assert client.post("/api/v1/competitions/" + cid + "/start").status_code == 200
        actor[0] = users[1]
        started = client.post(
            "/api/v1/competitions/" + cid + "/sessions/start", json={}
        )
        assert started.status_code == 200, started.text
        sid = started.json()["id"]
        assert (
            client.post(
                "/api/v1/sessions/" + sid + "/pause", json={"last_seq": 0}
            ).status_code
            == 200
        )
        assert client.post("/api/v1/sessions/" + sid + "/resume").status_code == 200
        assert (
            client.post(
                "/api/v1/sessions/" + sid + "/finish", json={"last_seq": 0}
            ).status_code
            == 200
        )
        assert client.get("/api/v1/competitions/" + cid + "/results").status_code == 409
        req = client.post(
            "/api/v1/competitions/" + cid + "/recovery-requests",
            json={"reason": "Accidental tap"},
        )
        assert req.status_code == 200, req.text
        assert client.get("/api/v1/dashboard").status_code == 200
        actor[0] = users[2]
        assert client.get("/api/v1/competitions/" + cid).status_code == 403
        assert client.get("/api/v1/sessions/" + sid + "/gps").status_code == 403
        actor[0] = users[0]
        assert (
            client.get("/api/v1/sessions/" + sid + "/gps").status_code == 403
        )  # no location consent
        assert (
            client.post(
                "/api/v1/admin/recovery-requests/" + req.json()["id"] + "/approve",
                json={"reason": "Resume approved"},
            ).status_code
            == 200
        )
    finally:
        app.dependency_overrides.clear()


def test_missing_authentication_rejected():
    client = TestClient(app)
    assert client.get("/api/v1/users/me").status_code in (401, 403)


def test_commit_failure_is_not_acknowledged(db, users):
    from sqlalchemy.exc import IntegrityError

    def fails_on_commit():
        yield db
        raise IntegrityError("commit", {}, Exception("deferred constraint"))

    app.dependency_overrides[database] = fails_on_commit
    app.dependency_overrides[current_user] = lambda: users[1]
    try:
        response = TestClient(app, raise_server_exceptions=False).patch(
            "/api/v1/users/me", json={"full_name": "Changed Name"}
        )
        assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()
