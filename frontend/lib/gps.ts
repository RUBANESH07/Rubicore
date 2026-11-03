/**
 * Live GPS engine (TypeScript mirror of backend/app/ride/gps.py). It powers the instant on-screen numbers;
 * the server recomputes everything from the raw points when points are uploaded and when the ride stops,
 * and the server's result is authoritative. Keep the two implementations in step (constants, rules).
 */
const R = 6_371_008.8;

export type GpsConfig = {
  maxAccuracyM: number; maxSpeedKmh: number; goodSpeedAccuracyM: number; minMoveM: number; movingSpeedKmh: number;
  stillSpeedKmh: number; gapS: number; maxGapSpeedKmh: number;
};
export const DEFAULT_CONFIG: GpsConfig = {
  maxAccuracyM: 50, maxSpeedKmh: 250, goodSpeedAccuracyM: 25, minMoveM: 6, movingSpeedKmh: 3, stillSpeedKmh: 1, gapS: 90, maxGapSpeedKmh: 160,
};

export type GpsPoint = { lat: number; lon: number; t: number; speedKmh?: number | null; accuracyM?: number | null; altitudeM?: number | null; segment?: number };
export type PointResult = { accepted: boolean; reason?: string; speedKmh: number; movedM: number };

const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1), p2 = rad(lat2), dphi = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const haversineKm = (a: number, b: number, c: number, d: number) => haversineM(a, b, c, d) / 1000;

export function validate(p: GpsPoint): string | null {
  if (![p.lat, p.lon, p.t].every((v) => typeof v === "number" && Number.isFinite(v))) return "invalid_value";
  if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return "invalid_coordinates";
  if (p.lat === 0 && p.lon === 0) return "null_island";
  if (p.accuracyM != null && (!Number.isFinite(p.accuracyM) || p.accuracyM < 0)) return "invalid_accuracy";
  return null;
}

export class RideProcessor {
  cfg: GpsConfig;
  last: GpsPoint | null = null;
  anchor: GpsPoint | null = null;
  distanceM = 0;
  movingS = 0;
  stationaryS = 0;
  accepted = 0;
  rejected: Record<string, number> = {};
  private speeds: number[] = [];

  constructor(cfg: Partial<GpsConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  private reject(reason: string): PointResult {
    this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
    return { accepted: false, reason, speedKmh: 0, movedM: 0 };
  }

  private reportedOk(p: GpsPoint) {
    const c = this.cfg;
    return p.speedKmh != null && Number.isFinite(p.speedKmh) && p.speedKmh >= 0 && p.speedKmh <= c.maxSpeedKmh &&
      p.accuracyM != null && p.accuracyM <= c.goodSpeedAccuracyM;
  }

  add(p: GpsPoint): PointResult {
    const c = this.cfg;
    const bad = validate(p);
    if (bad) return this.reject(bad);
    p = { ...p, segment: p.segment ?? 0 };
    if (p.accuracyM != null && p.accuracyM > c.maxAccuracyM) return this.reject("low_accuracy");
    const last = this.last;
    if (last && p.segment === last.segment) {
      const dt = p.t - last.t;
      if (dt < 0) return this.reject("out_of_order");
      if (dt === 0) return this.reject("duplicate");
    }
    if (!last || p.segment !== last.segment) {
      this.last = this.anchor = p;
      this.accepted++;
      return { accepted: true, speedKmh: 0, movedM: 0 };
    }
    const dt = p.t - last.t;
    const implied = (haversineM(last.lat, last.lon, p.lat, p.lon) / dt) * 3.6;
    if (implied > c.maxSpeedKmh) return this.reject("impossible_jump");
    if (dt > c.gapS && implied > c.maxGapSpeedKmh) return this.reject("gap_jump");

    const ok = this.reportedOk(p);
    let speed = ok ? (p.speedKmh as number) : implied;
    const anchor = this.anchor as GpsPoint;
    const dAnchor = haversineM(anchor.lat, anchor.lon, p.lat, p.lon);
    const acc = p.accuracyM ?? 10;
    const threshold = Math.max(c.minMoveM, acc);
    const saysStill = ok && (p.speedKmh as number) < c.stillSpeedKmh && dAnchor < Math.max(3 * threshold, 30);
    const moving = !saysStill && (dAnchor >= threshold || (ok && (p.speedKmh as number) >= c.movingSpeedKmh && dAnchor >= 2));
    let moved = 0;
    if (moving) {
      moved = dAnchor;
      this.distanceM += moved;
      this.movingS += dt;
      this.anchor = p;
      this.speeds.push(Math.max(0, Math.min(speed, c.maxSpeedKmh)));
    } else {
      this.stationaryS += dt;
      speed = 0;
    }
    this.last = p;
    this.accepted++;
    return { accepted: true, speedKmh: moving ? speed : 0, movedM: moved };
  }

  get distanceKm() {
    return this.distanceM / 1000;
  }

  get maxSpeedKmh() {
    const s = this.speeds;
    if (!s.length) return 0;
    if (s.length < 3) return Math.round(Math.max(...s) * 10) / 10;
    let best = 0;
    for (let i = 1; i < s.length - 1; i++) best = Math.max(best, [s[i - 1], s[i], s[i + 1]].sort((a, b) => a - b)[1]);
    return Math.round(best * 10) / 10;
  }
}
