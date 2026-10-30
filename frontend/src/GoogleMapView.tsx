import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Button } from "./components";

type Coordinate = [number, number];
type Props = {
  coordinates: Coordinate[];
  editable: boolean;
  onChange?: (points: Coordinate[]) => void;
  position?: Coordinate;
  trail: Coordinate[];
  closed: boolean;
  followPosition: boolean;
  target?: Coordinate;
  onFallback: () => void;
};
const latLng = ([lat, lng]: Coordinate) => ({ lat, lng });
let library: Promise<google.maps.MapsLibrary> | undefined;
let authFailed = false;
function loadMaps() {
  if (!library) {
    setOptions({
      key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      v: "quarterly",
    });
    const browser = window as typeof window & { gm_authFailure?: () => void };
    const previous = browser.gm_authFailure;
    browser.gm_authFailure = () => {
      authFailed = true;
      window.dispatchEvent(new Event("smarttrack:google-maps-auth-failure"));
      previous?.();
    };
    library = importLibrary("maps");
  }
  return library;
}

export default function GoogleMapView(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState(authFailed);
  const {
    coordinates,
    editable,
    position,
    trail,
    closed,
    followPosition,
    target,
  } = props;
  useEffect(() => {
    let cancelled = false;
    let instance: google.maps.Map | undefined;
    const node = host.current;
    const failure = () => {
      if (!cancelled) setFailed(true);
    };
    window.addEventListener("smarttrack:google-maps-auth-failure", failure);
    const timer = window.setTimeout(failure, 20000);
    loadMaps()
      .then(({ Map }) => {
        if (cancelled || !node || authFailed) return;
        const current = latest.current;
        instance = new Map(node, {
          center: latLng(current.coordinates[0] || [12.9716, 77.5946]),
          zoom: current.coordinates.length ? 17 : 15,
          mapTypeId: "roadmap",
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: current.editable ? "greedy" : "cooperative",
          maxZoom: 21,
        });
        instance.addListener("click", (event: google.maps.MapMouseEvent) => {
          const current = latest.current;
          if (
            current.editable &&
            event.latLng &&
            Math.abs(event.latLng.lat()) <= 85 &&
            Math.abs(event.latLng.lng()) <= 180 &&
            current.coordinates.length < 500
          ) {
            current.onChange?.([
              ...current.coordinates,
              [event.latLng.lat(), event.latLng.lng()],
            ]);
          }
        });
        window.clearTimeout(timer);
        setFailed(false);
        setMap(instance);
      })
      .catch(failure);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(
        "smarttrack:google-maps-auth-failure",
        failure,
      );
      if (instance) google.maps.event.clearInstanceListeners(instance);
      node?.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    map.setOptions({ gestureHandling: editable ? "greedy" : "cooperative" });
    const line = new google.maps.Polyline({
      map,
      path: (closed && coordinates.length > 2
        ? [...coordinates, coordinates[0]]
        : coordinates
      ).map(latLng),
      strokeColor: "#127d64",
      strokeWeight: 5,
      clickable: false,
    });
    const popup = new google.maps.InfoWindow();
    const markers = coordinates.flatMap((point, i) => {
      if (!editable && i !== 0) return [];
      const circle = new google.maps.Circle({
        map,
        center: latLng(point),
        radius: i === 0 ? 7 : 4,
        strokeColor: "white",
        strokeWeight: 2,
        fillColor: i === 0 ? "#102622" : "#127d64",
        fillOpacity: 1,
        draggable: editable,
      });
      circle.addListener("click", () => {
        const content = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = i === 0 ? "Start / finish" : `Route point ${i + 1}`;
        content.append(label);
        if (editable) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove point";
          remove.addEventListener("click", () => {
            const current = latest.current;
            current.onChange?.(
              current.coordinates.filter((_, index) => index !== i),
            );
            popup.close();
          });
          content.append(remove);
        }
        popup.setContent(content);
        popup.setPosition(latLng(point));
        popup.open({ map });
      });
      if (editable)
        circle.addListener("dragend", () => {
          const centre = circle.getCenter();
          if (
            centre &&
            Math.abs(centre.lat()) <= 85 &&
            Math.abs(centre.lng()) <= 180
          ) {
            const current = latest.current;
            current.onChange?.(
              current.coordinates.map((p, index) =>
                index === i ? [centre.lat(), centre.lng()] : p,
              ),
            );
          } else circle.setCenter(latLng(point));
        });
      return [circle];
    });
    if (!editable && !followPosition && coordinates.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      coordinates.forEach((point) => bounds.extend(latLng(point)));
      map.fitBounds(bounds, 35);
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() || 0) > 18) map.setZoom(18);
      });
      return () => {
        listener.remove();
        line.setMap(null);
        popup.close();
        markers.forEach((marker) => {
          google.maps.event.clearInstanceListeners(marker);
          marker.setMap(null);
        });
      };
    }
    return () => {
      line.setMap(null);
      popup.close();
      markers.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.setMap(null);
      });
    };
  }, [map, JSON.stringify(coordinates), editable, closed, followPosition]);

  useEffect(() => {
    if (!map) return;
    const line = new google.maps.Polyline({
      map,
      path: trail.map(latLng),
      strokeColor: "#2b71f3",
      strokeWeight: 3,
      clickable: false,
    });
    return () => line.setMap(null);
  }, [map, JSON.stringify(trail)]);
  useEffect(() => {
    if (!map || !position) return;
    const marker = new google.maps.Circle({
      map,
      center: latLng(position),
      radius: 7,
      fillColor: "#2b71f3",
      fillOpacity: 1,
      strokeColor: "white",
      strokeWeight: 3,
      clickable: false,
    });
    if (followPosition) {
      map.setCenter(latLng(position));
      map.setZoom(18);
    }
    return () => marker.setMap(null);
  }, [map, position?.[0], position?.[1], followPosition]);
  useEffect(() => {
    if (!map || !target || !editable) return;
    map.setCenter(latLng(target));
    map.setZoom(18);
    const marker = new google.maps.Circle({
      map,
      center: latLng(target),
      radius: 5,
      fillColor: "#ffcb75",
      fillOpacity: 0.8,
      strokeColor: "#c87514",
      strokeWeight: 2,
      clickable: false,
    });
    return () => marker.setMap(null);
  }, [map, target, editable]);
  return (
    <>
      {failed && (
        <div role="alert" className="setup-note">
          <p>
            Google Maps could not load. Check the connection, or ask the
            administrator to check the Maps API key, allowed websites and
            billing.
          </p>
          <Button type="button" variant="secondary" onClick={props.onFallback}>
            Use OpenStreetMap
          </Button>
        </div>
      )}
      {!map && !failed && <p role="status">Loading Google Maps…</p>}
      <div
        ref={host}
        className="map"
        aria-label="Google Maps route view"
        hidden={failed}
      />
    </>
  );
}
