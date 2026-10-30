import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "./lib";
import { enqueue, pending, acknowledge, countPending } from "./buffer";
import type { Point, RunSession } from "./types";

export function useTracker(
  owner: string,
  session: RunSession | null,
  sampleSeconds = 3,
  batchSize = 200,
) {
  const [recording, setRecording] = useState(false),
    [error, setError] = useState(""),
    [buffered, setBuffered] = useState(0),
    [latest, setLatest] = useState<Point | null>(null),
    [online, setOnline] = useState(navigator.onLine);
  const watch = useRef<number | null>(null),
    lastTime = useRef(0),
    acknowledged = useRef(0),
    writes = useRef(Promise.resolve()),
    upload = useRef<Promise<number> | null>(null),
    release = useRef<(() => void) | null>(null),
    wake = useRef<WakeLockSentinel | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setRecording(false);
    release.current?.();
    release.current = null;
    void wake.current?.release();
    wake.current = null;
  }, []);
  const flush = useCallback(async () => {
    if (upload.current) return upload.current;
    const s = sessionRef.current;
    if (!s) return 0;
    upload.current = (async () => {
      await writes.current;
      let ack = Math.max(s.last_seq, acknowledged.current);
      while (true) {
        const points = await pending(
          owner,
          s.id,
          Math.max(1, Math.min(300, batchSize)),
        );
        if (!points.length) break;
        const result = await api<{ ack_seq: number }>(
          `/sessions/${s.id}/gps/batch`,
          "POST",
          { points },
        );
        await acknowledge(owner, s.id, result.ack_seq);
        ack = Math.max(ack, result.ack_seq);
        acknowledged.current = ack;
      }
      setBuffered(await countPending(owner, s.id));
      setError((previous) =>
        previous.startsWith("Sync pending:") ? "" : previous,
      );
      return ack;
    })().finally(() => {
      upload.current = null;
    });
    return upload.current;
  }, [owner, batchSize]);
  const start = useCallback(async () => {
    if (watch.current !== null) return;
    if (!sessionRef.current) return;
    if (!navigator.geolocation) {
      setError("This browser does not support location tracking.");
      return;
    }
    if (!navigator.locks) {
      setError(
        "Use a current browser with Web Locks support for safe tracking.",
      );
      return;
    }
    const s = sessionRef.current;
    void navigator.storage?.persist();
    void navigator.locks.request(
      `smarttrack:${owner}:${s.id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setError("This run is already recording in another tab.");
          return;
        }
        setError("");
        setRecording(true);
        if ("wakeLock" in navigator)
          navigator.wakeLock
            .request("screen")
            .then((w) => {
              wake.current = w;
            })
            .catch(() => {});
        watch.current = navigator.geolocation.watchPosition(
          (pos) => {
            if (pos.timestamp - lastTime.current < sampleSeconds * 1000) return;
            lastTime.current = pos.timestamp;
            writes.current = writes.current
              .then(async () => {
                const current = sessionRef.current;
                if (!current) return;
                const p = await enqueue(owner, current.id, current.last_seq, {
                  captured_at: new Date(pos.timestamp).toISOString(),
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy_m: pos.coords.accuracy,
                  speed_mps:
                    pos.coords.speed !== null && pos.coords.speed >= 0
                      ? pos.coords.speed
                      : null,
                  heading:
                    pos.coords.heading !== null &&
                    Number.isFinite(pos.coords.heading)
                      ? pos.coords.heading
                      : null,
                });
                setLatest(p);
                setBuffered(await countPending(owner, current.id));
              })
              .catch(() => {
                setError(
                  "Local storage failed. Tracking stopped to prevent losing GPS data.",
                );
                stop();
              });
          },
          (err) => {
            setError(
              err.code === 1
                ? "Location permission denied. Enable location in browser settings."
                : "GPS signal unavailable. Keep your device outside with the screen awake.",
            );
            if (err.code === 1) stop();
          },
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
        );
        await new Promise<void>((resolve) => {
          release.current = resolve;
        });
      },
    );
  }, [owner, sampleSeconds, stop]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (session) void countPending(owner, session.id).then(setBuffered);
    const timer = setInterval(() => {
      if (navigator.onLine)
        void flush().catch((e) =>
          setError(`Sync pending: ${e.message}. Points remain on this device.`),
        );
    }, 15000);
    return () => clearInterval(timer);
  }, [owner, session?.id, flush]);
  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);
  return { recording, error, buffered, latest, online, start, stop, flush };
}
