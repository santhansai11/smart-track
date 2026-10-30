from datetime import datetime, timedelta, timezone
from app.gps import Matcher
from app.schemas import PointInput
from .test_workflows import COORDS, points


def test_three_complete_loops_count_exactly_three_laps():
    matcher = Matcher(COORDS)
    state = {}
    completed = []
    for point in points(datetime.now(timezone.utc), seconds=3 * 48 * 3):
        state, code, distance, lap = matcher.step(state, point)
        assert code == "VALID"
        if lap:
            completed.append(lap)
    assert len(completed) == 3
    assert all(lap["to_seq"] > lap["from_seq"] for lap in completed)


def test_stationary_runner_never_counts_laps():
    m = Matcher(COORDS)
    s = {}
    start = datetime.now(timezone.utc)
    for i in range(200):
        p = PointInput(
            seq=i + 1,
            captured_at=start + timedelta(seconds=i * 3),
            latitude=COORDS[0][0],
            longitude=COORDS[0][1],
            accuracy_m=5,
        )
        s, code, d, lap = m.step(s, p)
        assert lap is None and d == 0


def test_teleport_and_inaccurate_points():
    m = Matcher(COORDS)
    s = {}
    track = points(datetime.now(timezone.utc), seconds=150)
    s, _, _, _ = m.step(s, track[0])
    s, code, _, lap = m.step(
        s,
        track[1].model_copy(
            update={"latitude": COORDS[24][0], "longitude": COORDS[24][1]}
        ),
    )
    assert code in {"SPEED", "SHORTCUT", "CHECKPOINT_GAP"} and lap is None
    s, code, _, lap = m.step(s, track[2].model_copy(update={"accuracy_m": 100}))
    assert code == "ACCURACY" and lap is None


def test_reverse_direction_not_a_lap():
    m = Matcher(COORDS)
    s = {}
    track = points(datetime.now(timezone.utc), seconds=300)
    for i, p in enumerate(track):
        xy = COORDS[-i % 48]
        s, _, _, lap = m.step(
            s, p.model_copy(update={"latitude": xy[0], "longitude": xy[1]})
        )
        assert lap is None


def test_resume_preserves_partial_until_back_at_last_position():
    m = Matcher(COORDS)
    s = {}
    track = points(datetime.now(timezone.utc), seconds=100)
    for p in track[:15]:
        s, _, _, _ = m.step(s, p)
    coverage = s["lap"]["coverage"]
    s["resume"] = True
    s, code, _, _ = m.step(
        s,
        track[30].model_copy(
            update={"captured_at": track[30].captured_at + timedelta(minutes=5)}
        ),
    )
    assert code == "RESUME_POSITION" and s["lap"]["coverage"] == coverage
    p = track[14].model_copy(
        update={"seq": 100, "captured_at": track[30].captured_at + timedelta(minutes=6)}
    )
    s, code, _, _ = m.step(s, p)
    assert code == "VALID" and s["lap"]["coverage"] == coverage
