# Supabase workspace configuration

Initialized for SmartTrack. Replace `YOUR_PROJECT_REF` with your own Supabase project reference; authentication/linking must succeed before this directory is linked.

From the repository root:

```powershell
npx.cmd --yes supabase login
npx.cmd --yes supabase link --project-ref YOUR_PROJECT_REF
```

Complete the CLI browser login locally. Do not paste personal access tokens or database passwords into chat. The publishable key is for application authentication, not CLI management access.

SmartTrack's authoritative application migrations are in `backend/migrations` and are applied with Alembic. Initializing/linking the Supabase CLI does not install these tables. Do not use `supabase db reset --linked` on this project; it is destructive. Do not use an empty `supabase db push` as a substitute for Alembic.

To configure the private backend database connection using a hidden password prompt, run from the repository root:

```powershell
.\.venv\Scripts\python.exe backend\scripts\configure_database.py
```

The helper writes only the ignored `backend/.env`, URL-encodes the password, and requires TLS. It does not test the connection or apply migrations. If the direct database endpoint is inaccessible over IPv6, supply the **session pooler** URI template from Supabase's Connect dialog with `--template`, retaining `[YOUR-PASSWORD]` in the template; the password is still prompted separately.

After credentials are configured, inspect the hosted schema for existing objects before applying `python -m alembic upgrade head` from `backend`.
