from functools import lru_cache
from uuid import UUID
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session
from .config import settings
from .db import database
from .models import Profile

bearer = HTTPBearer()


@lru_cache
def jwks():
    cfg = settings()
    return jwt.PyJWKClient(
        cfg.supabase_jwt_jwks_url
        or f"{cfg.supabase_url}/auth/v1/.well-known/jwks.json",
        lifespan=300,
    )


def current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(database, scope="function"),
):
    cfg = settings()
    if not cfg.supabase_url:
        raise HTTPException(503, "Supabase authentication is not configured")
    try:
        key = jwks().get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{cfg.supabase_url}/auth/v1",
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
        uid = UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(401, "Invalid or expired access token")
    # Verify current email confirmation/blocking in auth.users, not user-editable metadata.
    verified = (
        db.execute(
            text(
                "SELECT email_confirmed_at, banned_until FROM auth.users WHERE id=:id"
            ),
            {"id": uid},
        )
        .mappings()
        .first()
    )
    from .models import now

    if (
        not verified
        or not verified["email_confirmed_at"]
        or (verified["banned_until"] and verified["banned_until"] > now())
    ):
        raise HTTPException(403, "A verified, unblocked account is required")
    profile = db.get(Profile, uid)
    if not profile or not profile.active:
        raise HTTPException(403, "Account unavailable or blocked")
    return profile


def root_user(user: Profile = Depends(current_user)):
    if user.role != "ROOT":
        raise HTTPException(403, "Root administrator required")
    return user
