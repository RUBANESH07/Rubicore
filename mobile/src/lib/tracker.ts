/**
 * Ride recorder for the phone.
 *
 * - GPS fixes go through the same engine as the website for live numbers; the server recomputes from the raw points
 *   (authoritative) every time points are uploaded and when the ride stops.
 * - Fixes are queued on the device and uploaded in batches, so a dead zone or no signal loses nothing.
 * - In a real build (development build / store build) recording continues with the screen locked or while using other apps,
 *   via a background location task (Android foreground service with a notification, iOS background location).
 * - In Expo Go there is no background location, so the app records only while it is open and the screen is on.
 *   Nothing here claims tracking continues after the app is force-stopped: it does not.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api, ApiError } from "./api";
import { GpsPoint, RideProcessor } from "./gps";

const TASK = "rubicore-ride-location";
const KEY = "rr_session_v2";
const FLUSH_EVERY = 20;
const FLUSH_MS = 15_000;

export type Phase = "idle" | "starting" | "active" | "paused" | "stopping";
export type Mode = "background" | "foreground" | "none";
export type RideSummary = {
  id: number; total_distance_km: number; duration_seconds: number; average_speed_kmh: number; maximum_speed_kmh: number;
  statistics?: { rejected_points: number; accepted_points: number };
};

type QPoint = { latitude: number; longitude: number; recorded_at: string; speed_kmh: number | null; accuracy_m: number | null; altitude_m: number | null };
type Op = { op: "pause" | "resume" | "stop"; at: string };
type Session = {
  rideId: number | null; clientId: string; bikeId: number | null; startedAt: number; points: QPoint[]; ops: Op[];
  baseKm: number; baseMaxKmh: number; phase: "active" | "paused"; segment: number; pausedMs: number; pauseAt: number | null;
};

export type TrackerState = {
  phase: Phase; mode: Mode; error: string; summary: RideSummary | null; pending: number;
  distanceKm: number; maxKmh: number; currentKmh: number; accuracy: number | null; altitude: number | null;
  fix: { latitude: number; longitude: number } | null; path: [number, number][];
  startedAt: number; pausedMs: number; pauseAt: number | null; lastFixAt: number;
};

const initial = (): TrackerState => ({
  phase: "idle", mode: "none", error: "", summary: null, pending: 0, distanceKm: 0, maxKmh: 0, currentKmh: 0, accuracy: null, altitude: null,
  fix: null, path: [], startedAt: 0, pausedMs: 0, pauseAt: null, lastFixAt: 0,
});

let state: TrackerState = initial();
let session: Session | null = null;
let proc = new RideProcessor();
let watchSub: Location.LocationSubscription | null = null;
let flushing = false;
let lastFlush = 0;
let inited = false;
const listeners = new Set<() => void>();

/** Idempotency key so a retried "start ride" never creates two rides. Uniqueness is all that matters here, not secrecy,
 *  so plain JavaScript is enough (no native module needed). */
