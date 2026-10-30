import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorBox } from "./components";
import MapView from "./MapView";
import {
  acceptRouteFix,
  closureGap,
  coordinate,
  MAX_ROUTE_POINTS,
  metres,
  recordedRoute,
  validFix,
} from "./routeRecording";
import type { Coordinate, RouteFix } from "./routeRecording";

export default function RouteRecorder({
  owner,
  onUse,
}: {
  owner: string;
  onUse: (points: Coordinate[]) => void;
}) {
  const key = `smarttrack:route-draft:${owner}`;
  const [points, setPoints] = useState<RouteFix[]>(() => {
    try {
      const draft: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(draft) &&
        draft.length <= MAX_ROUTE_POINTS &&
        draft.every((p) => p && validFix(p))
        ? draft
        : [];
    } catch {
      return [];
    }
  });
  const [recording, setRecording] = useState(false);
  const [latest, setLatest] = useState<RouteFix | null>(null);
  const [status, setStatus] = useState(
    "Start at your intended start/finish line, then walk one complete loop.",
  );
  const [error, setError] = useState("");
  const watch = useRef<number | null>(null);
  const active = useRef(false);
  const current = useRef(points);
  const stop = useCallback(() => {
    active.current = false;
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setRecording(false);
  }, []);
  useEffect(() => {
    // A hidden page may stop receiving positions. Require explicit resume.
    const visibility = () => {
      if (document.hidden && active.current) {
        stop();
        setStatus(
          "Recording paused while the app was hidden. Return to the last point, then resume.",
        );
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [stop]);
  function start() {
    if (active.current) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(
        "Location requires HTTPS (or localhost on this computer) and a browser with GPS support.",
      );
      return;
    }
    setError("");
    setStatus("Waiting for location permission and an accurate GPS fix…");
    active.current = true;
    setRecording(true);
    try {
      watch.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (!active.current) return;
          const fix: RouteFix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          };
          setLatest(fix);
          const reason = acceptRouteFix(current.current, fix);
          if (reason) {
            setStatus(reason);
            return;
          }
          const next = [...current.current, fix];
          current.current = next;
          setPoints(next);
          try {
            localStorage.setItem(key, JSON.stringify(next));
          } catch {
            stop();
            setError(
              "Device storage is full or unavailable. Recording stopped; keep this page open to review the points already captured.",
            );
            return;
          }
          setStatus(
            "Recording your route. Follow the direction runners should use.",
          );
          if (next.length === MAX_ROUTE_POINTS) {
            stop();
            setStatus(
              "Reached the 500-point route limit. Review the draft or discard it and record a shorter loop.",
            );
          }
        },
        (err) => {
          if (!active.current) return;
          if (err.code === 1) {
            stop();
            setError(
              "Location permission was denied. Allow location in your browser settings, then try again.",
            );
          } else
            setStatus(
              "GPS signal unavailable. Move outdoors and keep this screen open; waiting for a new fix.",
            );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      stop();
      setError(
        "Could not start GPS. Check location permissions and try again.",
      );
    }
  }
  const coords = recordedRoute(points);
  const loopLength = coords.reduce(
    (sum, point, i) => sum + metres(point, coords[(i + 1) % coords.length]),
    0,
  );
  const gap = closureGap(points);
  const distance = points
    .slice(1)
    .reduce(
      (sum, p, i) => sum + metres(coordinate(points[i]), coordinate(p)),
      0,
    );
  return (
    <section aria-label="Record a route with GPS">
      <p className="hint">
        Stand at the start line, allow location access, and walk or run one full
        loop. Keep this screen visible. Your draft is saved on this device until
        you discard it; nothing is uploaded until you save the route.
      </p>
      <div className="button-row">
        <Button
          type="button"
          onClick={recording ? stop : start}
          disabled={!recording && points.length >= MAX_ROUTE_POINTS}
        >
          {recording
            ? "Stop recording"
            : points.length
              ? "Resume GPS recording"
              : "Start GPS recording"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={recording || !points.length}
          onClick={() => {
            try {
              localStorage.removeItem(key);
            } catch {
              setError(
                "Could not clear the saved draft. Check browser storage settings.",
              );
              return;
            }
            current.current = [];
            setPoints([]);
            setLatest(null);
            setError("");
            setStatus("Draft discarded. Start a new loop when ready.");
          }}
        >
          Discard GPS draft
        </Button>
      </div>
      <p role="status">{status}</p>
      <MapView
        coordinates={points.map(coordinate)}
        closed={false}
        position={latest && validFix(latest) ? coordinate(latest) : undefined}
        followPosition={recording}
      />
      <p className="hint">
        {points.length} / 500 points · {(distance / 1000).toFixed(2)} km
        recorded · GPS accuracy{" "}
        {latest ? `±${Math.round(latest.accuracy)} m` : "waiting"} ·{" "}
        {Number.isFinite(gap)
          ? `${Math.round(gap)} m from start`
          : "waiting for movement"}
      </p>
      <ErrorBox error={error} />
      {points.length > 0 && gap > 20 && (
        <p className="hint">
          Return within 20 metres of the start before using this as a
          closed-loop route.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={
          recording || coords.length < 4 || gap > 20 || loopLength < 100
        }
        onClick={() => onUse(coords)}
      >
        Use recorded route
      </Button>
      <p className="hint">
        Record at least 100 metres and 4 points. Stop recording, use the route,
        review its start/finish and direction, then save. The original GPS draft
        remains available on this device.
      </p>
    </section>
  );
}
