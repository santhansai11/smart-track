# Google sign-in setup

The frontend supports Google through Supabase Auth. Hosted Google credentials have not been configured by this workspace. No Google account sign-in has been tested end to end yet.

1. Open https://console.cloud.google.com/auth/overview and select or create the SmartTrack project. Configure Branding (app name and support contact) and Audience. If in Testing, add the intended testers; configure the audience appropriately before public rollout.
2. In Clients, create an OAuth client of type **Web application**. Add the frontend origin `http://127.0.0.1:5173` (and `http://localhost:5173` if used) under Authorized JavaScript origins.
3. Add this exact Authorized redirect URI:

   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

4. In Supabase → Authentication → Sign In / Providers → Google, enable Google and enter the OAuth Client ID and Client Secret privately. Keep the secret out of frontend files and chat. Save.
5. In Supabase → Authentication → URL Configuration, allow `http://127.0.0.1:5173` and set the same Site URL. Add `http://localhost:5173` if using that origin. Use your public HTTPS origin when deploying.
6. Open SmartTrack and choose Continue with Google. Check that a new user reaches the student dashboard and can join a room. Also check returning users and cancelled consent. Google authentication itself does not require a Supabase confirmation email; email/password recovery still needs working email delivery.

SmartTrack requests basic sign-in only, without Gmail or Drive access. Supabase manages identities and sessions. Existing auth triggers create STUDENT profiles, and the backend still checks signed Supabase tokens, email verification, account blocking and database roles. Google sign-in does not grant administrator permissions.

Source: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
