import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { enqueue, pending, acknowledge, countPending } from "./buffer";
const point = {
  captured_at: "2026-10-30T01:00:00Z",
  latitude: 12,
  longitude: 77,
  accuracy_m: 5,
  speed_mps: null,
  heading: null,
};
describe("durable GPS buffer", () => {
  it("allocates unique ordered sequences atomically, retaining unacknowledged data", async () => {
    await Promise.all(
      Array.from({ length: 100 }, () => enqueue("runner", "session", 0, point)),
    );
    const rows = await pending("runner", "session");
    expect(rows.map((p) => p.seq)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    await acknowledge("runner", "session", 60);
    expect(await countPending("runner", "session")).toBe(40);
    expect((await enqueue("runner", "session", 60, point)).seq).toBe(101);
  });
  it("isolates accounts and sessions on shared devices", async () => {
    await enqueue("second", "session", 0, point);
    expect((await pending("second", "session")).length).toBe(1);
    await acknowledge("runner", "session", 1000);
    expect(await countPending("second", "session")).toBe(1);
  });
  it("continues after a known server acknowledgement on a new device", async () => {
    expect((await enqueue("new", "existing", 500, point)).seq).toBe(501);
  });
});
