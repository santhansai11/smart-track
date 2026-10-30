# Google Maps view

SmartTrack now supports the official Google Maps JavaScript API across route creation, GPS route recording, room/competition maps, running and GPS history. Maps include road/satellite controls, route lines, a start/finish marker, live location, coordinate jumps and route-point removal. Administrators can also drag route vertices. Lap validation remains in PostgreSQL/backend services; changing the map provider does not change routes or results.

## Enable it

1. In Google Cloud, use a billing-enabled project and enable **Maps JavaScript API**.
2. Create a browser API key. Restrict it to **Maps JavaScript API**, and set website/referrer restrictions for `http://127.0.0.1:5173/*`, `http://localhost:5173/*` and your deployed HTTPS site as appropriate.
3. In ignored `frontend/.env`, set `VITE_GOOGLE_MAPS_API_KEY=your_browser_maps_key`.
4. Restart Vite (`npm run dev -- --strictPort`) or rebuild/redeploy for production. Google Maps activates automatically when the key is populated.

This is a Maps browser API key, not the Google OAuth client ID or client secret. Browser keys are visible to clients and need website/API restrictions. Keep OAuth secrets out of frontend environment variables.

The key is not configured yet. Without it, existing OpenStreetMap views remain available. If Google fails to load, a message offers an explicit OpenStreetMap fallback. Multiple maps share the SDK loader, and GPS/route updates reuse an existing map instance. Google map loads can incur usage charges; review quotas and billing before rollout. No billing account or Google project settings have been changed by this implementation.

Google Maps requires a network connection. Local GPS buffering continues independently of map availability. The service worker does not cache Google's scripts, imagery or API responses. No Places, Directions, Geocoding or deprecated Drawing library is used.

Validation covers mocked SDK route plotting, clicks, coordinate jumps, GPS following, map reuse, resource cleanup and authentication fallback. Live Google imagery and credential acceptance still require your configured key.

Official setup: https://developers.google.com/maps/documentation/javascript/get-api-key
Billing: https://developers.google.com/maps/documentation/javascript/usage-and-billing
