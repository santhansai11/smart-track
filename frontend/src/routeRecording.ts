export type RouteFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};
export type Coordinate = [number, number];
export const MAX_ROUTE_POINTS = 500;
export function metres(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) *
      Math.cos(b[0] * rad) *
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const coordinate = (p: RouteFix): Coordinate => [
  p.latitude,
  p.longitude,
];
export function validFix(p: RouteFix) {
  return (
    [p.latitude, p.longitude, p.accuracy, p.timestamp].every(Number.isFinite) &&
    Math.abs(p.latitude) <= 85 &&
    Math.abs(p.longitude) <= 180 &&
    p.accuracy >= 0 &&
    p.accuracy <= 20 &&
    p.timestamp > 0
  );
}
export function acceptRouteFix(
  points: RouteFix[],
  fix: RouteFix,
  now = Date.now(),
): string {
  if (!validFix(fix))
    return "Waiting for GPS accuracy of 20 metres or better. Move into open space.";
  if (now - fix.timestamp > 15000 || fix.timestamp > now + 1000)
    return "Waiting for a fresh GPS fix.";
  if (points.length >= MAX_ROUTE_POINTS)
    return "Route limit reached: 500 points. Stop and review your route.";
  const prev = points.at(-1);
  if (!prev) return "";
  const seconds = (fix.timestamp - prev.timestamp) / 1000;
  if (seconds < 3) return "Sampling about every 3 seconds.";
  const distance = metres(coordinate(prev), coordinate(fix));
  if (seconds > 30 && distance > 20)
    return "GPS gap: return within 20 metres of the last recorded point to continue this route.";
  if (distance / seconds > 9)
    return "GPS jump ignored. Walk or run along the route.";
  if (distance < 3)
    return "Waiting for movement; stationary points are not added.";
  return "";
}
export function recordedRoute(points: RouteFix[]): Coordinate[] {
  const coords = points.map(coordinate);
  while (coords.length > 1 && metres(coords[0], coords.at(-1)!) < 2)
    coords.pop();
  return coords;
}
export function closureGap(points: RouteFix[]) {
  return points.length > 1
    ? metres(coordinate(points[0]), coordinate(points.at(-1)!))
    : Infinity;
}
