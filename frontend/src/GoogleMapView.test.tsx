// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GoogleMapView from "./GoogleMapView";
const sdk = vi.hoisted(() => ({ load: vi.fn(), options: vi.fn() }));
vi.mock("@googlemaps/js-api-loader", () => ({
  importLibrary: sdk.load,
  setOptions: sdk.options,
}));
const maps: FakeMap[] = [];
const lines: FakeOverlay[] = [];
class FakeMap {
  callbacks: Record<string, (event: unknown) => void> = {};
  setCenter = vi.fn();
  setZoom = vi.fn();
  setOptions = vi.fn();
  fitBounds = vi.fn();
  getZoom = () => 17;
  constructor() {
    maps.push(this);
  }
  addListener(name: string, callback: (event: unknown) => void) {
    this.callbacks[name] = callback;
    return { remove: vi.fn() };
  }
}
class FakeOverlay {
  setMap = vi.fn();
  addListener = vi.fn();
  constructor(public options: Record<string, unknown>) {
    lines.push(this);
  }
}
class FakeInfoWindow {
  close = vi.fn();
  setContent = vi.fn();
  setPosition = vi.fn();
  open = vi.fn();
}
const clear = vi.fn();
beforeEach(() => {
  maps.length = 0;
  lines.length = 0;
  sdk.load.mockResolvedValue({ Map: FakeMap });
  vi.stubGlobal("google", {
    maps: {
      Polyline: FakeOverlay,
      Circle: FakeOverlay,
      InfoWindow: FakeInfoWindow,
      LatLngBounds: class {
        extend = vi.fn();
      },
      event: {
        clearInstanceListeners: clear,
        addListenerOnce: () => ({ remove: vi.fn() }),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const defaults = {
  coordinates: [
    [12, 77],
    [12.001, 77],
    [12.001, 77.001],
  ] as [number, number][],
  editable: true,
  trail: [],
  closed: true,
  followPosition: false,
  onFallback: vi.fn(),
};
it("draws the closed route, appends map clicks and keeps one map during updates", async () => {
  const onChange = vi.fn();
  const view = render(<GoogleMapView {...defaults} onChange={onChange} />);
  await waitFor(() => expect(lines.length).toBeGreaterThan(0));
  expect(lines[0].options.path).toEqual([
    { lat: 12, lng: 77 },
    { lat: 12.001, lng: 77 },
    { lat: 12.001, lng: 77.001 },
    { lat: 12, lng: 77 },
  ]);
  act(() =>
    maps[0].callbacks.click({
      latLng: { lat: () => 12.002, lng: () => 77.002 },
    }),
  );
  expect(onChange).toHaveBeenCalledWith([
    ...defaults.coordinates,
    [12.002, 77.002],
  ]);
  view.rerender(
    <GoogleMapView
      {...defaults}
      coordinates={[[13, 78]]}
      target={[13, 78]}
      onChange={onChange}
    />,
  );
  expect(maps).toHaveLength(1);
  expect(maps[0].setCenter).toHaveBeenLastCalledWith({ lat: 13, lng: 78 });
  act(() =>
    maps[0].callbacks.click({
      latLng: { lat: () => 13.001, lng: () => 78.001 },
    }),
  );
  expect(onChange).toHaveBeenLastCalledWith([
    [13, 78],
    [13.001, 78.001],
  ]);
  view.unmount();
  expect(clear).toHaveBeenCalledWith(maps[0]);
  expect(
    lines.every((line) =>
      line.setMap.mock.calls.some((args) => args[0] === null),
    ),
  ).toBe(true);
});
it("follows the runner without allowing edits on a viewing map", async () => {
  const onChange = vi.fn();
  const view = render(
    <GoogleMapView
      {...defaults}
      editable={false}
      followPosition
      position={[12, 77]}
      onChange={onChange}
    />,
  );
  await waitFor(() =>
    expect(maps[0]?.setCenter).toHaveBeenCalledWith({ lat: 12, lng: 77 }),
  );
  view.rerender(
    <GoogleMapView
      {...defaults}
      editable={false}
      followPosition
      position={[12.001, 77]}
      onChange={onChange}
    />,
  );
  expect(maps).toHaveLength(1);
  expect(maps[0].setCenter).toHaveBeenLastCalledWith({ lat: 12.001, lng: 77 });
  act(() =>
    maps[0].callbacks.click({ latLng: { lat: () => 12, lng: () => 77 } }),
  );
  expect(onChange).not.toHaveBeenCalled();
});
it("offers a working fallback when Maps authentication fails", async () => {
  const onFallback = vi.fn();
  render(<GoogleMapView {...defaults} onFallback={onFallback} />);
  await waitFor(() => expect(maps).toHaveLength(1));
  act(() =>
    window.dispatchEvent(new Event("smarttrack:google-maps-auth-failure")),
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Google Maps could not load",
  );
  fireEvent.click(screen.getByRole("button", { name: "Use OpenStreetMap" }));
  expect(onFallback).toHaveBeenCalledOnce();
});
