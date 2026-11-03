"use client";
import dynamic from "next/dynamic";
import { Loading } from "@/components/common/states";
import type { MapMarker, MapTrack } from "./RideMapInner";

export type { MapMarker, MapTrack };

// Leaflet touches `window`, so it is only ever loaded in the browser.
const Inner = dynamic(() => import("./RideMapInner"), { ssr: false, loading: () => <div className="grid h-full place-items-center"><Loading label="Loading map…" /></div> });

/** Interactive route map (OpenStreetMap tiles by default; set NEXT_PUBLIC_MAP_TILE_URL to change provider). */
export function RideMap({ tracks = [], markers = [], follow, height = 360 }: { tracks?: MapTrack[]; markers?: MapMarker[]; follow?: [number, number] | null; height?: number | string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-muted" style={{ height }}>
      <Inner tracks={tracks} markers={markers} follow={follow} height="100%" />
    </div>
  );
}
