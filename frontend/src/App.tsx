import { useEffect, useState, lazy, Suspense } from "react";
import { Link, NavLink, Routes, Route, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  LayoutDashboard,
  Map,
  Users,
  Trophy,
  History,
  RotateCcw,
  Settings,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { supabase, api, useNotice, authCallback } from "./lib";
import type { Profile } from "./types";
import { Loading, ErrorBox, Button } from "./components";
import Auth from "./Auth";
const Dashboard = lazy(() =>
  import("./pages").then((m) => ({ default: m.Dashboard })),
);
const Rooms = lazy(() => import("./pages").then((m) => ({ default: m.Rooms })));
const RoomPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.RoomPage })),
);
const RoutePage = lazy(() =>
  import("./pages").then((m) => ({ default: m.RoutePage })),
);
const Competitions = lazy(() =>
  import("./pages").then((m) => ({ default: m.Competitions })),
);
const CompetitionPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.CompetitionPage })),
);
const RunPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.RunPage })),
);
const HistoryPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.HistoryPage })),
);
const RecoveryPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.RecoveryPage })),
);
const UsersPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.UsersPage })),
);
const AuditPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.AuditPage })),
);
const ProfilePage = lazy(() =>
  import("./pages").then((m) => ({ default: m.ProfilePage })),
);
const AnalyticsPage = lazy(() =>
  import("./Insights").then((m) => ({ default: m.AnalyticsPage })),
);
const SessionPage = lazy(() =>
  import("./Insights").then((m) => ({ default: m.SessionPage })),
);

export default function App() {
  const [session, setSession] = useState<string | null>(null),
    [ready, setReady] = useState(!supabase),
    [menu, setMenu] = useState(false),
    [reset, setReset] = useState(authCallback.passwordSetup),
    [passwordUpdated, setPasswordUpdated] = useState(false),
    [callbackError, setCallbackError] = useState(!!authCallback.error);
  const client = useQueryClient(),
    location = useLocation(),
    notice = useNotice();
  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      setSession(data.session?.user.id || null);
      setReady(true);
    });
    const result = supabase?.auth.onAuthStateChange((event, s) => {
      setSession(s?.user.id || null);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") setReset(true);
      if (event === "SIGNED_OUT") client.clear();
    });
    return () => result?.data.subscription.unsubscribe();
  }, [client]);
  const user = useQuery({
    queryKey: ["me", session],
    queryFn: () => api<Profile>("/users/me"),
    enabled: !!session && !reset && !callbackError,
  });
  useEffect(() => setMenu(false), [location.pathname]);
  useEffect(() => {
    if (!notice.message) return;
    const t = setTimeout(() => notice.set(""), 6000);
    return () => clearTimeout(t);
  }, [notice.message]);
  if (!ready) return <Loading />;
  if (!session || reset || callbackError)
    return (
      <>
        <Auth
          key={`${reset}-${!!session}`}
          passwordSetup={reset}
          hasSession={!!session}
          onPasswordUpdated={() => setPasswordUpdated(true)}
        />
        {session && ((reset && passwordUpdated) || callbackError) && (
          <Button
            className="reset-return"
            onClick={() => {
              setReset(false);
              setCallbackError(false);
              history.replaceState({}, "", "/");
            }}
          >
            Return to dashboard
          </Button>
        )}
      </>
    );
  if (user.isPending) return <Loading />;
  if (user.error)
    return (
      <div className="connection-error">
        <h1>Let’s connect your workspace.</h1>
        <ErrorBox error={user.error} />
        <p>
          Check the backend connection, verify your email, and apply the
          database migrations.
        </p>
        <Button onClick={() => user.refetch()}>Try again</Button>
        <Button variant="ghost" onClick={() => supabase?.auth.signOut()}>
          Sign out
        </Button>
      </div>
    );
  const profile = user.data!,
    root = profile.role === "ROOT";
  const items = [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/rooms", label: "My rooms", icon: Users },
    ...(root ? [{ to: "/routes", label: "Routes", icon: Map }] : []),
    {
      to: "/competitions",
      label: root ? "Competitions" : "Leaderboards",
      icon: Trophy,
    },
    { to: "/history", label: "Run history", icon: History },
    { to: "/analytics", label: "Analytics", icon: Activity },
    { to: "/recovery", label: "Recovery requests", icon: RotateCcw },
    ...(root
      ? [
          { to: "/users", label: "Runners", icon: Users },
          { to: "/audit", label: "Audit log", icon: ShieldCheck },
        ]
      : []),
  ];
  return (
    <div className="app">
      <button
        className="mobile-menu"
        onClick={() => setMenu(!menu)}
        aria-label="Toggle navigation"
      >
        {menu ? <X /> : <Menu />}
      </button>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          smarttrack<span className="brand-period">.</span>
        </Link>
        <div className="workspace-tag">
          <span className="pulse-dot" />
          {root ? "ADMIN WORKSPACE" : "RUNNER WORKSPACE"}
        </div>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav>
          {items.map((item) => (
            <NavLink key={item.to} end={item.to === "/"} to={item.to}>
              <item.icon size={19} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <Activity size={25} />
            <strong>Better, together.</strong>
            <p>
              Every run is a fresh start.
              <br />
              Make this one count.
            </p>
            <Link to="/rooms">
              Find your next run <ArrowUpRight size={15} />
            </Link>
          </div>
          <NavLink to="/profile" className="settings-link">
            <Settings size={18} /> Profile & settings
          </NavLink>
          <button
            className="user-chip"
            onClick={() => supabase?.auth.signOut()}
            title="Sign out"
          >
            <span className="avatar">
              {profile.full_name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              <strong>{profile.full_name}</strong>
              <small>{root ? "Root administrator" : "Student runner"}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            Workspace <span>/</span>{" "}
            <strong>
              {items.find((i) => i.to === location.pathname)?.label ||
                "Run details"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="today">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="topbar-divider" />
            <span className="avatar small">{profile.full_name[0]}</span>
          </div>
        </header>
        <main>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Dashboard user={profile} />} />
              <Route path="/rooms" element={<Rooms user={profile} />} />
              <Route path="/rooms/:id" element={<RoomPage user={profile} />} />
              <Route
                path="/routes"
                element={
                  root ? (
                    <RoutePage user={profile} />
                  ) : (
                    <Dashboard user={profile} />
                  )
                }
              />
              <Route path="/competitions" element={<Competitions />} />
              <Route
                path="/competitions/:id"
                element={<CompetitionPage user={profile} />}
              />
              <Route path="/run/:id" element={<RunPage user={profile} />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/sessions/:id" element={<SessionPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route
                path="/recovery"
                element={<RecoveryPage user={profile} />}
              />
              <Route
                path="/users"
                element={root ? <UsersPage /> : <Dashboard user={profile} />}
              />
              <Route
                path="/audit"
                element={root ? <AuditPage /> : <Dashboard user={profile} />}
              />
              <Route path="/profile" element={<ProfilePage user={profile} />} />
              <Route path="*" element={<Dashboard user={profile} />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="workspace-footer">
          <span>
            SMARTTRACK <span>·</span> EVERY LAP COUNTS
          </span>
          <span>
            Built for the long run <Activity size={13} />
          </span>
        </footer>
      </div>
      {notice.message && (
        <div className="toast" role="status">
          {notice.message}
          <button aria-label="Dismiss" onClick={() => notice.set("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
