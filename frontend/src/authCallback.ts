// Capture only callback intent before Supabase consumes the URL fragment.
// Authentication itself is always performed by the Supabase client.
export function readAuthCallback(
  location: Pick<Location, "hash" | "search" | "pathname">,
) {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  const type = hash.get("type") || query.get("type");
  const code = hash.get("error_code") || query.get("error_code");
  const failed =
    hash.has("error") ||
    query.has("error") ||
    hash.has("error_code") ||
    query.has("error_code");
  return {
    passwordSetup:
      !failed &&
      (type === "invite" ||
        type === "recovery" ||
        location.pathname === "/reset-password"),
    error: failed
      ? code === "otp_expired" || type === "invite" || type === "recovery"
        ? "This email link is invalid, expired, or already used. If your email is verified, sign in or use Forgot password to request a fresh link."
        : "Sign-in was cancelled or could not be completed. Please try signing in again."
      : "",
  };
}
