import { describe, expect, it } from "vitest";
import { acceptRouteFix, closureGap, recordedRoute } from "./routeRecording";
const fix = { latitude: 12, longitude: 77, accuracy: 5, timestamp: 100000 };
describe("route GPS quality", () => {
  it("rejects inaccurate, stale, non-finite and duplicate readings", () => {
    expect(acceptRouteFix([], { ...fix, accuracy: 80 }, 100000)).toContain(
      "accuracy",
    );
    expect(acceptRouteFix([], fix, 130000)).toContain("fresh");
    expect(acceptRouteFix([], { ...fix, latitude: NaN }, 100000)).not.toBe("");
    expect(acceptRouteFix([fix], fix, 100000)).not.toBe("");
    expect(
      acceptRouteFix([fix], { ...fix, timestamp: 103000 }, 103000),
    ).toContain("movement");
  });
  it("rejects teleports and gaps instead of connecting distant segments", () => {
    expect(
      acceptRouteFix(
        [fix],
        { ...fix, longitude: 78, timestamp: 103000 },
        103000,
      ),
    ).toContain("jump");
    expect(
      acceptRouteFix(
        [fix],
        { ...fix, longitude: 77.001, timestamp: 160000 },
        160000,
      ),
    ).toContain("gap");
    expect(
      acceptRouteFix(
        [fix],
        { ...fix, longitude: 77.0001, timestamp: 160000 },
        160000,
      ),
    ).toBe("");
  });
  it("keeps valid movement and refuses more than the schema permits", () => {
    const next = { ...fix, longitude: 77.0001, timestamp: 103000 };
    expect(acceptRouteFix([fix], next, 103000)).toBe("");
    expect(acceptRouteFix(Array(500).fill(fix), next, 103000)).toContain("500");
  });
  it("removes a duplicate finish vertex without inventing route points", () => {
    const loop = [
      fix,
      { ...fix, longitude: 77.001 },
      { ...fix, latitude: 12.001, longitude: 77.001 },
      { ...fix, latitude: 12.001 },
      fix,
    ];
    expect(closureGap(loop)).toBe(0);
    expect(recordedRoute(loop)).toHaveLength(4);
    expect(closureGap(loop.slice(0, -1))).toBeGreaterThan(100);
  });
});
