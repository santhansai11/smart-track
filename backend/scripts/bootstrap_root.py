"""Run locally with privileged environment; never exposed as an HTTP endpoint."""

import argparse
import getpass
import httpx
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from app.config import settings
from app.db import engine
from app.models import Profile
from app.services import audit


def verified_identity(cfg, token, api_key):
    response = httpx.get(
        f"{cfg.supabase_url}/auth/v1/user",
        headers={"apikey": api_key, "Authorization": f"Bearer {token}"},
        timeout=15,
    )
    response.raise_for_status()
    identity = response.json()
    if identity.get("email", "").casefold() != cfg.root_admin_email.casefold() or not identity.get("email_confirmed_at"):
        raise SystemExit("Authentication must belong to the configured, verified email")
    return identity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sign-in', action='store_true', help='Sign in using the root account password in a hidden prompt, instead of pasting an access token')
    args = parser.parse_args()
    cfg = settings()
    api_key = cfg.supabase_publishable_key or cfg.supabase_secret_key
    if not cfg.root_admin_email or not api_key:
        raise SystemExit("Configure ROOT_ADMIN_EMAIL and SUPABASE_PUBLISHABLE_KEY")
    if args.sign_in:
        password = getpass.getpass('Verified root account password (hidden; not the database password): ')
        response = httpx.post(
            f'{cfg.supabase_url}/auth/v1/token?grant_type=password',
            headers={'apikey': api_key},
            json={'email': cfg.root_admin_email, 'password': password},
            timeout=15,
        )
        if not response.is_success:
            raise SystemExit('Account sign-in failed. Verify the account email and password in Supabase first.')
        token = response.json()['access_token']
    else:
        token = getpass.getpass("Verified root account access token (hidden): ")
    identity = verified_identity(cfg, token, api_key)
    from uuid import UUID

    with Session(engine()) as db, db.begin():
        db.execute(text("LOCK TABLE profiles IN EXCLUSIVE MODE"))
        existing = db.scalar(select(Profile).where(Profile.role == "ROOT"))
        if existing:
            if str(existing.id) == identity["id"]:
                print("Root already provisioned")
                return
            raise SystemExit(
                "A different root already exists. Email changes do not transfer ownership."
            )
        p = db.get(Profile, UUID(identity["id"]))
        if not p:
            raise SystemExit("Profile does not exist; apply migrations first")
        db.execute(text("SET LOCAL smarttrack.bootstrap='enabled'"))
        p.role = "ROOT"
        audit(db, p, "root.provisioned", p.id)
    print("Verified account provisioned as the sole root.")


if __name__ == "__main__":
    main()
