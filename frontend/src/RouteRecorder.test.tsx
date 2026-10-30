// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import RouteRecorder from "./RouteRecorder";
vi.mock("./MapView", () => ({ default: () => <div>GPS map</div> }));
let success: PositionCallback;
let failure: PositionErrorCallback;
const clearWatch = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok, fail) => {
        success = ok;
        failure = fail;
        return 8;
      }),
      clearWatch,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("records a loop, persists offline and only uses it after stopping", () => {
  const onUse = vi.fn();
  const now = vi.spyOn(Date, "now");
  render(<RouteRecorder owner="one" onUse={onUse} />);
  fireEvent.click(screen.getByRole("button", { name: "Start GPS recording" }));
  for (let i = 0; i <= 48; i++) {
    const timestamp = 100000 + i * 3000;
    now.mockReturnValue(timestamp);
    act(() =>
      success({
        timestamp,
        coords: {
          latitude: 12 + 0.0006 * Math.cos((i * Math.PI) / 24),
          longitude: 77 + 0.0006 * Math.sin((i * Math.PI) / 24),
          accuracy: 5,
        },
      } as GeolocationPosition),
    );
  }
  expect(
    JSON.parse(localStorage.getItem("smarttrack:route-draft:one")!),
  ).toHaveLength(49);
  const use = screen.getByRole("button", { name: "Use recorded route" });
  expect(use.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  expect(clearWatch).toHaveBeenCalledWith(8);
  expect(use.hasAttribute("disabled")).toBe(false);
  fireEvent.click(use);
  expect(onUse.mock.calls[0][0]).toHaveLength(48);
});
it("restores only this owner's draft and stops watching on close", () => {
  localStorage.setItem(
    "smarttrack:route-draft:one",
    JSON.stringify([
      { latitude: 12, longitude: 77, accuracy: 5, timestamp: 100000 },
    ]),
  );
  const first = render(<RouteRecorder owner="one" onUse={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume GPS recording" }));
  first.unmount();
  expect(clearWatch).toHaveBeenCalledWith(8);
  render(<RouteRecorder owner="two" onUse={() => {}} />);
  expect(
    screen.getByRole("button", { name: "Start GPS recording" }),
  ).toBeTruthy();
});
it("handles denied location and stops without uploading", () => {
  const onUse = vi.fn();
  render(<RouteRecorder owner="one" onUse={onUse} />);
  fireEvent.click(screen.getByRole("button", { name: "Start GPS recording" }));
  act(() => failure({ code: 1 } as GeolocationPositionError));
  expect(screen.getByText(/Location permission was denied/)).toBeTruthy();
  expect(clearWatch).toHaveBeenCalledWith(8);
  expect(onUse).not.toHaveBeenCalled();
});
