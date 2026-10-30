# Verification record — 2026-10-30

## Executed locally

- PostgreSQL **18.4**, isolated `smarttrack_test` database, actual Alembic migrations 0001–0002, actual RLS and triggers. No SQLite substitution.
- **18 backend tests passed**: default student role despite hostile metadata, protected root changes/uniqueness, verified JWT signature/issuer/audience/expiry and email checks, immutable routes, duplicate memberships/room locking, three-hour GPS ingestion, retry payload conflicts, sequence gaps, cross-user privacy/consent, pause/resume/finish, withdrawal, recovery approval/rejection, pending-recovery blocking, publication/immutability, GPS evidence deletion protection, RLS read/write denials, API end-to-end lifecycle, simultaneous duplicate finish/finalization, and rejection of a response when transaction commit fails.
- **10 frontend tests passed**: IndexedDB atomic sequencing, account isolation, acknowledgement-only deletion, continuing a server sequence on a new device, setup/login state, registration fields, password recovery UI, student joining/admin separation, recovery review controls, and accessible confirmation dialog.
- TypeScript production build succeeded. Charts, mapping and Supabase are separate vendor chunks. Third-party Zod annotation/build warnings and a Starlette TestClient deprecation warning are non-failing dependency warnings.
- The production build generates a versioned offline-shell precache for local JS/CSS. It excludes GPS/API/auth responses and map tiles; updates wait for old tabs to close. After an offline reload, saved GPS remains on the device, but backend state must reconnect before resuming a run.
- Desktop login layout inspected at 1440 × 960 and mobile at 390 × 844, plus registration controls. Local screenshots are excluded from the public repository. Authenticated UI behavior in this initial verification was covered with component fixtures and HTTP/database tests.

## Simulated load

See [raw benchmark output](benchmark-results.json) for measurements and query plans.

- 12 concurrent runners × 3 simulated hours × 2-second sampling = **64,812 points** in batches of at most 200.
- 23.958 seconds wall time for accelerated ingestion (not a three-hour wall-clock endurance test).
- Batch median 781.48 ms; p95 1193.14 ms on this local machine.
- GPS table plus indexes: 26,017,792 bytes for 108,024 total synthetic points, including a prior three-second workload; **240.9 bytes/point**.
- `EXPLAIN (ANALYZE,BUFFERS)` captured bounded GPS history and cached-summary reads. These are local measurements, not a promise for free Supabase compute or concurrent-user capacity.

## Not yet verified

- Hosted Supabase email delivery, asymmetric-key rotation, real-account sign-in, native Supabase Realtime delivery, and SMTP password recovery (credentials not supplied).
- Real runner/device field accuracy, battery drain, permission UX across every mobile browser, background suspensions and weather/campus conditions.
- Hosted Vercel/Render availability, cold starts, production pool sizing and full Supabase Free project storage overhead.
- Backup restoration against a real project, and any organization-specific privacy/retention obligations.

The Supabase auth schema used by integration tests is a minimal **test-only** fixture. It proves database/API behavior, not Supabase’s external mail/auth infrastructure. CI is supplied but has not been run on GitHub.
