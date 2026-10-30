# Deployment and operations

## Frontend: Vercel or static hosting

Set root directory to `frontend`, build command `npm run build`, output `dist`. Set public `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, and optional tile/attribution variables. `vercel.json` includes the SPA fallback and basic security headers. Use HTTPS; local geolocation usually works on loopback, but mobile access to an HTTP LAN address is not equivalent.

Vercel Hobby eligibility is subject to its current personal/non-commercial terms; confirm that your competition use qualifies. [Hobby documentation](https://vercel.com/docs/plans/hobby).

## Backend: Render or another Python host

`render.yaml` configures a free Python web service. Set the secret environment variables in the hosting dashboard. Do not deploy the local test database or `.local` directory. Install from `backend/requirements.txt`, run Alembic once with migration-owner credentials, then launch `uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `backend`.

The process contains a five-second finalizer loop. It safely catches up after restarts and serializes multiple instances through PostgreSQL locks. Free-host sleeping/cold starts can delay automatic publication; use an always-on service when continuous availability is required. Do not use an expiring Render PostgreSQL instance for historical records. [Render free service behavior](https://render.com/docs/free).

Set exact HTTPS `CORS_ORIGINS`; configure Supabase Auth redirect URLs and SMTP for the same deployment. Keep Supabase secret keys out of frontend builds. For key rotation, review JWKS cache timing and issuer/audience verification. [Supabase JWT documentation](https://supabase.com/docs/guides/auth/jwts).

## Runtime database permissions

Migrations require owner-level privileges to create triggers on `auth.users`, policies, functions and realtime publication entries. Prefer separate migration and runtime database users. The runtime user needs SELECT/INSERT/UPDATE on application tables; SELECT on `auth.users(id,email_confirmed_at,banned_until)`; and RLS bypass for backend-enforced authorization. It does not need DELETE, DDL, `auth.users` writes, or profile-role assignment through HTTP. Provision this trusted private role with a randomly generated password in your own SQL console, store its password in the backend secret manager, and verify the API test suite under that role before launch. Never expose its connection string to a browser.

Maintenance runs separately with protected administrative database credentials. RLS is the defense for direct Supabase browser access; FastAPI authorization is the defense for the private runtime connection. Do not grant authenticated users access to service functions or raw GPS tables.

The built-in limiter is per process/IP (600 requests/minute); enforce a shared request/body limit at ingress for multiple instances, and configure Supabase Auth rate limits/CAPTCHA as appropriate. Large organizations behind one NAT may require a tuned ingress policy. Never trust arbitrary forwarded-IP headers. API maximum batch size is 300 and declared request-body maximum is 256 KB; enforce a hard streamed-body limit at ingress as well.

## Maps and location

Map tiles default to OpenStreetMap standard tiles, with visible attribution. No geocoding service is called: route drawing works through panning, zooming, point selection and coordinate editing. Set a different compatible provider when traffic or policy requires it. Do not bulk prefetch/offline-cache standard OSM tiles. [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

GPS is approximate and browser callbacks can be throttled. The screen should remain awake; wake-lock requests may be denied. Device GPS spoofing cannot be ruled out. Test on the actual campus/track in both directions, with signal loss and pause/recovery, before using results for consequential awards.

## Before a hosted launch

Configure real Supabase keys, run migrations, test email verification/password recovery, and complete the first competition with real devices. Confirm mobile IndexedDB availability, interrupted upload/reload recovery, live RLS access, SMTP delivery, and free-host wake-up behavior. Monitor database relation size, pool wait times, batch latency/error rate, rejected GPS reasons and finalization backlog. Back up and restore-test regularly. No claim of unlimited storage, users, or availability is made.
