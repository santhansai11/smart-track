import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button, ErrorBox } from "./components";
import "leaflet/dist/leaflet.css";
const GoogleMapView = lazy(() => import("./GoogleMapView"));
// Shared map renderer for route editing, live running, and paginated GPS evidence.
type Coords = [number, number][];
function Clicker({ onAdd }: { onAdd: (p: [number, number]) => void }) {
  useMapEvents({ click: (e) => onAdd([e.latlng.lat, e.latlng.lng]) });
  return null;
}
function Fit({ coordinates }: { coordinates: Coords }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length > 1)
      map.fitBounds(coordinates, { padding: [35, 35], maxZoom: 18 });
  }, [map, JSON.stringify(coordinates)]);
  return null;
}
function Follow({ position }: { position?: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, 18, { animate: false });
  }, [map, position?.[0], position?.[1]]);
  return null;
}
function JumpTo({ target }: { target?: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target, 18, { animate: false });
  }, [map, target]);
  return null;
}
export default function MapView({
  coordinates = [],
  editable = false,
  onChange,
  position,
  trail = [],
  closed = true,
  followPosition = false,
}: {
  coordinates?: Coords;
  editable?: boolean;
  onChange?: (c: Coords) => void;
  position?: [number, number];
  trail?: Coords;
  closed?: boolean;
  followPosition?: boolean;
}) {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [target, setTarget] = useState<[number, number]>();
  const [locationError, setLocationError] = useState("");
  const [useFallback, setUseFallback] = useState(false);
  const googleEnabled =
    !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() && !useFallback;
  function goToCoordinates() {
    const lat = Number(latitude.trim()),
      lon = Number(longitude.trim());
    if (
      !latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 85 ||
      Math.abs(lon) > 180
    ) {
      setLocationError(
        "Enter a latitude from −85 to 85 and a longitude from −180 to 180 in decimal degrees.",
      );
      return;
    }
    setLocationError("");
    setTarget([lat, lon]);
  }
  return (
    <>
      {editable && (
        <section aria-label="Find route location">
          <div
            className="form-grid"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                goToCoordinates();
              }
            }}
          >
            <label>
              Go to latitude
              <input
                type="text"
                inputMode="decimal"
                placeholder="e.g. 12.9716"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
              />
            </label>
            <label>
              Go to longitude
              <input
                type="text"
                inputMode="decimal"
                placeholder="e.g. 77.5946"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
              />
            </label>
          </div>
          <Button type="button" variant="secondary" onClick={goToCoordinates}>
            Go to coordinates
          </Button>
          <ErrorBox error={locationError} />
          <p className="hint">
            Enter decimal coordinates to centre the map, then click along your
            route. The first route point is the start/finish. Moving the map
            keeps your drawn points.
          </p>
        </section>
      )}
      {googleEnabled ? (
        <Suspense
          fallback={
            <div className="map" role="status">
              Loading Google Maps…
            </div>
          }
        >
          <GoogleMapView
            coordinates={coordinates}
            editable={editable}
            onChange={onChange}
            position={position}
            trail={trail}
            closed={closed}
            followPosition={followPosition}
            target={target}
            onFallback={() => setUseFallback(true)}
          />
        </Suspense>
      ) : (
        <MapContainer
          center={coordinates[0] || [12.9716, 77.5946]}
          zoom={15}
          scrollWheelZoom={editable}
          className="map"
        >
          <TileLayer
            url={
              import.meta.env.VITE_MAP_TILE_URL ||
              "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
            attribution={
              import.meta.env.VITE_MAP_ATTRIBUTION ||
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
          />
          {!editable && !followPosition && <Fit coordinates={coordinates} />}
          {followPosition && <Follow position={position} />}
          {editable && <JumpTo target={target} />}
          {editable && target && (
            <CircleMarker
              center={target}
              radius={7}
              pathOptions={{
                color: "#c87514",
                fillColor: "#ffcb75",
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              <Popup>
                Selected location: {target[0]}, {target[1]}
              </Popup>
            </CircleMarker>
          )}
          <Polyline
            positions={
              closed && coordinates.length > 2
                ? [...coordinates, coordinates[0]]
                : coordinates
            }
            pathOptions={{ color: "#127d64", weight: 5 }}
          />
          {coordinates.map((p, i) => (
            <CircleMarker
              key={i}
              center={p}
              radius={i === 0 ? 8 : editable ? 5 : 0}
              pathOptions={{
                color: "white",
                weight: 2,
                fillColor: i === 0 ? "#102622" : "#127d64",
                fillOpacity: 1,
              }}
            >
              <Popup>
                {i === 0 ? "Start / finish" : `Route point ${i + 1}`}
                {editable && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange?.(coordinates.filter((_, j) => j !== i))
                    }
                  >
                    Remove point
                  </button>
                )}
              </Popup>
            </CircleMarker>
          ))}
          {trail.length > 1 && (
            <Polyline
              positions={trail}
              pathOptions={{ color: "#2b71f3", weight: 3 }}
            />
          )}
          {position && (
            <CircleMarker
              center={position}
              radius={9}
              pathOptions={{
                color: "#fff",
                weight: 3,
                fillColor: "#2b71f3",
                fillOpacity: 1,
              }}
            />
          )}
          {editable && (
            <Clicker onAdd={(p) => onChange?.([...coordinates, p])} />
          )}
        </MapContainer>
      )}
    </>
  );
}
