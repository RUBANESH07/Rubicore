"use client";
import { AlertTriangle, CloudOff, Crosshair, Info, MapPinned } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/common/states";
import { RideMap } from "@/components/ride/RideMap";
import { DistanceCard, LiveSpeedCard, PauseButton, RideTimer, SignalBadge, StartRideButton, StopRideButton } from "@/components/ride/parts";
import { Badge, Button, Card, Dialog } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useRideTracker } from "@/hooks/useRideTracker";
import { api } from "@/lib/api";
import { Ride, duration, km, kmh } from "@/lib/ride";

function Live() {
  const params = useSearchParams();
  const router = useRouter();
  const prefs = useFetch<{ max_accuracy_m: number; keep_screen_on: boolean }>("/ride-preferences");
  const t = useRideTracker(prefs.data?.max_accuracy_m ?? 50);
  const [preview, setPreview] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const previewId = useRef<number | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const autoStarted = useRef(false);

  // Arriving from "Start a Ride": begin once we know no ride is already running.
  useEffect(() => {
    if (t.ready && params.get("start") === "1" && t.phase === "idle" && !autoStarted.current && prefs.data) {
      autoStarted.current = true;
      t.start(params.get("bike") ? Number(params.get("bike")) : null);
      router.replace("/ride/live");
    }
  }, [t.ready, t.phase, params, prefs.data, router, t]);

  // Optional GPS check before riding. Nothing is recorded or sent anywhere.
  const stopPreview = () => { if (previewId.current != null) navigator.geolocation.clearWatch(previewId.current); previewId.current = null; setPreview(null); };
  const startPreview = () => {
    setPreviewErr("");
    if (!navigator.geolocation) return setPreviewErr("This browser has no GPS support.");
    previewId.current = navigator.geolocation.watchPosition(
      (p) => setPreview({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setPreviewErr(e.code === 1 ? "Location permission denied. Allow it in your browser's site settings." : "GPS position unavailable."),
      { enableHighAccuracy: true, timeout: 20_000 });
  };
  useEffect(() => stopPreview, []);
  useEffect(() => { if (t.phase !== "idle") stopPreview(); }, [t.phase]);

  const running = t.phase === "active" || t.phase === "paused";
  const pos = running ? t.fix : preview ? { lat: preview.lat, lon: preview.lon, accuracy: preview.accuracy, speedKmh: 0, altitude: null, at: 0 } : null;
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  const avg = t.elapsedSeconds > 5 ? t.live.distanceKm / (t.elapsedSeconds / 3600) : 0;

  return (
    <>
      <PageHeader title="Live tracking" sub={running ? (t.phase === "paused" ? "Ride paused. GPS recording is off until you resume." : "Recording your ride") : "Check your GPS signal, then start a ride"}
        right={<div className="flex items-center gap-2">{t.pending > 0 && <Badge tone="warning"><CloudOff className="mr-1 h-3 w-3" />{t.pending} waiting to upload</Badge>}<SignalBadge signal={running ? t.signal : preview ? (preview.accuracy <= 15 ? "good" : preview.accuracy <= 50 ? "fair" : "poor") : "none"} accuracy={pos?.accuracy} /></div>} />

      {insecure && <Card className="mb-3 flex gap-2 border-danger/40 bg-danger/5 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-danger" />GPS only works on secure pages. Open RubiCore over https (or on localhost).</Card>}
      {t.error && <Card className="mb-3 flex gap-2 border-warning/40 bg-warning/5 text-sm" role="alert"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" />{t.error}</Card>}
      {running && (
        <Card className="mb-3 flex gap-2 bg-muted/50 text-xs text-muted-foreground"><Info className="h-4 w-4 shrink-0" />
          Keep this page open and the screen on. Browsers pause GPS when the screen locks or you switch tabs, which leaves a gap in your route (distance across a gap is only counted if it's plausible). Always-on background tracking needs the native app.</Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <RideMap height={420} tracks={[{ coords: t.path, color: "#2563eb" }]} markers={pos ? [{ lat: pos.lat, lon: pos.lon, kind: "current", label: "You are here" }] : []} follow={pos ? [pos.lat, pos.lon] : null} />
          <Card className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Latitude</div><div className="font-mono">{pos ? pos.lat.toFixed(6) : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Longitude</div><div className="font-mono">{pos ? pos.lon.toFixed(6) : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">GPS accuracy</div><div>{pos?.accuracy != null ? `±${Math.round(pos.accuracy)} m` : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Altitude</div><div>{t.fix?.altitude != null ? `${Math.round(t.fix.altitude)} m` : "—"}</div></div>
          </Card>
        </div>
        <div className="space-y-3">
          <LiveSpeedCard speed={t.live.currentKmh} max={t.live.maxKmh} avg={running ? avg : undefined} />
          <div className="grid grid-cols-2 gap-3"><DistanceCard km={t.live.distanceKm} /><RideTimer seconds={t.elapsedSeconds} paused={t.phase === "paused"} /></div>
          <div className="flex flex-wrap justify-center gap-3">
            {!running ? (
              <StartRideButton onClick={() => t.start(null)} busy={t.phase === "starting"} />
            ) : (
              <><PauseButton paused={t.phase === "paused"} onClick={t.phase === "paused" ? t.resume : t.pause} /><StopRideButton onClick={t.stop} busy={t.phase === "stopping"} /></>
            )}
          </div>
          {!running && (
            <div className="space-y-2 text-center">
              {preview ? <Button variant="outline" size="sm" onClick={stopPreview}>Stop GPS check</Button>
                : <Button variant="outline" size="sm" onClick={startPreview}><Crosshair className="h-4 w-4" />Check GPS signal</Button>}
              {previewErr && <p className="text-xs text-danger">{previewErr}</p>}
              <p className="text-xs text-muted-foreground">Location is only used while a ride is recording or while you press “Check GPS signal”. Nothing is recorded during a check.</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!t.summary} onClose={t.clearSummary} title="Trip summary">
        {t.summary && <Summary ride={t.summary} onClose={t.clearSummary} />}
      </Dialog>
    </>
  );
}

function Summary({ ride, onClose }: { ride: Ride; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-lg bg-muted p-3"><div className="text-2xl font-bold">{km(ride.total_distance_km, 2)}</div><div className="text-xs text-muted-foreground">distance</div></div>
        <div className="rounded-lg bg-muted p-3"><div className="text-2xl font-bold">{duration(ride.duration_seconds)}</div><div className="text-xs text-muted-foreground">ride time</div></div>
        <div className="rounded-lg bg-muted p-3"><div className="text-2xl font-bold">{kmh(ride.average_speed_kmh)}</div><div className="text-xs text-muted-foreground">average speed</div></div>
        <div className="rounded-lg bg-muted p-3"><div className="text-2xl font-bold">{kmh(ride.maximum_speed_kmh)}</div><div className="text-xs text-muted-foreground">max speed</div></div>
      </div>
      {ride.statistics && ride.statistics.rejected_points > 0 && <p className="text-xs text-muted-foreground">{ride.statistics.rejected_points} of {ride.statistics.accepted_points + ride.statistics.rejected_points} GPS fixes were ignored for distance (poor accuracy, drift or pauses). They are still stored.</p>}
      <input className="h-9 w-full rounded-md border bg-card px-3 text-sm" placeholder="Name this ride (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button onClick={async () => { if (title.trim()) await api.put(`/rides/${ride.id}`, { title: title.trim() }); router.push(`/ride/history/${ride.id}`); }}><MapPinned className="h-4 w-4" />View route</Button>
      </div>
    </div>
  );
}

export default function LivePage() {
  return <Suspense><Live /></Suspense>;
}
