"""Deterministic incremental closed-loop validation. No frontend totals accepted.

Full laps require ordered eighth-route checkpoint crossings, >=90% coverage,
correct direction, speed/corridor checks, and a finish-line wrap. Gaps >30s
break evidence; reconnect uploads can still span hours if samples are continuous.
"""

import math
from datetime import datetime

R = 6371000


def distance(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlon = lat2 - lat1, math.radians(b[1] - a[1])
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.asin(min(1, math.sqrt(h)))


def route_length(coords):
    return sum(distance(a, b) for a, b in zip(coords, coords[1:] + coords[:1]))


class Matcher:
    def __init__(self, coords, tolerance=20):
        self.coords = coords
        self.tolerance = tolerance
        self.length = route_length(coords)
        lat = math.radians(coords[0][0])
        self.kx = R * math.cos(lat) * math.pi / 180
        self.ky = R * math.pi / 180
        self.origin = coords[0]
        self.xy = [self.project(p) for p in coords]
        self.lengths = [distance(a, b) for a, b in zip(coords, coords[1:] + coords[:1])]

    def project(self, p):
        return ((p[1] - self.origin[1]) * self.kx, (p[0] - self.origin[0]) * self.ky)

    def match(self, p):
        x, y = self.project(p)
        best = (float("inf"), 0)
        offset = 0
        for i, (a, b) in enumerate(zip(self.xy, self.xy[1:] + self.xy[:1])):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = max(
                0,
                min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy or 1)),
            )
            d = math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
            if d < best[0]:
                best = (d, offset + t * self.lengths[i])
            offset += self.lengths[i]
        return best

    def step(self, state, p):
        state = dict(state)
        t = p.captured_at.timestamp()
        xy = [p.latitude, p.longitude]
        if state.get("seen") is not None and t <= state["seen"]:
            return state, "TIME_ORDER", 0, None
        state["seen"] = t
        if p.accuracy_m > min(50, self.tolerance * 2):
            return state, "ACCURACY", 0, None
        corridor, pos = self.match(xy)
        if corridor > self.tolerance:
            state.pop("lap", None)
            return state, "OFF_ROUTE", 0, None
        prev = state.get("last")
        if state.pop("resume", False) and prev:
            # A pause is not route coverage. Resume only beside the last validated
            # point; otherwise retain the earned partial progress until returning.
            if distance(prev["xy"], xy) > self.tolerance:
                state["resume"] = True
                return state, "RESUME_POSITION", 0, None
            state["last"] = {"xy": xy, "t": t, "pos": pos, "seq": p.seq}
            return state, "VALID", 0, None
        if prev:
            dt = t - prev["t"]
            if dt <= 0:
                return state, "TIME_ORDER", 0, None
            if distance(prev["xy"], xy) / dt > 9:
                state.pop("lap", None)
                return state, "SPEED", 0, None
            if dt > 30:
                state.pop("lap", None)
                prev = None
        state["last"] = {"xy": xy, "t": t, "pos": pos, "seq": p.seq}
        near_start = min(pos, self.length - pos) <= min(
            self.tolerance, self.length * 0.06
        )
        lap = state.get("lap")
        if not lap:
            if near_start:
                state["lap"] = {
                    "seq": p.seq,
                    "t": t,
                    "coverage": 0.0,
                    "checkpoint": 1,
                    "pos": pos,
                }
            return state, "VALID", 0, None
        lap = dict(lap)
        wrapped = pos < self.length * 0.1 and lap["pos"] > self.length * 0.8
        delta = pos - lap["pos"]
        if delta < -self.length * 0.7:
            delta += self.length
        elif delta > self.length * 0.7:
            delta -= self.length
        if delta < -max(5, p.accuracy_m * 0.5):
            state.pop("lap", None)
            return state, "DIRECTION", 0, None
        if prev and delta > 9 * (t - prev["t"]) + 5:
            state.pop("lap", None)
            return state, "SHORTCUT", 0, None
        if delta > self.length * 0.2:
            state.pop("lap", None)
            return state, "CHECKPOINT_GAP", 0, None
        # Keep the high-water projection so stationary jitter cannot add distance.
        advance = max(0, delta)
        if advance:
            lap["pos"] = pos
            lap["coverage"] += advance
        while lap["checkpoint"] <= 7 and pos >= lap["checkpoint"] * self.length / 8:
            # Require a real crossing near the next checkpoint, not arbitrary arrival.
            if pos - lap["checkpoint"] * self.length / 8 > self.length * 0.2:
                state.pop("lap", None)
                return state, "CHECKPOINT_GAP", 0, None
            lap["checkpoint"] += 1
        completed = None
        if (
            wrapped
            and near_start
            and lap["checkpoint"] == 8
            and lap["coverage"] >= self.length * 0.90
            and t - lap["t"] >= self.length / 9
        ):
            completed = {
                "from_seq": lap["seq"],
                "to_seq": p.seq,
                "start": lap["t"],
                "end": t,
            }
            lap = {"seq": p.seq, "t": t, "coverage": 0.0, "checkpoint": 1, "pos": pos}
        state["lap"] = lap
        return state, "VALID", advance, completed
