import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Clock,
  Flag,
  Route as RouteIcon,
  ShieldCheck,
} from "lucide-react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { api, duration, km, date } from "./lib";
import {
  PageHeading,
  Button,
  SectionTitle,
  Metric,
  Empty,
  ErrorBox,
  Loading,
  Badge,
} from "./components";
import MapView from "./MapView";
import type { RunSession, RouteVersion, Point, Lap } from "./types";
export function AnalyticsPage() {
  const [period, setPeriod] = useState("week");
  const q = useQuery({
    queryKey: ["analytics", period],
    queryFn: () =>
      api<{
        days: { day: string; runs: number; distance_m: number; laps: number }[];
        fastest_lap_ms: number | null;
      }>(`/analytics?period=${period}`),
  });
  const totals = q.data?.days.reduce(
    (a, d) => ({
      runs: a.runs + d.runs,
      distance_m: a.distance_m + d.distance_m,
      laps: a.laps + d.laps,
    }),
    { runs: 0, distance_m: 0, laps: 0 },
  );
  return (
    <>
      <PageHeading
        eyebrow="SMALL STEPS, BIG PICTURE"
        title="See your progress."
        description="Validated performance, across your week or month."
        action={
          <div className="button-row">
            <Button
              variant={period === "week" ? "primary" : "secondary"}
              onClick={() => setPeriod("week")}
            >
              Last 7 days
            </Button>
            <Button
              variant={period === "month" ? "primary" : "secondary"}
              onClick={() => setPeriod("month")}
            >
              Last 30 days
            </Button>
          </div>
        }
      />
      <ErrorBox error={q.error} />
      <div className="metrics">
        <Metric
          label="Runs"
          value={totals?.runs || 0}
          icon={<Activity size={18} />}
        />
        <Metric
          label="Distance"
          value={km(totals?.distance_m || 0)}
          unit="km"
          icon={<RouteIcon size={18} />}
        />
        <Metric
          label="Valid laps"
          value={totals?.laps || 0}
          icon={<Flag size={18} />}
        />
        <Metric
          label="Fastest lap"
          value={q.data?.fastest_lap_ms ? duration(q.data.fastest_lap_ms) : "—"}
          icon={<Clock size={18} />}
        />
      </div>
      <section className="panel">
        <SectionTitle title="Daily distance" />
        {q.data?.days.length ? (
          <div style={{ height: 300, padding: 20 }}>
            <ResponsiveContainer>
              <BarChart
                data={q.data.days.map((d) => ({
                  ...d,
                  label: date(d.day),
                  km: Number(km(d.distance_m)),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="km" fill="#82a65e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty
            title="Your progress will grow here."
            description="Start a run to see validated distance and laps in your activity chart."
          />
        )}
      </section>
    </>
  );
}
type Detail = RunSession & {
  full_name: string;
  route: RouteVersion;
  can_view_gps: boolean;
  status: string;
  competition_id: string;
};
export function SessionPage() {
  const { id } = useParams(),
    [after, setAfter] = useState(0),
    [lapAfter, setLapAfter] = useState(0),
    [history, setHistory] = useState<number[]>([]),
    [lapHistory, setLapHistory] = useState<number[]>([]);
  const q = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<Detail>(`/sessions/${id}`),
  });
  const gps = useQuery({
    queryKey: ["gps", id, after],
    queryFn: () =>
      api<(Point & { validation: string })[]>(
        `/sessions/${id}/gps?after=${after}&limit=500`,
      ),
    enabled: !!q.data?.can_view_gps,
  });
  const laps = useQuery({
    queryKey: ["session-laps", id, lapAfter],
    queryFn: () =>
      api<Lap[]>(`/sessions/${id}/laps?after=${lapAfter}&limit=50`),
  });
  if (q.isPending) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  return (
    <>
      <Link className="back-link" to={`/competitions/${s.competition_id}`}>
        ← Competition
      </Link>
      <PageHeading
        eyebrow="THE FULL RUNNING RECORD"
        title={`${s.full_name}’s run`}
        description={`Started ${new Date(s.created_at).toLocaleString()}`}
        action={<Badge status={s.status} />}
      />
      <div className="metrics">
        <Metric
          label="Valid laps"
          value={s.lap_count}
          icon={<Flag size={18} />}
        />
        <Metric
          label="Distance"
          value={km(s.distance_m)}
          unit="km"
          icon={<RouteIcon size={18} />}
        />
        <Metric
          label="Active duration"
          value={duration(s.active_ms)}
          icon={<Clock size={18} />}
        />
        <Metric
          label="Accepted sequence"
          value={s.last_seq}
          icon={<ShieldCheck size={18} />}
          note="Monotonic GPS upload acknowledgement"
        />
      </div>
      <section className="panel">
        <SectionTitle
          title="Route & GPS evidence"
          aside={<span className="muted">500 points per page</span>}
        />
        <MapView
          coordinates={s.route.coordinates}
          trail={gps.data
            ?.filter((p) => p.validation === "VALID")
            .map((p) => [p.latitude, p.longitude])}
        />
        {!s.can_view_gps ? (
          <p style={{ padding: 20 }}>
            The runner has not consented to sharing their detailed GPS trail.
          </p>
        ) : (
          <>
            <ErrorBox error={gps.error} />
            <div className="pagination">
              <Button
                variant="ghost"
                disabled={!history.length}
                onClick={() => {
                  setAfter(history[history.length - 1]);
                  setHistory(history.slice(0, -1));
                }}
              >
                Previous points
              </Button>
              <span>
                {gps.data?.length || 0} samples ·{" "}
                {
                  (gps.data || []).filter((p) => p.validation !== "VALID")
                    .length
                }{" "}
                filtered
              </span>
              <Button
                variant="ghost"
                disabled={(gps.data?.length || 0) < 500}
                onClick={() => {
                  setHistory([...history, after]);
                  setAfter(gps.data![gps.data!.length - 1].seq);
                }}
              >
                Next points
              </Button>
            </div>
          </>
        )}
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <SectionTitle title="Validated laps" />
        <ErrorBox error={laps.error} />
        <div className="lap-list">
          {laps.data?.map((l) => (
            <div key={l.id}>
              <span className="lap-number">{l.number}</span>
              <strong>Lap {l.number}</strong>
              <span>{duration(l.active_ms)}</span>
              <Badge status="VALIDATED" />
            </div>
          ))}
        </div>
        <div className="pagination">
          <Button
            variant="ghost"
            disabled={!lapHistory.length}
            onClick={() => {
              setLapAfter(lapHistory[lapHistory.length - 1]);
              setLapHistory(lapHistory.slice(0, -1));
            }}
          >
            Previous laps
          </Button>
          <Button
            variant="ghost"
            disabled={(laps.data?.length || 0) < 50}
            onClick={() => {
              setLapHistory([...lapHistory, lapAfter]);
              setLapAfter(laps.data![laps.data!.length - 1].number);
            }}
          >
            Next laps
          </Button>
        </div>
      </section>
    </>
  );
}
