"use client";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";

export type MapTrack = { coords: [number, number][]; color?: string; weight?: number; opacity?: number; id?: string | number };
export type MapMarker = { lat: number; lon: number; label?: string; kind: "start" | "end" | "current" | "parking" };

// Provider is configurable: any XYZ tile server (OpenStreetMap by default, or Mapbox / Stadia / self-hosted).
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "&copy; OpenStreetMap contributors";
const COLORS = { start: "#16a34a", end: "#dc2626", current: "#2563eb", parking: "#d97706" };

function Fit({ tracks, markers, follow }: { tracks: MapTrack[]; markers: MapMarker[]; follow?: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (follow) { map.setView(follow, Math.max(map.getZoom(), 16), { animate: true }); return; }
    const pts: [number, number][] = [...tracks.flatMap((t) => t.coords), ...markers.map((m) => [m.lat, m.lon] as [number, number])];
    if (pts.length > 1) map.fitBounds(pts as LatLngBoundsExpression, { padding: [28, 28], maxZoom: 17 });
    else if (pts.length === 1) map.setView(pts[0], 16);
  }, [map, tracks, markers, follow]);
  return null;
}

export default function RideMapInner({ tracks, markers, follow, height }: { tracks: MapTrack[]; markers: MapMarker[]; follow?: [number, number] | null; height: number | string }) {
  const center: LatLngExpression = follow ?? markers[0] ? [markers[0].lat, markers[0].lon] : tracks[0]?.coords[0] ?? [20.59, 78.96];
  return (
    <MapContainer center={center} zoom={follow ? 16 : 5} style={{ height, width: "100%", borderRadius: "0.75rem" }} scrollWheelZoom>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
      {tracks.map((t, i) => t.coords.length > 1 && (
        <Polyline key={t.id ?? i} positions={t.coords} pathOptions={{ color: t.color ?? "#2563eb", weight: t.weight ?? 5, opacity: t.opacity ?? 0.9 }} />
      ))}
      {markers.map((m, i) => (
        <CircleMarker key={i} center={[m.lat, m.lon]} radius={m.kind === "current" ? 9 : 8}
          pathOptions={{ color: "#fff", weight: 3, fillColor: COLORS[m.kind], fillOpacity: 1 }}>
          {m.label && <Tooltip direction="top" offset={[0, -6]}>{m.label}</Tooltip>}
        </CircleMarker>
      ))}
      <Fit tracks={tracks} markers={markers} follow={follow} />
    </MapContainer>
  );
}
