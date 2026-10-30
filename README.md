# SmartTrack

A React + FastAPI application for GPS running, room competitions, administrator-approved recovery, and validated results. PostgreSQL is authoritative; Supabase supplies authentication, PostgreSQL, RLS, and restricted realtime events.

## What is implemented

- Responsive student/admin workspaces; registration, login, Google OAuth integration, verification and password-reset UI; profile editing and account blocking.
- Separate administrator and student permissions. All public registrations become students.
- Closed-loop route drawing, latitude/longitude navigation, GPS route recording with local drafts, point removal/coordinate editing, immutable route versions, route enable/disable; OpenStreetMap by default and optional Google Maps integration.
- Public/private rooms with hashed invitation codes, capacity checks, duplicate-safe joining, locked participant snapshots, and room reuse.
- Competition start, pause/resume/finish, withdrawal/disqualification, audited recovery decisions, automatic publication after a configurable recovery grace period, tied ranks and unranked DNF records.
- Browser GPS, configurable 2–5 second sampling, server corridor/speed/direction/checkpoint validation, lap evidence, bounded bulk uploads, durable IndexedDB buffering, retry protection, cross-tab capture locks.
- Private paginated GPS/lap history, consent-controlled administrator trail access, leaderboards, weekly/monthly analytics, and audit logs.
- Database migrations, RLS, append-only history protections, evidence-safe retention, tests, local PostgreSQL load benchmark, and deployment configuration.

No fake accounts, seeded demonstration data, or in-browser database are used by the application. Synthetic records are confined to the isolated **test** database. Optional map/geocoding integrations are replaceable; no paid API is required.

## Quick start

Prerequisites: Python 3.12+ (tested on 3.13), Node 22+ (tested on 24), a Supabase project with asymmetric JWT signing keys, and its PostgreSQL connection details.

From the repository root (PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

If Anaconda cannot bootstrap pip in the venv, use `python -m pip --python .venv/Scripts/python.exe install -r backend/requirements.txt`.

1. Fill in the two `.env` files locally. **Do not commit or paste secret keys into chat.** Frontend `VITE_*` variables are public. `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `SUPABASE_SECRET_KEY` are server-only secrets.
2. In Supabase Auth, enable **Confirm email**, configure the application Site URL, and allow both the frontend origin and `<origin>/reset-password` in redirect URLs. Configure SMTP for delivery to real users. Use **ES256 or RS256** asymmetric signing keys; legacy HS256 tokens are intentionally rejected.
3. Set `DATABASE_URL` to the private pooled URL using the `postgresql+psycopg://` scheme with `sslmode=require` for hosted connections. Use a direct/session-pooler connection for `MIGRATION_DATABASE_URL`. See [deployment](docs/deployment.md) for least-privilege runtime credentials.
4. Apply migrations from `backend`:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

5. In another terminal:

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Open the Vite URL printed in the terminal. API documentation is at `http://localhost:8000/docs`. The frontend starts without Supabase configuration and explains the missing setup; authentication is disabled until configured. `/health` is process health; `/ready` checks the database. Set `CORS_ORIGINS` to the **exact** frontend origin (including `127.0.0.1` vs `localhost` and port).

## First real competition

1. Sign in as an administrator, create a closed-loop route in running direction (at least four vertices, at least 100 m).
2. Create a room. Copy its one-time displayed invitation code and share it with students yourself.
3. Students register using any email domain, verify their emails, sign in, and join by code.
4. The administrator locks registration and starts the competition. Each student opens their run and starts tracking with location permission.
5. Keep the browser foreground and screen awake. The application requests a wake lock when supported.
6. Pause/finish synchronize pending GPS first. Withdrawing a runner retains all already uploaded records. Administrators should coordinate with disconnected runners before resolving them; data captured after withdrawal cannot be accepted as running evidence.
7. Finished/withdrawn runners can request recovery before publication. Administrator approval continues the same session, laps, and partial progression. Return beside the last validated point to resume partial-lap progression.
8. All registered participants must finish or be formally resolved. Pending recovery blocks publication. The finalizer waits `RECOVERY_WINDOW_SECONDS` after the last resolution and publishes once.

## Verify

```powershell
# frontend
npm.cmd test
npm.cmd run build
# backend (from backend/)
$env:TEST_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:55432/smarttrack_test'
..\.venv\Scripts\python.exe -m pytest -q
..\.venv\Scripts\python.exe -m scripts.benchmark --runners 12 --interval 2 --output ../docs/benchmark-results.json
```

Create a dedicated test database, apply `backend/tests/auth_stub.sql` **only there**, and run Alembic migrations first. The stub supplies minimal Supabase auth tables/roles; it is not an authentication implementation. PostgreSQL tests explicitly skip without `TEST_DATABASE_URL`; do not interpret skipped tests as verification. The benchmark refuses databases whose URL lacks `smarttrack_test` and intentionally retains synthetic history.

See [verification evidence](docs/verification.md), [database decisions and storage](docs/database.md), and [deployment](docs/deployment.md).

Additional setup: [Google sign-in](docs/google-sign-in.md), [optional Google Maps](docs/google-maps.md), and [GPS route recording](docs/gps-route-recording.md). Provider credentials and billing setup, where required, are supplied privately by each deployment owner.

## Credentials and public source

This repository contains application source and placeholder `.env.example` files. Real `.env` files, local databases, build output, logs, screenshots and private deployment records are ignored. Keep runtime secrets in the deployment platform's secret settings. Browser `VITE_*` configuration is visible to users; do not put database passwords, OAuth client secrets or Supabase secret keys there. See [security guidance](SECURITY.md).

## Practical limits

This is a foreground browser PWA. It cannot promise continuous background GPS, perfect accuracy, tamper-proof device coordinates, or uninterrupted free hosting. GPS settings need real track/device calibration. The implementation was tested locally; live Supabase email delivery, real device GPS, and hosted deployment need credentials and field testing. No external account or deployment has been created.
