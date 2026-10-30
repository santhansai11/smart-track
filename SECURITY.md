# Security and configuration

- Copy the example environment files locally and fill in your own project values. Never commit real environment files, credentials, access tokens, database dumps or GPS exports.
- Frontend `VITE_*` variables are public browser configuration. Supabase publishable keys are designed for this use with appropriate authorization/RLS. Google Maps browser keys require website and API restrictions. Client-side values cannot be made secret by hiding them in a build.
- Database URLs/passwords, Supabase administrative keys, Google OAuth client secrets and SMTP credentials belong only in private backend/provider configuration. Hosted deployments must use HTTPS.
- Administrator permissions are enforced by the backend. Email matching or frontend role values do not grant administrator access.
- Do not post sensitive vulnerability details or credentials in public issues. Use GitHub private vulnerability reporting if enabled, or contact the repository owner privately.
- If a real secret has been shared or committed, rotate it at its provider. Removing it from a file does not invalidate it or erase previously published history.

Automated tests are not a security audit. Real-device GPS, offline recovery, deployed authentication and operational backup/restore need field validation before production use.
