"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { GpsPoint, RideProcessor } from "@/lib/gps";
import type { Ride } from "@/lib/ride";

/**
 * Browser GPS ride recorder.
 *
 * Honest limits: a web page can only receive GPS while it is open and the screen is on. We request a screen wake
 * lock to help, but a locked screen or a backgrounded tab pauses the browser's location updates (the server records
 * that as a gap). Reliable background tracking needs a native app, which this API is ready for.
 *
 * Points are queued in localStorage and uploaded in batches, so short network drops don't lose data.
 */
export type Phase = "idle" | "starting" | "active" | "paused" | "stopping";
export type Signal = "none" | "searching" | "good" | "fair" | "poor" | "lost";

type QPoint = { latitude: number; longitude: number; recorded_at: string; speed_kmh: number | null; accuracy_m: number | null; altitude_m: number | null };
type Op = { op: "pause" | "resume" | "stop"; at: string };
type Saved = { rideId: number; points: QPoint[]; ops: Op[]; baseKm: number };

const KEY = "rr_session_v1";
const FLUSH_MS = 10_000;
const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const save = (s: Saved | null) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };

export function useRideTracker(maxAccuracyM = 50) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ride, setRide] = useState<Ride | null>(null);
  const [summary, setSummary] = useState<Ride | null>(null);
  const [error, setError] = useState("");
  const [fix, setFix] = useState<{ lat: number; lon: number; accuracy: number | null; speedKmh: number; altitude: number | null; at: number } | null>(null);
  const [live, setLive] = useState({ distanceKm: 0, maxKmh: 0, currentKmh: 0 });
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(0);
  const [path, setPath] = useState<[number, number][]>([]);
  const [ready, setReady] = useState(false);

  const watchId = useRef<number | null>(null);
  const proc = useRef(new RideProcessor({ maxAccuracyM }));
  const sess = useRef<Saved | null>(null);
  const segment = useRef(0);
  const startedAt = useRef(0);
  const pausedMs = useRef(0);
  const pauseAt = useRef<number | null>(null);
  const flushing = useRef(false);
  const wake = useRef<any>(null);
  const lastFixAt = useRef(0);

  useEffect(() => { proc.current.cfg.maxAccuracyM = maxAccuracyM; }, [maxAccuracyM]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  // ---- wake lock
  const holdScreen = useCallback(async () => {
    try { wake.current = await (navigator as any).wakeLock?.request("screen"); } catch {}
  }, []);
  const releaseScreen = useCallback(() => { try { wake.current?.release(); } catch {} wake.current = null; }, []);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && (phase === "active")) holdScreen(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase, holdScreen]);

  // ---- queue flushing
  const flush = useCallback(async () => {
    const s = sess.current;
    if (!s || flushing.current) return;
    flushing.current = true;
    try {
      while (s.points.length) {
        const batch = s.points.slice(0, 200);
        await api.post(`/rides/${s.rideId}/points`, { points: batch });
        s.points.splice(0, batch.length);
        save(s);
      }
      while (s.ops.length) {
        const op = s.ops[0];
        const r = await api.post<Ride>(`/rides/${s.rideId}/${op.op}`, { at: op.at });
        s.ops.shift();
        save(s);
        if (op.op === "stop") { setSummary(r); sess.current = null; save(null); }
      }
      setError((e) => (e.startsWith("Offline") ? "" : e));
    } catch (e: any) {
      if (e?.status === 404 || e?.status === 409) { // server no longer knows this ride / it's finished: drop local queue
        sess.current = null; save(null);
      } else setError(`Offline: ${s.points.length} GPS points are saved on this device and will upload when the connection returns.`);
    } finally {
      setPending(sess.current?.points.length ?? 0);
      flushing.current = false;
    }
  }, []);
  useEffect(() => {
    const t = setInterval(() => { if (sess.current) flush(); }, FLUSH_MS);
    const online = () => flush();
    window.addEventListener("online", online);
    return () => { clearInterval(t); window.removeEventListener("online", online); };
  }, [flush]);

  // ---- geolocation
  const onPosition = useCallback((pos: GeolocationPosition) => {
    const c = pos.coords, t = pos.timestamp / 1000;
    const speed = c.speed != null && Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 3.6 : null;
    lastFixAt.current = Date.now();
    const p: GpsPoint = { lat: c.latitude, lon: c.longitude, t, speedKmh: speed, accuracyM: c.accuracy, altitudeM: c.altitude, segment: segment.current };
    const res = proc.current.add(p);
    setFix({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, speedKmh: res.accepted ? res.speedKmh : 0, altitude: c.altitude, at: Date.now() });
    setLive({ distanceKm: (sess.current?.baseKm ?? 0) + proc.current.distanceKm, maxKmh: proc.current.maxSpeedKmh, currentKmh: res.accepted ? res.speedKmh : 0 });
    if (res.accepted) setPath((old) => (old.length > 4000 ? [...old.slice(-3000), [c.latitude, c.longitude]] : [...old, [c.latitude, c.longitude]]));
    if (sess.current) {  // raw points go to the server regardless of the live filter: the server decides what counts
      sess.current.points.push({ latitude: c.latitude, longitude: c.longitude, recorded_at: new Date(pos.timestamp).toISOString(),
                                 speed_kmh: speed, accuracy_m: c.accuracy ?? null, altitude_m: c.altitude ?? null });
      save(sess.current);
      setPending(sess.current.points.length);
      if (sess.current.points.length >= 20 && !flushing.current) flush();
    }
  }, [flush]);

  const watch = useCallback(() => {
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(onPosition, (e) => {
      setError(e.code === 1 ? "Location permission was denied. Allow location for this site in the browser settings." : e.code === 2 ? "GPS position unavailable." : "GPS timed out; still trying.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
  }, [onPosition]);
  const unwatch = useCallback(() => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }, []);
  useEffect(() => () => { unwatch(); releaseScreen(); }, [unwatch, releaseScreen]);

  // ---- rehydrate after a reload / tab restore
  useEffect(() => {
    api.get<{ ride: Ride | null }>("/rides/active").then(({ ride: r }) => {
      if (!r) { const s = load(); if (s?.ops.length) { sess.current = { ...s, points: s.points }; flush(); } return; }
      const saved = load();
      sess.current = saved && saved.rideId === r.id ? saved : { rideId: r.id, points: [], ops: [], baseKm: 0 };
      sess.current.baseKm = r.total_distance_km;
      proc.current = new RideProcessor({ maxAccuracyM });
      segment.current = 1;  // never join the gap while the page was closed to the previous fix
      startedAt.current = new Date(r.started_at).getTime();
      pausedMs.current = r.paused_seconds * 1000;
      setRide(r);
      setLive({ distanceKm: r.total_distance_km, maxKmh: r.maximum_speed_kmh, currentKmh: 0 });
      setPending(sess.current.points.length);
      if (r.status === "paused") { pauseAt.current = Date.now(); setPhase("paused"); }
      else { setPhase("active"); if (navigator.geolocation) { watch(); holdScreen(); } flush(); }
    }).catch(() => {}).finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- controls
  const start = useCallback(async (bikeId?: number | null) => {
    setError(""); setSummary(null);
    if (!navigator.geolocation) return setError("This browser has no GPS support.");
    if (!window.isSecureContext) return setError("GPS needs a secure page (https, or localhost).");
    setPhase("starting");
    try {
      const r = await api.post<Ride>("/rides/start", { bike_id: bikeId ?? null, source: "web", client_id: crypto.randomUUID() });
      sess.current = { rideId: r.id, points: [], ops: [], baseKm: 0 };
      save(sess.current);
      proc.current = new RideProcessor({ maxAccuracyM });
      segment.current = 0; pausedMs.current = 0; pauseAt.current = null;
      startedAt.current = Date.now();
      setPath([]); setLive({ distanceKm: 0, maxKmh: 0, currentKmh: 0 }); setRide(r); setPhase("active");
      watch(); holdScreen();
    } catch (e: any) {
      setPhase("idle");
      setError(e?.status === 409 ? "A ride is already in progress. Reload this page to continue it." : e.message);
    }
  }, [maxAccuracyM, watch, holdScreen]);

  const queueOp = useCallback((op: Op["op"]) => {
    if (!sess.current) return;
    sess.current.ops.push({ op, at: new Date().toISOString() });
    save(sess.current);
    return flush();
  }, [flush]);

  const pause = useCallback(async () => {
    unwatch(); releaseScreen();  // pause really stops GPS collection
    pauseAt.current = Date.now();
    setPhase("paused");
    await queueOp("pause");
  }, [queueOp, unwatch, releaseScreen]);

  const resume = useCallback(async () => {
    if (pauseAt.current) pausedMs.current += Date.now() - pauseAt.current;
    pauseAt.current = null;
    segment.current += 1;  // first fix after a pause starts a new segment: the gap is never counted as distance
    setPhase("active");
    watch(); holdScreen();
    await queueOp("resume");
  }, [queueOp, watch, holdScreen]);

  const stop = useCallback(async () => {
    unwatch(); releaseScreen();
    setPhase("stopping");
    await queueOp("stop");
    if (sess.current) setError("Offline: the ride is saved on this device and will finish saving when you're back online.");
    setPhase("idle");
    setRide(null);
  }, [queueOp, unwatch, releaseScreen]);

  // ---- derived
  const elapsedMs = phase === "idle" || !startedAt.current ? 0
    : (phase === "paused" && pauseAt.current ? pauseAt.current : now) - startedAt.current - pausedMs.current;
  const age = fix ? (now - lastFixAt.current) / 1000 : null;
  const signal: Signal = phase === "idle" && !fix ? "none" : !fix ? "searching" : phase === "active" && age != null && age > 15 ? "lost"
    : (fix.accuracy ?? 99) <= 15 ? "good" : (fix.accuracy ?? 99) <= maxAccuracyM ? "fair" : "poor";

  return { ready, phase, ride, summary, error, fix, live, path, pending, elapsedSeconds: Math.max(0, elapsedMs / 1000), signal, start, pause, resume, stop,
           clearSummary: () => setSummary(null) };
}