function newClientId(): string {
  const rnd = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}`;
}

const supportsBackground = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;  // false inside Expo Go

function set(patch: Partial<TrackerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const isBackgroundCapable = () => supportsBackground;

async function persist() {
  if (session) await AsyncStorage.setItem(KEY, JSON.stringify(session));
  else await AsyncStorage.removeItem(KEY);
}

/** Take new GPS fixes (from the foreground watcher or the background task). */
export async function ingest(locations: Location.LocationObject[]) {
  if (!session) await restore();
  if (!session || session.phase !== "active") return;
  const s = session;
  let last: Location.LocationObject | null = null;
  let speed = state.currentKmh;
  for (const loc of locations) {
    const c = loc.coords;
    const kmh = c.speed != null && Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 3.6 : null;
    const p: GpsPoint = { lat: c.latitude, lon: c.longitude, t: loc.timestamp / 1000, speedKmh: kmh, accuracyM: c.accuracy, altitudeM: c.altitude, segment: s.segment };
    const r = proc.add(p);
    speed = r.accepted ? r.speedKmh : speed;
    s.points.push({ latitude: c.latitude, longitude: c.longitude, recorded_at: new Date(loc.timestamp).toISOString(), speed_kmh: kmh, accuracy_m: c.accuracy ?? null, altitude_m: c.altitude ?? null });
    last = loc;
    if (r.accepted) state.path.push([c.latitude, c.longitude]);
  }
  if (!last) return;
  if (state.path.length > 3000) state.path = state.path.slice(-2000);
  set({
    fix: { latitude: last.coords.latitude, longitude: last.coords.longitude }, accuracy: last.coords.accuracy ?? null, altitude: last.coords.altitude ?? null,
    distanceKm: s.baseKm + proc.distanceKm, maxKmh: Math.max(s.baseMaxKmh, proc.maxSpeedKmh), currentKmh: speed, pending: s.points.length, lastFixAt: Date.now(), path: state.path,
  });
  await persist();
  if (s.points.length >= FLUSH_EVERY || Date.now() - lastFlush > FLUSH_MS) void flush();
}

// Must be defined at module load so the OS can start it while the app is in the background.
TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  await ingest(locations);
});

async function restore() {
  if (session) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) session = JSON.parse(raw) as Session;
  } catch { /* corrupt entry: ignore */ }
}

/** Upload anything waiting: start the ride if it was created offline, then points, then pause/resume/stop in order. */
export async function flush() {
  if (!session || flushing) return;
  flushing = true;
  lastFlush = Date.now();
  const s = session;
  try {
    if (s.rideId == null) {
      const r = await api.post<{ id: number }>("/rides/start", { bike_id: s.bikeId, client_id: s.clientId, started_at: new Date(s.startedAt).toISOString(), source: "mobile" });
      s.rideId = r.id;
      await persist();
    }
    while (s.points.length) {
      const batch = s.points.slice(0, 200);
      await api.post(`/rides/${s.rideId}/points`, { points: batch });
      s.points.splice(0, batch.length);
      await persist();
    }
    while (s.ops.length) {
      const op = s.ops[0];
      const r = await api.post<RideSummary>(`/rides/${s.rideId}/${op.op}`, { at: op.at });
      s.ops.shift();
      await persist();
      if (op.op === "stop") {
        set({ summary: r });
        session = null;
        await persist();
        break;
      }
    }
    if (state.error.startsWith("Offline")) set({ error: "" });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    if (status === 404 || status === 409) { session = null; await persist(); }   // server no longer has this ride: drop the local copy
    else if (status !== 401) set({ error: `Offline: ${s.points.length} GPS points are saved on this phone and will upload when the connection returns.` });
  } finally {
    flushing = false;
    set({ pending: session?.points.length ?? 0 });
  }
}

async function startCollecting(): Promise<Mode> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) throw new Error("Location permission was denied. Allow location for RubiCore in your phone settings.");
  if (supportsBackground) {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.granted) {
        await Location.startLocationUpdatesAsync(TASK, {
          accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0,
          pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
          activityType: Location.ActivityType.AutomotiveNavigation,
          foregroundService: { notificationTitle: "RubiCore is recording your ride", notificationBody: "Tap to return to the app.", notificationColor: "#be185d" },
        });
        return "background";
      }
    } catch { /* fall through to foreground-only */ }
  }
  watchSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 }, (loc) => { void ingest([loc]); });
  void activateKeepAwakeAsync("ride");
  return "foreground";
}

async function stopCollecting() {
  try { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); } catch {}
  watchSub?.remove();
  watchSub = null;
  deactivateKeepAwake("ride");
  set({ mode: "none" });
}

/** Call once when the app opens: pick up a ride that was running or still has data waiting to upload. */
export async function init() {
  if (inited) return;
  inited = true;
  await restore();
  if (!session) return;
  const s = session;
  proc = new RideProcessor();
  s.segment += 1;  // never join the gap while the app was closed to the previous fix
  set({ phase: s.phase, startedAt: s.startedAt, pausedMs: s.pausedMs, pauseAt: s.pauseAt, distanceKm: s.baseKm, maxKmh: s.baseMaxKmh, pending: s.points.length });
  if (s.phase === "active") {
    try { set({ mode: await startCollecting() }); } catch (e: any) { set({ error: e.message }); }
  }
  void flush();
}

export async function start(bikeId: number | null) {
  if (state.phase !== "idle") return;
  set({ ...initial(), phase: "starting", summary: null });
  try {
    const mode = await startCollecting();
    session = { rideId: null, clientId: newClientId(), bikeId, startedAt: Date.now(), points: [], ops: [], baseKm: 0, baseMaxKmh: 0, phase: "active", segment: 0, pausedMs: 0, pauseAt: null };
    proc = new RideProcessor();
    await persist();
    set({ phase: "active", mode, startedAt: session.startedAt, pausedMs: 0, pauseAt: null });
    void flush();
  } catch (e: any) {
    await stopCollecting();
    session = null;
    set({ phase: "idle", error: e.message || "Couldn't start the ride." });
  }
}

export async function pause() {
  if (!session || session.phase !== "active") return;
  await stopCollecting();  // pausing really stops GPS recording
  session.phase = "paused";
  session.pauseAt = Date.now();
  session.ops.push({ op: "pause", at: new Date().toISOString() });
  await persist();
  set({ phase: "paused", pauseAt: session.pauseAt, currentKmh: 0 });
  void flush();
}

export async function resume() {
  if (!session || session.phase !== "paused") return;
  if (session.pauseAt) session.pausedMs += Date.now() - session.pauseAt;
  session.pauseAt = null;
  session.segment += 1;  // first fix after a pause starts a new segment
  session.phase = "active";
  session.ops.push({ op: "resume", at: new Date().toISOString() });
  await persist();
  try {
    const mode = await startCollecting();
    set({ phase: "active", mode, pausedMs: session.pausedMs, pauseAt: null });
  } catch (e: any) {
    session.phase = "paused";
    session.pauseAt = Date.now();
    set({ error: e.message });
  }
  void flush();
}

export async function stop() {
  if (!session) return;
  set({ phase: "stopping" });
  await stopCollecting();
  session.ops.push({ op: "stop", at: new Date().toISOString() });
  await persist();
  await flush();
  if (session) set({ error: "Offline: the ride is saved on this phone and will finish saving when you're back online." });
  set({ phase: "idle", pending: session ? (session as Session).points.length : 0 });
  state = { ...initial(), summary: state.summary, error: state.error, pending: state.pending };
  listeners.forEach((l) => l());
}

export const clearSummary = () => set({ summary: null });
export const clearError = () => set({ error: "" });
