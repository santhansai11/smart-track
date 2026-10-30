import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight,
  Activity,
  ShieldCheck,
  Users,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase, configured, authCallback } from "./lib";
import { Button, TrackArt, ErrorBox } from "./components";
const schema = z.object({
  email: z.string(),
  password: z.string(),
  full_name: z.string(),
  confirm: z.string(),
});
type Fields = z.infer<typeof schema>;
export default function Auth({
  passwordSetup = authCallback.passwordSetup,
  hasSession = false,
  onPasswordUpdated,
}: {
  passwordSetup?: boolean;
  hasSession?: boolean;
  onPasswordUpdated?: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset" | "update">(
      passwordSetup && hasSession ? "update" : "login",
    ),
    [error, setError] = useState(
      authCallback.error ||
        (passwordSetup && !hasSession
          ? "Open a fresh password reset link from your email to set your password."
          : ""),
    ),
    [notice, setNotice] = useState(""),
    [googlePending, setGooglePending] = useState(false),
    [show, setShow] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", confirm: "", full_name: "" },
  });
  async function signInWithGoogle() {
    if (!supabase || googlePending || isSubmitting) return;
    setError("");
    setNotice("");
    setGooglePending(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch {
      setError(
        "Google sign-in could not start. Please try again. If this continues, contact the SmartTrack administrator.",
      );
      setGooglePending(false);
    }
  }
  async function submit(data: Fields) {
    setError("");
    setNotice("");
    if (!supabase) return;
    try {
      if (mode !== "update" && !z.email().safeParse(data.email).success)
        throw new Error("Enter a valid email address.");
      if (mode === "register") {
        if (data.password.length < 10)
          throw new Error("Use a password with at least 10 characters.");
        if (data.password !== data.confirm)
          throw new Error("Passwords do not match.");
        if (data.full_name.trim().length < 2)
          throw new Error("Please enter your full name.");
        const { error } = await supabase.auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            data: { full_name: data.full_name },
            emailRedirectTo: location.origin,
          },
        });
        if (error) throw error;
        setNotice("Check your email to verify your account, then sign in.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          data.email,
          { redirectTo: location.origin + "/reset-password" },
        );
        if (error) throw error;
        setNotice("If an account exists, a password reset link is on its way.");
      } else if (mode === "update") {
        if (!hasSession)
          throw new Error("Open a fresh password reset link from your email.");
        if (data.password.length < 10)
          throw new Error("Use a password with at least 10 characters.");
        if (data.password !== data.confirm)
          throw new Error("Passwords do not match.");
        const { error } = await supabase.auth.updateUser({
          password: data.password,
        });
        if (error) throw error;
        setNotice("Password updated. You can return to your dashboard.");
        onPasswordUpdated?.();
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password,
        });
        if (error) throw error;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to sign in";
      const code = e && typeof e === "object" && "code" in e ? e.code : "";
      setError(
        code === "over_email_send_rate_limit" ||
          message.toLowerCase().includes("email rate limit exceeded")
          ? "Email delivery is temporarily limited. Please wait before requesting another email. If this keeps happening, contact the SmartTrack administrator."
          : code === "email_address_not_authorized"
            ? "Email delivery is not enabled for this address yet. Please contact the SmartTrack administrator."
            : message,
      );
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-visual">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          smarttrack<span className="brand-period">.</span>
        </a>
        <div className="auth-story">
          <div className="eyebrow">FIND YOUR STRIDE</div>
          <h1>
            Your route.
            <br />
            Your rhythm.
            <br />
            <em>Your people.</em>
          </h1>
          <p>
            A little friendly competition.
            <br />A better reason to get out and run.
          </p>
          <TrackArt />
        </div>
        <div className="auth-footer">
          <span>
            <ShieldCheck size={15} /> Built for fair competition
          </span>
          <span>ONE LAP AT A TIME ↗</span>
        </div>
      </div>
      <div className="auth-form-wrap">
        {mode !== "update" && (
          <div className="auth-top">
            <span>New to the track?</span>
            <button
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setError("");
                setNotice("");
              }}
            >
              {mode === "register" ? "Sign in" : "Create an account"}{" "}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <div className="auth-form">
          <div className="auth-icon">
            <Activity />
          </div>
          <div className="eyebrow">LET’S GET MOVING</div>
          <h2>
            {mode === "register"
              ? "Join the starting line."
              : mode === "reset"
                ? "Back on track."
                : mode === "update"
                  ? "Set your password."
                  : "Welcome back, runner."}
          </h2>
          <p>
            {mode === "register"
              ? "Create your account. Your next lap starts here."
              : mode === "reset"
                ? "We’ll email you a link to reset your password."
                : mode === "update"
                  ? "Choose a password with at least 10 characters to secure your account."
                  : "Sign in to your runs, your rooms, and your next personal best."}
          </p>
          {!configured && (
            <div className="setup-note">
              <strong>Your workspace is ready to connect</strong>
              <span>
                Add your Supabase URL and publishable key to{" "}
                <code>frontend/.env</code> to enable verified accounts. See the
                setup guide in the project.
              </span>
            </div>
          )}
          {(mode === "login" || mode === "register") && (
            <>
              <Button
                type="button"
                variant="secondary"
                className="auth-submit"
                onClick={signInWithGoogle}
                disabled={!configured || googlePending || isSubmitting}
              >
                {googlePending ? "Opening Google…" : "Continue with Google"}
                <ArrowRight size={18} />
              </Button>
              <div className="auth-divider">
                <span>OR USE YOUR EMAIL</span>
              </div>
            </>
          )}
          <form onSubmit={handleSubmit(submit)}>
            {mode === "register" && (
              <label>
                Full name
                <input
                  {...register("full_name")}
                  autoComplete="name"
                  placeholder="How should we call you?"
                  required
                />
              </label>
            )}
            {mode !== "update" && (
              <label>
                Email address
                <input
                  {...register("email")}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </label>
            )}
            {errors.email && (
              <span className="field-error">{errors.email.message}</span>
            )}
            {mode !== "reset" && (
              <label>
                Password
                <div className="password-input">
                  <input
                    {...register("password")}
                    type={show ? "text" : "password"}
                    autoComplete={
                      mode === "register" || mode === "update"
                        ? "new-password"
                        : "current-password"
                    }
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    aria-label={show ? "Hide password" : "Show password"}
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            )}
            {(mode === "register" || mode === "update") && (
              <label>
                Confirm password
                <input
                  {...register("confirm")}
                  type="password"
                  autoComplete="new-password"
                  placeholder="One more time"
                  required
                />
              </label>
            )}
            {mode === "login" && (
              <div className="form-between">
                <span>
                  <ShieldCheck size={14} /> Secure sign-in
                </span>
                <button type="button" onClick={() => setMode("reset")}>
                  Forgot password?
                </button>
              </div>
            )}
            <ErrorBox error={error} />
            {notice && (
              <div className="success" role="status">
                {notice}
              </div>
            )}
            <Button
              className="auth-submit"
              disabled={!configured || isSubmitting || googlePending}
            >
              {isSubmitting
                ? "Just a moment…"
                : mode === "register"
                  ? "Create account"
                  : mode === "reset"
                    ? "Send reset link"
                    : mode === "update"
                      ? "Update password"
                      : "Sign in"}
              <ArrowRight size={18} />
            </Button>
          </form>
          {mode === "reset" && (
            <button className="text-link" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          )}
          <div className="auth-divider">
            <span>YOUR NEXT CHAPTER STARTS HERE</span>
          </div>
          <div className="auth-benefits">
            <div>
              <Activity />
              <span>
                Track your
                <br />
                <strong>progress</strong>
              </span>
            </div>
            <div>
              <Users />
              <span>
                Run with
                <br />
                <strong>your team</strong>
              </span>
            </div>
            <div>
              <ShieldCheck />
              <span>
                Every lap
                <br />
                <strong>validated</strong>
              </span>
            </div>
          </div>
        </div>
        <div className="auth-bottom">
          Run. Track. Compete. <span>Made for the long run.</span>
        </div>
      </div>
    </div>
  );
}
