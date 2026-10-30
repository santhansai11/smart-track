from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import text
from app.auth import current_user
from app.models import now
import app.auth as auth


def test_jwt_signature_issuer_expiry_and_verified_email(db, users, monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(
        auth,
        "settings",
        lambda: SimpleNamespace(supabase_url="https://test.supabase.co"),
    )
    monkeypatch.setattr(
        auth,
        "jwks",
        lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())
        ),
    )
    claims = {
        "sub": str(users[1].id),
        "iss": "https://test.supabase.co/auth/v1",
        "aud": "authenticated",
        "iat": now(),
        "exp": now() + timedelta(minutes=10),
    }

    def verify(data, signer=key):
        token = jwt.encode(data, signer, algorithm="ES256")
        return current_user(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db
        )

    assert verify(claims).id == users[1].id
    for bad in [
        {**claims, "iss": "https://attacker.invalid"},
        {**claims, "exp": now() - timedelta(seconds=1)},
        {**claims, "aud": "anon"},
    ]:
        with pytest.raises(HTTPException) as error:
            verify(bad)
        assert error.value.status_code == 401
    with pytest.raises(HTTPException):
        verify(claims, ec.generate_private_key(ec.SECP256R1()))
    db.execute(
        text("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=:id"),
        {"id": users[1].id},
    )
    with pytest.raises(HTTPException) as error:
        verify(claims)
    assert error.value.status_code == 403
