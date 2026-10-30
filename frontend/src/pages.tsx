import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Flag,
  Footprints,
  Lock,
  MapPin,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Route as RouteIcon,
  ShieldCheck,
  Signal,
  Square,
  Trophy,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { api, date, duration, km, supabase, useNotice } from "./lib";
import type {
  Profile,
  Route,
  Room,
  RoomDetail,
  Competition,
  CompetitionDetail,
  RunSession,
  Stats,
  Participant,
  Recovery,
  Lap,
} from "./types";
import {
  Button,
  Badge,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeading,
  Metric,
  SectionTitle,
  TrackArt,
  Pagination,
} from "./components";
import MapView from "./MapView";
import { useTracker } from "./useTracker";
import RouteRecorder from "./RouteRecorder";

function useData<T>(path: string, poll = false) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path),
    refetchInterval: poll ? 5000 : false,
  });
}
function useAction() {
  const client = useQueryClient(),
    notice = useNotice();
  return useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
      message,
    }: {
      path: string;
      body?: unknown;
      method?: string;
      message?: string;
    }) => api(path, method, body).then((result) => ({ result, message })),
    onSuccess: ({ message }) => {
      void client.invalidateQueries();
      if (message) notice.set(message);
    },
  });
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function useRealtime(id?: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!supabase || !id) return;
    const channel = supabase
      .channel(`competition-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competitions",
          filter: `id=eq.${id}`,
        },
        () => void client.invalidateQueries(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competition_participants",
          filter: `competition_id=eq.${id}`,
        },
        () => void client.invalidateQueries(),
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [id, client]);
}

function RoomEditor({ room }: { room: RoomDetail }) {
  const [open, setOpen] = useState(false),
    routes = useQuery({
      queryKey: ["room-edit-routes"],
      queryFn: () => api<Route[]>("/routes?limit=100"),
      enabled: open,
    }),
    action = useAction();
  return (
    <>
      <Button
        variant="secondary"
        className="full"
        onClick={() => setOpen(true)}
        disabled={room.competitions.some((c) => c.status !== "COMPLETED")}
      >
        Edit room settings
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Room settings">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await action.mutateAsync({
                path: `/rooms/${room.id}`,
                method: "PATCH",
                body: {
                  name: f.get("name"),
                  description: f.get("description"),
                  capacity: Number(f.get("capacity")),
                  visibility: f.get("visibility"),
                  route_version_id: f.get("route"),
                },
                message:
                  "Room settings saved. Historical competitions keep their original route.",
              });
              setOpen(false);
            } catch {}
          }}
        >
          <Field label="Room name">
            <input
              name="name"
              defaultValue={room.name}
              required
              minLength={2}
            />
          </Field>
          <Field label="Description">
            <textarea name="description" defaultValue={room.description} />
          </Field>
          <Field label="Route version">
            <select name="route" defaultValue={room.route_version_id}>
              <option value={room.route_version_id}>
                {room.route_name} · current v{room.route.version}
              </option>
              {routes.data
                ?.filter(
                  (r) => r.active && r.version.id !== room.route_version_id,
                )
                .map((r) => (
                  <option key={r.id} value={r.version.id}>
                    {r.name} · v{r.version.version}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Capacity">
              <input
                name="capacity"
                type="number"
                min={1}
                max={1000}
                defaultValue={room.capacity}
              />
            </Field>
            <Field label="Visibility">
              <select name="visibility" defaultValue={room.visibility}>
                <option>PUBLIC</option>
                <option>PRIVATE</option>
              </select>
            </Field>
          </div>
          <ErrorBox error={action.error} />
          <Button disabled={action.isPending}>Save settings</Button>
        </form>
      </Modal>
    </>
  );
}

export function Dashboard({ user }: { user: Profile }) {
  const stats = useData<Stats>("/dashboard", true),
    rooms = useData<Room[]>("/rooms?limit=4", true),
    comps = useData<Competition[]>("/competitions?limit=4", true),
    runs = useData<RunSession[]>("/sessions?limit=12");
  const root = user.role === "ROOT";
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE PROGRESS, EVERY DAY"
        title={`Good to see you, ${user.full_name.split(" ")[0]}.`}
        description={
          root
            ? "Your community, your competitions. All in one place."
            : "Lace up. Your next great run is just around the corner."
        }
        action={
          <Link className="btn secondary" to="/rooms">
            <Plus size={17} />
            {root ? "Create a room" : "Join a room"}
          </Link>
        }
      />
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="pulse-dot" /> YOUR NEXT LAP STARTS HERE
          </div>
          <h2>
            Find your pace.
            <br />
            Go a little further.
          </h2>
          <p>
            {root
              ? "Bring your runners together. Set the route, start the clock, and let the progress happen."
              : "A shared route. A little motivation. Join your team and turn today’s effort into tomorrow’s progress."}
          </p>
          <Link className="btn lime" to={root ? "/routes" : "/rooms"}>
            {root ? "Plan a new route" : "Explore your rooms"}
            <ArrowUpRight size={17} />
          </Link>
        </div>
        <TrackArt />
        <div className="hero-caption">
          <span>MOVE WITH PURPOSE</span>
          <span>01 / EVERY LAP COUNTS</span>
        </div>
      </div>
      <ErrorBox error={stats.error} />
      <div className="metrics">
        <Metric
          label={root ? "Registered runners" : "Total runs"}
          value={root ? (stats.data?.users ?? "—") : (stats.data?.runs ?? "—")}
          icon={<Users size={18} />}
          note={
            root
              ? "Your growing running community"
              : "Every finish is a fresh beginning"
          }
        />
        <Metric
          label="Distance covered"
          value={stats.data ? km(stats.data.distance_m) : "—"}
          unit="km"
          icon={<RouteIcon size={18} />}
        />
        <Metric
          label="Completed laps"
          value={stats.data?.laps ?? "—"}
          icon={<Flag size={18} />}
          note="Validated along assigned routes"
        />
        <Metric
          label={root ? "Live competitions" : "Your rooms"}
          value={root ? (stats.data?.live ?? "—") : (stats.data?.rooms ?? "—")}
          icon={<Zap size={18} />}
          note={
            root ? "On the track right now" : "Find your people, find your pace"
          }
        />
      </div>
      {root && stats.data && (
        <div className="overview-strip">
          <span>{stats.data.active_users} active accounts</span>
          <span>{stats.data.rooms} rooms</span>
          <span>{stats.data.routes} routes</span>
          <span>{stats.data.runs} sessions</span>
          <span>{stats.data.completed} completed competitions</span>
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <SectionTitle
            title="On your starting line"
            aside={
              <Link to="/rooms">
                View rooms <ArrowUpRight size={15} />
              </Link>
            }
          />
          <ErrorBox error={rooms.error} />
          {rooms.data?.length ? (
            <div className="room-list">
              {rooms.data.map((room, i) => (
                <Link
                  to={room.joined || root ? `/rooms/${room.id}` : "/rooms"}
                  className="room-row"
                  key={room.id}
                >
                  <div className={`room-symbol c${i}`}>
                    <RouteIcon size={25} />
                  </div>
                  <div>
                    <h3>{room.name}</h3>
                    <p>
                      <MapPin size={12} />
                      {room.route_name}
                      <span>·</span>
                      {room.member_count} runners
                    </p>
                  </div>
                  <Badge status={room.locked ? "LOCKED" : "OPEN"} />
                  <ChevronRight size={18} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="Your starting line is waiting"
              description={
                root
                  ? "Create a route, then a room to bring your runners together."
                  : "Join a room with an invitation code from your administrator."
              }
              action={
                <Link className="text-link" to="/rooms">
                  {root ? "Create your first room" : "Find a room"}{" "}
                  <ArrowRight size={15} />
                </Link>
              }
            />
          )}
        </section>
        <section className="panel progress-panel">
          <SectionTitle
            title="The bigger picture"
            aside={<Activity size={18} />}
          />
          <div className="progress-number">
            {stats.data ? km(stats.data.distance_m) : "0.00"}{" "}
            <span>km covered</span>
          </div>
          <p>One run at a time. It all adds up.</p>
          {runs.data?.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart
                  data={[...runs.data].reverse().map((r) => ({
                    name: date(r.created_at),
                    km: Number(km(r.distance_m)),
                  }))}
                >
                  <defs>
                    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8bbd6c" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#8bbd6c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" hide />
                  <Tooltip />
                  <Area
                    dataKey="km"
                    type="monotone"
                    stroke="#477e4f"
                    fill="url(#area)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="chart-empty">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <small>Your progress will appear after your first run.</small>
            </div>
          )}
          <Link to="/history" className="text-link">
            Explore your run history <ArrowUpRight size={15} />
          </Link>
        </section>
      </div>
      <section className="panel">
        <SectionTitle
          title="Competition hub"
          aside={
            <Link to="/competitions">
              View all <ArrowUpRight size={15} />
            </Link>
          }
        />
        <ErrorBox error={comps.error} />
        {comps.data?.length ? (
          <CompetitionTable rows={comps.data} />
        ) : (
          <Empty
            title="A little competition goes a long way"
            description="Competitions appear here when your administrator locks a room. Keep an eye on your starting line."
          />
        )}
      </section>
    </>
  );
}

export function Rooms({ user }: { user: Profile }) {
  const root = user.role === "ROOT",
    [offset, setOffset] = useState(0),
    rooms = useData<Room[]>(`/rooms?offset=${offset}`, true),
    routes = useQuery({
      queryKey: ["/routes"],
      queryFn: () => api<Route[]>("/routes"),
      enabled: root,
    }),
    action = useAction(),
    navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [code, setCode] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const { result } = await action.mutateAsync({
        path: root ? "/rooms" : "/rooms/join",
        body: root
          ? {
              name: f.get("name"),
              description: f.get("description"),
              route_version_id: f.get("route"),
              capacity: Number(f.get("capacity")),
              visibility: f.get("visibility"),
            }
          : { code: f.get("code") },
        message: root ? "Room created" : "You’re in. Welcome to the room!",
      });
      const row = result as Room & { invitation_code?: string };
      if (root) setCode(row.invitation_code || "");
      else {
        setOpen(false);
        navigate(`/rooms/${row.id}`);
      }
    } catch {}
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR RUNNING COMMUNITY"
        title={root ? "Bring your runners together." : "Find your people."}
        description="Shared routes. Friendly competition. Better runs, together."
        action={
          <Button
            onClick={() => {
              setOpen(true);
              setCode("");
              action.reset();
            }}
          >
            <Plus size={18} />
            {root ? "Create room" : "Join with a code"}
          </Button>
        }
      />
      <ErrorBox error={rooms.error} />
      {rooms.isPending ? (
        <Loading />
      ) : rooms.data?.length ? (
        <div className="cards-grid">
          {rooms.data.map((r) => (
            <div className="panel room-card" key={r.id}>
              <div className="room-card-art">
                <RouteIcon size={56} strokeWidth={1} />
                <Badge status={r.locked ? "LOCKED" : "OPEN"} />
              </div>
              <div className="room-card-body">
                <div className="eyebrow">{r.visibility} ROOM</div>
                <h2>{r.name}</h2>
                <p>
                  {r.description || "A shared starting line for your next run."}
                </p>
                <div className="room-meta">
                  <span>
                    <MapPin size={15} />
                    {r.route_name}
                  </span>
                  <span>
                    <Users size={15} />
                    {r.member_count} / {r.capacity} runners
                  </span>
                </div>
                <Link
                  className="btn secondary full"
                  to={root || r.joined ? `/rooms/${r.id}` : "#"}
                  onClick={(e) => {
                    if (!root && !r.joined) {
                      e.preventDefault();
                      setOpen(true);
                    }
                  }}
                >
                  {root || r.joined ? "Open room" : "Enter invitation code"}
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Start something good."
            description={
              root
                ? "First create a route, then invite your community to a room."
                : "Your administrator will give you an invitation code. Join a room to start running."
            }
          />
        </div>
      )}
      <Pagination
        offset={offset}
        setOffset={setOffset}
        count={rooms.data?.length || 0}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={
          code
            ? "Your room is ready"
            : root
              ? "Create a room"
              : "Join your team"
        }
      >
        {code ? (
          <div className="invite-result">
            <CheckCircle2 size={40} />
            <p>
              Share this invitation code with your runners. This is the only
              time it will be displayed.
            </p>
            <code>{code}</code>
            <Button
              onClick={() =>
                navigator.clipboard
                  .writeText(code)
                  .then(() =>
                    useNotice.getState().set("Invitation code copied"),
                  )
              }
            >
              Copy invitation code
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {root ? (
              <>
                <Field label="Room name">
                  <input
                    name="name"
                    minLength={2}
                    maxLength={120}
                    required
                    placeholder="Saturday morning crew"
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    name="description"
                    placeholder="A little about this group"
                  />
                </Field>
                <Field label="Assigned route">
                  <select name="route" required>
                    <option value="">Choose a route</option>
                    {routes.data
                      ?.filter((r) => r.active)
                      .map((r) => (
                        <option key={r.id} value={r.version.id}>
                          {r.name} · {km(r.version.length_m)} km
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="Runner capacity">
                    <input
                      name="capacity"
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={50}
                      required
                    />
                  </Field>
                  <Field label="Visibility">
                    <select name="visibility">
                      <option value="PUBLIC">Public · discoverable</option>
                      <option value="PRIVATE">Private · code only</option>
                    </select>
                  </Field>
                </div>
                <p className="hint">
                  All rooms require an invitation code to join.
                </p>
              </>
            ) : (
              <Field label="Invitation code">
                <input
                  name="code"
                  required
                  minLength={8}
                  maxLength={32}
                  placeholder="Enter your room code"
                  className="code-input"
                />
              </Field>
            )}
            <ErrorBox error={action.error} />
            <Button className="full" disabled={action.isPending}>
              {action.isPending
                ? "Please wait…"
                : root
                  ? "Create room"
                  : "Join room"}
              <ArrowRight size={17} />
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}

export function RoomPage({ user }: { user: Profile }) {
  const { id } = useParams(),
    room = useData<RoomDetail>(`/rooms/${id}`, true),
    [offset, setOffset] = useState(0),
    members = useData<{ id: string; full_name: string; joined_at: string }[]>(
      `/rooms/${id}/members?offset=${offset}`,
      true,
    ),
    action = useAction(),
    root = user.role === "ROOT";
  if (room.isPending) return <Loading />;
  if (!room.data) return <ErrorBox error={room.error} />;
  const r = room.data;
  const readyCompetition = r.competitions.find((c) => c.status === "LOCKED");
  return (
    <>
      <Link className="back-link" to="/rooms">
        ← Back to rooms
      </Link>
      <PageHeading
        eyebrow="A SHARED STARTING LINE"
        title={r.name}
        description={
          r.description || "Your route, your team, your next competition."
        }
        action={<Badge status={r.locked ? "LOCKED" : "OPEN"} />}
      />
      <div className="detail-grid">
        <section className="panel">
          <SectionTitle
            title={r.route_name}
            aside={<span className="muted">Version {r.route.version}</span>}
          />
          <MapView coordinates={r.route.coordinates} />
          <div className="route-details">
            <span>
              <RouteIcon size={19} />
              <strong>{km(r.route.length_m)} km</strong> Route distance
            </span>
            <span>
              <Signal size={19} />
              <strong>± {r.route.tolerance_m} m</strong> GPS corridor
            </span>
            <span>
              <Users size={19} />
              <strong>{r.capacity}</strong> Runner capacity
            </span>
          </div>
        </section>
        <section className="panel">
          <SectionTitle title="Competition control" />
          {r.competitions.length ? (
            <div className="competition-stack">
              {r.competitions.map((c) => (
                <Link key={c.id} to={`/competitions/${c.id}`}>
                  <Badge status={c.status} />
                  <span>
                    Open competition · {date(c.created_at)}{" "}
                    <ArrowUpRight size={15} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="Ready when you are"
              description="Lock registration to save the participant snapshot and prepare a competition."
            />
          )}
          {root && (
            <div className="panel-actions">
              <RoomEditor room={r} />
              <ErrorBox error={action.error} />
              {!r.locked ? (
                <Button
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      path: `/rooms/${id}/lock`,
                      message:
                        "Registration locked. Participant snapshot saved.",
                    })
                  }
                >
                  <Lock size={16} />
                  Lock registration
                </Button>
              ) : readyCompetition ? (
                <>
                  <p className="hint">
                    Registration is locked. You can start with fewer runners
                    than the room capacity; a full room is not required.
                  </p>
                  <Button
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        path: `/competitions/${readyCompetition.id}/start`,
                        message: "Competition started. Runners can now begin.",
                      })
                    }
                  >
                    <Play size={17} />
                    Start competition
                  </Button>
                </>
              ) : r.competitions.every((c) => c.status === "COMPLETED") ? (
                <Button
                  onClick={() =>
                    action.mutate({
                      path: `/rooms/${id}/reopen`,
                      message: "Registration reopened",
                    })
                  }
                >
                  Reopen for next competition
                </Button>
              ) : (
                <p className="hint">
                  Registration is locked. Open the competition to view progress
                  and results.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <SectionTitle title="Meet your running crew" />
        <ErrorBox error={members.error} />
        {members.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Runner</th>
                  <th>Joined</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="name-cell">
                        <span className="avatar small">{m.full_name[0]}</span>
                        {m.full_name}
                      </span>
                    </td>
                    <td>{new Date(m.joined_at).toLocaleString()}</td>
                    <td>
                      <Badge status="JOINED" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="The first step is an invitation"
            description="Share the room’s invitation code with your runners."
          />
        )}
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={members.data?.length || 0}
        />
      </section>
    </>
  );
}

export function RoutePage({ user }: { user: Profile }) {
  const [offset, setOffset] = useState(0),
    routes = useData<Route[]>(`/routes?offset=${offset}`),
    action = useAction(),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Route | null>(null),
    [gpsMode, setGpsMode] = useState(false),
    [coords, setCoords] = useState<[number, number][]>([]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (gpsMode) return;
    const f = new FormData(e.currentTarget);
    try {
      await action.mutateAsync({
        path: editing ? `/routes/${editing.id}` : "/routes",
        method: editing ? "PATCH" : "POST",
        body: {
          name: f.get("name"),
          description: f.get("description"),
          coordinates: coords,
          tolerance_m: Number(f.get("tolerance")),
        },
        message: "Route version saved",
      });
      setOpen(false);
    } catch {}
  }
  function editor(route: Route | null) {
    setGpsMode(false);
    setEditing(route);
    setCoords(route?.version.coordinates || []);
    action.reset();
    setOpen(true);
  }
  return (
    <>
      <PageHeading
        eyebrow="SET THE COURSE"
        title="Good runs start with a route."
        description="Draw a closed loop or record it with GPS while walking the course."
        action={
          <Button onClick={() => editor(null)}>
            <Plus size={18} />
            Create route
          </Button>
        }
      />
      <ErrorBox error={routes.error} />
      {routes.isPending ? (
        <Loading />
      ) : routes.data?.length ? (
        <div className="cards-grid routes-grid">
          {routes.data.map((r) => (
            <section className="panel route-card" key={r.id}>
              <MapView coordinates={r.version.coordinates} />
              <div className="room-card-body">
                <div className="split">
                  <h2>{r.name}</h2>
                  <Badge status={r.active ? "ACTIVE" : "DISABLED"} />
                </div>
                <p>{r.description || "A closed-loop running route."}</p>
                <div className="room-meta">
                  <span>
                    <RouteIcon size={16} />
                    {km(r.version.length_m)} km
                  </span>
                  <span>±{r.version.tolerance_m} m corridor</span>
                  <span>v{r.version.version}</span>
                </div>
                <div className="button-row">
                  <Button variant="secondary" onClick={() => editor(r)}>
                    Edit as new version
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      action.mutate({
                        path: `/routes/${r.id}/active`,
                        body: { active: !r.active },
                        message: r.active ? "Route disabled" : "Route enabled",
                      })
                    }
                  >
                    {r.active ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Make your mark on the map."
            description="Create a closed-loop route by placing points on the map. The first point becomes the start and finish."
            action={
              <Button onClick={() => editor(null)}>
                <Plus size={16} />
                Draw your first route
              </Button>
            }
          />
        </div>
      )}
      <Pagination
        offset={offset}
        setOffset={setOffset}
        count={routes.data?.length || 0}
      />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Create a new route version" : "Create a route"}
      >
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Route name">
              <input
                name="name"
                defaultValue={editing?.name}
                required
                minLength={2}
                maxLength={120}
                placeholder="Campus loop"
              />
            </Field>
            <Field label="GPS corridor (metres)">
              <input
                name="tolerance"
                type="number"
                defaultValue={editing?.version.tolerance_m || 20}
                min={5}
                max={100}
                required
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              name="description"
              defaultValue={editing?.description}
              placeholder="A lap around the main field"
            />
          </Field>
          <div className="button-row">
            <Button
              type="button"
              variant={gpsMode ? "secondary" : "primary"}
              onClick={() => setGpsMode(false)}
            >
              Draw on map
            </Button>
            <Button
              type="button"
              variant={gpsMode ? "primary" : "secondary"}
              onClick={() => setGpsMode(true)}
            >
              Record with GPS
            </Button>
          </div>
          {gpsMode ? (
            <RouteRecorder
              owner={user.id}
              onUse={(points) => {
                setCoords(points);
                setGpsMode(false);
              }}
            />
          ) : (
            <>
              <MapView editable coordinates={coords} onChange={setCoords} />
              <div className="map-tools">
                <span>
                  {coords.length} points · tap map to add · tap a point to
                  remove
                </span>
                <button
                  type="button"
                  onClick={() => setCoords(coords.slice(0, -1))}
                >
                  Undo point
                </button>
                <button type="button" onClick={() => setCoords([])}>
                  Clear
                </button>
              </div>
              <p className="hint">
                Draw in the direction runners will follow. The loop closes
                automatically. To reposition a point, edit its coordinates
                below. Existing competitions keep their original version.
              </p>
              {coords.length > 0 && (
                <details className="coordinate-editor">
                  <summary>Edit route coordinates</summary>
                  {coords.map((point, i) => (
                    <div className="form-grid" key={i}>
                      <label>
                        Point {i + 1} latitude
                        <input
                          type="number"
                          step="any"
                          value={point[0]}
                          onChange={(e) =>
                            setCoords(
                              coords.map((p, j) =>
                                i === j ? [Number(e.target.value), p[1]] : p,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Longitude
                        <input
                          type="number"
                          step="any"
                          value={point[1]}
                          onChange={(e) =>
                            setCoords(
                              coords.map((p, j) =>
                                i === j ? [p[0], Number(e.target.value)] : p,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
          <ErrorBox error={action.error} />
          <Button
            className="full"
            disabled={gpsMode || coords.length < 4 || action.isPending}
          >
            <Check size={17} />
            Save route version
          </Button>
        </form>
      </Modal>
    </>
  );
}

function CompetitionTable({ rows }: { rows: Competition[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Competition</th>
            <th>Created</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link className="name-cell" to={`/competitions/${c.id}`}>
                  <span className="table-icon">
                    <Trophy size={18} />
                  </span>
                  {c.room_name || "Room competition"}
                </Link>
              </td>
              <td>{date(c.created_at)}</td>
              <td>
                <Badge status={c.status} />
              </td>
              <td>
                <Link
                  to={`/competitions/${c.id}`}
                  aria-label={`Open ${c.room_name}`}
                >
                  <ArrowUpRight size={19} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Competitions() {
  const [offset, setOffset] = useState(0),
    q = useData<Competition[]>(`/competitions?offset=${offset}`, true);
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE FRIENDLY COMPETITION"
        title="The race is on."
        description="Live progress, shared milestones, and results worth celebrating."
      />
      <section className="panel">
        <SectionTitle title="Your competitions" />
        <ErrorBox error={q.error} />
        {q.isPending ? (
          <Loading />
        ) : q.data?.length ? (
          <CompetitionTable rows={q.data} />
        ) : (
          <Empty
            title="Your next challenge is ahead."
            description="Competitions appear once your administrator locks a room’s registration."
          />
        )}
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={q.data?.length || 0}
        />
      </section>
    </>
  );
}

export function CompetitionPage({ user }: { user: Profile }) {
  const { id } = useParams(),
    q = useData<CompetitionDetail>(`/competitions/${id}`, true),
    [offset, setOffset] = useState(0),
    people = useData<Participant[]>(
      `/competitions/${id}/participants?offset=${offset}`,
      true,
    ),
    action = useAction(),
    [target, setTarget] = useState<{ p: Participant; type: string } | null>(
      null,
    );
  useRealtime(id);
  if (q.isPending) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const c = q.data,
    root = user.role === "ROOT";
  return (
    <>
      <Link to={`/rooms/${c.room_id}`} className="back-link">
        ← Back to room
      </Link>
      <PageHeading
        eyebrow={
          c.status === "COMPLETED"
            ? "EVERY EFFORT COUNTS"
            : "TOGETHER ON THE TRACK"
        }
        title={c.room_name}
        description={
          c.status === "COMPLETED"
            ? "The results are in. Here’s how your team did."
            : c.started_at
              ? `Started ${new Date(c.started_at).toLocaleString()}`
              : "The route is set. Waiting for the administrator to start."
        }
        action={<Badge status={c.status} />}
      />
      <ErrorBox error={action.error} />
      {c.status === "FINALIZING" && (
        <div className="info-banner">
          <Clock size={20} />
          <div>
            <strong>Every runner has been resolved.</strong>
            <p>
              Results will publish after the recovery window ends at{" "}
              {new Date(c.finalize_after!).toLocaleTimeString()}. Pending
              requests hold publication.
            </p>
          </div>
        </div>
      )}
      <div className="competition-actions">
        {root && c.status === "LOCKED" && (
          <Button
            onClick={() =>
              action.mutate({
                path: `/competitions/${id}/start`,
                message: "Competition started. Runners can now begin.",
              })
            }
            disabled={action.isPending}
          >
            <Play size={17} />
            Start competition
          </Button>
        )}
        {!root && c.participant && c.status !== "LOCKED" && (
          <Link className="btn primary" to={`/run/${id}`}>
            <Activity size={17} />
            {c.participant.status === "RUNNING"
              ? "Continue your run"
              : c.participant.status === "REGISTERED"
                ? "Go to starting line"
                : "View your run"}
          </Link>
        )}
      </div>
      <div className="detail-grid">
        <section className="panel">
          <SectionTitle
            title="Assigned route"
            aside={<span>{km(c.route.length_m)} km / lap</span>}
          />
          <MapView coordinates={c.route.coordinates} />
        </section>
        <section className="panel competition-summary">
          <div className="eyebrow">THE FORMAT</div>
          <Trophy size={38} />
          <h2>
            Distance meets
            <br />
            determination.
          </h2>
          <ol>
            <li>Most validated laps</li>
            <li>Furthest partial-lap progress</li>
            <li>Shortest active running time</li>
          </ol>
          <p>
            Equal performances share a rank. Withdrawn and disqualified runners
            remain in the record.
          </p>
        </section>
      </div>
      <section className="panel">
        <SectionTitle
          title={
            c.status === "COMPLETED"
              ? "Final leaderboard"
              : "Live participant board"
          }
          aside={
            <span className="muted">
              {c.status === "COMPLETED"
                ? "Published once, preserved always"
                : "Updates every 5 seconds"}
            </span>
          }
        />
        <ErrorBox error={people.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Runner</th>
                <th>Status</th>
                <th>Laps</th>
                <th>Distance</th>
                <th>Active time</th>
                <th>Recoveries</th>
                {root && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {people.data?.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className={p.rank === 1 ? "rank-first" : ""}>
                      {p.rank || "—"}
                    </span>
                  </td>
                  <td>
                    <span className="name-cell">
                      <span className="avatar small">{p.full_name[0]}</span>
                      {p.full_name}
                      {p.user_id === user.id && (
                        <small className="you">YOU</small>
                      )}
                    </span>
                  </td>
                  <td>
                    <Badge status={p.status} />
                  </td>
                  <td>
                    {p.session_id ? (
                      <Link
                        className="text-link"
                        to={`/sessions/${p.session_id}`}
                      >
                        {p.laps} ↗
                      </Link>
                    ) : (
                      p.laps
                    )}
                  </td>
                  <td>{km(p.distance_m)} km</td>
                  <td>{duration(p.active_ms)}</td>
                  <td>{p.recoveries}</td>
                  {root && (
                    <td>
                      {["RUNNING", "FINALIZING"].includes(c.status) &&
                      p.status !== "RECOVERY_PENDING" ? (
                        <div className="button-row">
                          <button
                            className="text-link"
                            onClick={() => setTarget({ p, type: "withdraw" })}
                          >
                            Withdraw
                          </button>
                          <button
                            className="text-link danger-text"
                            onClick={() => setTarget({ p, type: "disqualify" })}
                          >
                            DQ
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={people.data?.length || 0}
        />
      </section>
      <Modal
        open={!!target}
        onOpenChange={() => setTarget(null)}
        title={`${target?.type === "disqualify" ? "Disqualify" : "Withdraw"} ${target?.p.full_name || "runner"}`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            try {
              await action.mutateAsync({
                path: `/competitions/${id}/participants/${target?.p.id}/${target?.type}`,
                body: { reason },
                message: "Participant status updated; history preserved",
              });
              setTarget(null);
            } catch {}
          }}
        >
          <p>
            All completed laps and running history will be preserved. Unuploaded
            points cannot be added after this action.
          </p>
          <Field label="Reason">
            <textarea name="reason" minLength={3} required />
          </Field>
          <ErrorBox error={action.error} />
          <Button variant="danger" disabled={action.isPending}>
            Confirm {target?.type}
          </Button>
        </form>
      </Modal>
    </>
  );
}

export function RunPage({ user }: { user: Profile }) {
  const { id } = useParams(),
    q = useData<CompetitionDetail>(`/competitions/${id}`, true),
    cfg = useData<{ gps_sample_seconds: number; gps_batch_size: number }>(
      "/config",
    ),
    action = useAction(),
    tracker = useTracker(
      user.id,
      q.data?.session || null,
      cfg.data?.gps_sample_seconds || 3,
      cfg.data?.gps_batch_size || 200,
    ),
    [finishOpen, setFinishOpen] = useState(false),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [localError, setLocalError] = useState(""),
    [consent, setConsent] = useState(false),
    [autoStart, setAutoStart] = useState(false);
  const laps = useQuery({
    queryKey: ["laps", q.data?.session?.id],
    queryFn: () => api<Lap[]>(`/sessions/${q.data!.session!.id}/laps`),
    enabled: !!q.data?.session,
    refetchInterval: 5000,
  });
  useRealtime(id);
  useEffect(() => {
    if (autoStart && q.data?.session) {
      setAutoStart(false);
      void tracker.start();
    }
  }, [autoStart, q.data?.session]);
  useEffect(() => {
    if (q.data?.participant?.status !== "RUNNING" && tracker.recording)
      tracker.stop();
  }, [q.data?.participant?.status, tracker.recording]);
  async function start() {
    try {
      await action.mutateAsync({
        path: `/competitions/${id}/sessions/start`,
        body: { location_consent: consent },
      });
      await q.refetch();
      setAutoStart(true);
    } catch {}
  }
  async function stop(finish: boolean) {
    tracker.stop();
    setLocalError("");
    try {
      const last_seq = await tracker.flush();
      await action.mutateAsync({
        path: `/sessions/${q.data?.session?.id}/${finish ? "finish" : "pause"}`,
        body: { last_seq },
        message: finish ? "Run saved. Every lap counts." : "Run paused",
      });
      setFinishOpen(false);
    } catch (e) {
      setLocalError(
        `${e instanceof Error ? e.message : "Could not save"}. Your GPS points remain stored on this device. Retry when connected.`,
      );
    }
  }
  async function resume() {
    try {
      await tracker.flush();
      await action.mutateAsync({
        path: `/sessions/${q.data?.session?.id}/resume`,
      });
      await q.refetch();
      void tracker.start();
    } catch (e) {
      setLocalError(String(e));
    }
  }
  if (q.isPending) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const c = q.data,
    s = c.session,
    p = c.participant;
  return (
    <>
      <Link to={`/competitions/${id}`} className="back-link">
        ← Competition overview
      </Link>
      <PageHeading
        eyebrow="FOCUS ON YOUR NEXT STEP"
        title={c.room_name}
        description="Stay on your assigned route. We’ll keep count."
        action={<Badge status={p?.status || c.status} />}
      />
      <div className="run-status">
        <span className={tracker.recording ? "recording" : ""}>
          <span className="pulse-dot" />
          {tracker.recording
            ? "Recording your run"
            : "Tracking is stopped on this device"}
        </span>
        <span>
          {tracker.online ? <Wifi size={15} /> : <WifiOff size={15} />}{" "}
          {tracker.online ? "Connected" : "Offline · buffering locally"}{" "}
          <span className="dot-separator">·</span> {tracker.buffered} points to
          sync
        </span>
      </div>
      <div className="metrics run-metrics">
        <Metric
          label="Completed laps"
          value={s?.lap_count || 0}
          icon={<Flag size={19} />}
          note={`Current lap ${(s?.lap_count || 0) + 1}`}
        />
        <Metric
          label="Validated distance"
          value={km(s?.distance_m || 0)}
          unit="km"
          icon={<RouteIcon size={19} />}
        />
        <Metric
          label="Active time"
          value={duration(s?.active_ms || 0)}
          icon={<Clock size={19} />}
          note="Excludes recorded pauses and recovery gaps"
        />
        <Metric
          label="GPS accuracy"
          value={tracker.latest ? Math.round(tracker.latest.accuracy_m) : "—"}
          unit="m"
          icon={<Signal size={19} />}
          note={
            tracker.latest
              ? tracker.latest.accuracy_m <= c.route.tolerance_m
                ? "Good signal"
                : "Accuracy is low. Move into open space."
              : "Waiting for your location"
          }
        />
      </div>
      <ErrorBox error={action.error || localError || tracker.error} />
      <div className="run-layout">
        <section className="panel run-map">
          <MapView
            coordinates={c.route.coordinates}
            position={
              tracker.latest
                ? [tracker.latest.latitude, tracker.latest.longitude]
                : undefined
            }
          />
          <div className="map-legend">
            <span>
              <i />
              Assigned route
            </span>
            <span>
              <i className="blue" />
              Your position
            </span>
            <strong>{km(c.route.length_m)} km / lap</strong>
          </div>
        </section>
        <section className="panel run-control">
          {c.started_at && (
            <p className="hint">
              Official elapsed:{" "}
              {duration(Date.now() - new Date(c.started_at).getTime())}
            </p>
          )}
          <div className="eyebrow">YOUR RUN, YOUR RHYTHM</div>
          <h2>
            One step.
            <br />
            One lap.
            <br />
            <em>Keep going.</em>
          </h2>
          <div className="progress-label">
            <span>Current lap progress</span>
            <strong>
              {Math.round(((s?.partial_m || 0) / c.route.length_m) * 100)}%
            </strong>
          </div>
          <p className="hint">
            Start at the dark start/finish marker, follow the route in its
            recorded direction, then cross the start again. A lap counts only
            after the server validates your route coverage and GPS evidence.
            Counts update after GPS batches sync; offline laps appear after
            reconnection.
          </p>
          <div className="progress-track">
            <div
              style={{
                width: `${Math.min(100, ((s?.partial_m || 0) / c.route.length_m) * 100)}%`,
              }}
            />
          </div>
          {p?.status === "REGISTERED" && c.status === "RUNNING" && (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Allow administrator access to my detailed GPS trail (optional).
              </label>
              <Button
                className="full"
                onClick={start}
                disabled={action.isPending}
              >
                <Play size={18} />
                Start my run
              </Button>
            </>
          )}
          {p?.status === "RUNNING" && (
            <>
              <Button
                className="full"
                variant="secondary"
                disabled={action.isPending}
                onClick={() =>
                  tracker.recording ? void stop(false) : void resume()
                }
              >
                {tracker.recording ? (
                  <>
                    <Pause size={17} />
                    Pause run
                  </>
                ) : (
                  <>
                    <Play size={17} />
                    Resume GPS tracking
                  </>
                )}
              </Button>
              <Button
                className="full"
                variant="danger"
                onClick={() => setFinishOpen(true)}
                disabled={action.isPending}
              >
                <Square size={17} />
                Finish run
              </Button>
            </>
          )}
          {p &&
            ["FINISHED", "WITHDRAWN"].includes(p.status) &&
            c.status !== "COMPLETED" && (
              <Button className="full" onClick={() => setRecoveryOpen(true)}>
                <RotateCcw size={17} />
                Request to resume
              </Button>
            )}
          {p?.status === "RECOVERY_PENDING" && (
            <div className="info-banner">
              Your administrator is reviewing your request.
            </div>
          )}
          {c.status === "COMPLETED" && (
            <Link className="btn primary full" to={`/competitions/${id}`}>
              <Trophy size={17} />
              View final results
            </Link>
          )}
          <Button
            variant="ghost"
            onClick={() =>
              tracker
                .flush()
                .then(() =>
                  useNotice.getState().set("Buffered points synchronized"),
                )
                .catch((e) => setLocalError(e.message))
            }
            disabled={!tracker.buffered}
          >
            Sync buffered points
          </Button>
          <p className="hint">
            <ShieldCheck size={15} />
            Keep this browser open and your screen awake. Background GPS is not
            guaranteed. Pause and finish require a connection to save all
            buffered points.
          </p>
        </section>
      </div>
      <section className="panel">
        <SectionTitle
          title="Lap by lap"
          aside={
            s && (
              <Link to={`/sessions/${s.id}`}>
                All laps & GPS history <ArrowUpRight size={15} />
              </Link>
            )
          }
        />
        <ErrorBox error={laps.error} />
        {laps.data?.length ? (
          <div className="lap-list">
            {laps.data.map((l) => (
              <div key={l.id}>
                <span className="lap-number">
                  {l.number.toString().padStart(2, "0")}
                </span>
                <strong>Lap {l.number}</strong>
                <span>{duration(l.active_ms)}</span>
                <Badge status="VALIDATED" />
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Your first lap is out there."
            description="Follow the route in order and return to the starting line. Validated laps will appear here."
          />
        )}
      </section>
      <Modal
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title="Ready to call it a run?"
      >
        <p>
          We’ll synchronize your buffered GPS points and save your validated
          laps. To continue afterward, you’ll need administrator approval before
          results publish.
        </p>
        <ErrorBox error={localError} />
        <div className="button-row">
          <Button variant="secondary" onClick={() => setFinishOpen(false)}>
            Keep running
          </Button>
          <Button
            variant="danger"
            disabled={action.isPending}
            onClick={() => stop(true)}
          >
            Save & finish run
          </Button>
        </div>
      </Modal>
      <Modal
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        title="Request to resume"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            try {
              await action.mutateAsync({
                path: `/competitions/${id}/recovery-requests`,
                body: { reason },
                message: "Recovery request sent",
              });
              setRecoveryOpen(false);
            } catch {}
          }}
        >
          <p>Your completed laps and session history will be preserved.</p>
          <Field label="Tell your administrator what happened">
            <textarea name="reason" minLength={3} required />
          </Field>
          <ErrorBox error={action.error} />
          <Button disabled={action.isPending}>Send request</Button>
        </form>
      </Modal>
    </>
  );
}

export function HistoryPage() {
  const [offset, setOffset] = useState(0),
    q = useData<RunSession[]>(`/sessions?limit=30&offset=${offset}`);
  return (
    <>
      <PageHeading
        eyebrow="LOOK HOW FAR YOU’VE COME"
        title="Every run has a story."
        description="Your running history, preserved lap by lap."
      />
      <section className="panel">
        <SectionTitle title="Run journal" />
        <ErrorBox error={q.error} />
        {q.isPending ? (
          <Loading />
        ) : q.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Date</th>
                  <th>Laps</th>
                  <th>Distance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.room_name}</td>
                    <td>{date(s.created_at)}</td>
                    <td>{s.lap_count}</td>
                    <td>{km(s.distance_m)} km</td>
                    <td>
                      <Badge status={s.status || "SAVED"} />
                    </td>
                    <td>
                      <Link to={`/sessions/${s.id}`}>
                        <ArrowUpRight size={19} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your story starts with one run."
            description="Join a room and complete a run to begin your journal."
            action={
              <Link to="/rooms" className="btn secondary">
                Explore rooms <ArrowRight size={16} />
              </Link>
            }
          />
        )}
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={q.data?.length || 0}
          size={30}
        />
      </section>
    </>
  );
}

export function RecoveryPage({ user }: { user: Profile }) {
  const [offset, setOffset] = useState(0),
    q = useData<Recovery[]>(`/recovery-requests?offset=${offset}`, true),
    action = useAction(),
    [selected, setSelected] = useState<{
      r: Recovery;
      decision: string;
    } | null>(null);
  return (
    <>
      <PageHeading
        eyebrow="A SECOND CHANCE TO FINISH"
        title="Get back on track."
        description={
          user.role === "ROOT"
            ? "Review requests fairly. Every previous lap stays in the record."
            : "Track your requests to resume a finished or withdrawn run."
        }
      />
      <section className="panel">
        <SectionTitle title="Recovery requests" />
        <ErrorBox error={q.error} />
        {q.isPending ? (
          <Loading />
        ) : q.data?.length ? (
          <div className="recovery-list">
            {q.data.map((r) => (
              <div key={r.id} className="recovery-card">
                <div className="split">
                  <div>
                    <h3>{r.full_name}</h3>
                    <Link to={`/competitions/${r.competition_id}`}>
                      {r.room_name} <ArrowUpRight size={13} />
                    </Link>
                  </div>
                  <Badge status={r.status} />
                </div>
                <p>{r.reason}</p>
                {r.decision_reason && (
                  <p className="decision-note">Review: {r.decision_reason}</p>
                )}
                <div className="split">
                  <span className="muted">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  {user.role === "ROOT" && r.status === "PENDING" && (
                    <div className="button-row">
                      <Button
                        variant="secondary"
                        onClick={() => setSelected({ r, decision: "reject" })}
                      >
                        Reject
                      </Button>
                      <Button
                        onClick={() => setSelected({ r, decision: "approve" })}
                      >
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="All clear on the track."
            description="Recovery requests will appear here when a runner asks to resume."
          />
        )}
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={q.data?.length || 0}
        />
      </section>
      <Modal
        open={!!selected}
        onOpenChange={() => setSelected(null)}
        title={`${selected?.decision === "approve" ? "Approve" : "Reject"} recovery request`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            try {
              await action.mutateAsync({
                path: `/admin/recovery-requests/${selected?.r.id}/${selected?.decision}`,
                body: { reason },
                message: "Recovery request reviewed",
              });
              setSelected(null);
            } catch {}
          }}
        >
          <p>
            {selected?.r.full_name} · {selected?.r.room_name}
          </p>
          <Field label="Review note">
            <textarea name="reason" required minLength={3} />
          </Field>
          <ErrorBox error={action.error} />
          <Button disabled={action.isPending}>Confirm decision</Button>
        </form>
      </Modal>
    </>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    q = useData<Profile[]>(
      `/admin/users?search=${encodeURIComponent(search)}&offset=${offset}`,
    ),
    action = useAction();
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE PROGRESS"
        title="Your running community."
        description="Manage runner access. Participation history is always preserved."
      />
      <section className="panel">
        <SectionTitle
          title="Registered runners"
          aside={
            <input
              className="search"
              placeholder="Search runners…"
              aria-label="Search runners"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          }
        />
        <ErrorBox error={q.error || action.error} />
        {q.isPending ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Account</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="name-cell">
                        <span className="avatar small">{p.full_name[0]}</span>
                        {p.full_name}
                      </span>
                    </td>
                    <td>{p.role}</td>
                    <td>
                      <Badge status={p.active ? "ACTIVE" : "BLOCKED"} />
                    </td>
                    <td>
                      {p.role !== "ROOT" && (
                        <Button
                          variant="ghost"
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate({
                              path: `/admin/users/${p.id}`,
                              method: "PATCH",
                              body: { active: !p.active },
                              message: "Account access updated",
                            })
                          }
                        >
                          {p.active ? "Block account" : "Unblock account"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={q.data?.length || 0}
        />
      </section>
    </>
  );
}

export function AuditPage() {
  const [offset, setOffset] = useState(0),
    q = useData<
      {
        id: string;
        action: string;
        actor_id: string | null;
        entity_id: string;
        created_at: string;
        details: Record<string, unknown>;
      }[]
    >(`/admin/audit-logs?offset=${offset}`);
  return (
    <>
      <PageHeading
        eyebrow="TRANSPARENCY AT EVERY STEP"
        title="The record stays clear."
        description="An append-only history of administrative actions and result publication."
      />
      <section className="panel">
        <SectionTitle title="Audit trail" />
        <ErrorBox error={q.error} />
        {q.isPending ? (
          <Loading />
        ) : q.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.action.replaceAll(".", " · ").replaceAll("_", " ")}
                    </td>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td title={a.actor_id || "System"}>
                      {a.actor_id?.slice(0, 8) || "System"}
                    </td>
                    <td>
                      <details>
                        <summary>View record</summary>
                        <pre>
                          {JSON.stringify(
                            { entity: a.entity_id, ...a.details },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="A clean starting point."
            description="Administrative actions will appear here automatically."
          />
        )}
        <Pagination
          offset={offset}
          setOffset={setOffset}
          count={q.data?.length || 0}
        />
      </section>
    </>
  );
}

export function ProfilePage({ user }: { user: Profile }) {
  const action = useAction();
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title="Your profile."
        description="A few details for your running community."
      />
      <section className="panel profile-panel">
        <div className="profile-heading">
          <span className="avatar large">{user.full_name[0]}</span>
          <div>
            <h2>{user.full_name}</h2>
            <Badge status={user.role} />
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate({
              path: "/users/me",
              method: "PATCH",
              body: { full_name: new FormData(e.currentTarget).get("name") },
              message: "Profile updated",
            });
          }}
        >
          <Field label="Full name">
            <input
              name="name"
              defaultValue={user.full_name}
              minLength={2}
              maxLength={120}
              required
            />
          </Field>
          <ErrorBox error={action.error} />
          <Button disabled={action.isPending}>Save changes</Button>
        </form>
        <div className="settings-note">
          <ShieldCheck size={23} />
          <div>
            <h3>Your location, your control.</h3>
            <p>
              Detailed GPS trails are private to you. Administrator access
              requires your consent when you start a run. Completed-lap evidence
              is retained to keep competition results verifiable.
            </p>
          </div>
        </div>
        <div className="settings-note">
          <Signal size={23} />
          <div>
            <h3>Built for the browser.</h3>
            <p>
              Use HTTPS, allow location access, and keep your screen awake while
              running. Points are buffered on this device during connection
              loss. Do not clear site data until everything is synchronized.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
