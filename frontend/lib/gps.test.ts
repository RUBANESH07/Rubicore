import assert from "node:assert/strict";
import { test } from "node:test";
import { GpsPoint, RideProcessor, haversineKm, validate } from "./gps";

const M = 111_195;
const LAT = 19.076, LON = 72.8777;
const drive = (speed = 36, seconds = 60, o: { t0?: number; startM?: number; seg?: number; acc?: number; report?: boolean } = {}): GpsPoint[] => {
  const out: GpsPoint[] = [];
  for (let i = 0; i <= seconds; i += 2) {
    out.push({ lat: LAT + ((o.startM ?? 0) + (speed / 3.6) * i) / M, lon: LON, t: (o.t0 ?? 0) + i, speedKmh: o.report === false ? null : speed, accuracyM: o.acc ?? 8, segment: o.seg ?? 0 });
  }
  return out;
};
const run = (pts: GpsPoint[]) => {
  const p = new RideProcessor();
  const results = pts.map((x) => p.add(x));
  return { p, results };
};

test("haversine known distances", () => {
  assert.ok(Math.abs(haversineKm(0, 10, 1, 10) - 111.195) < 0.05);
  assert.ok(Math.abs(haversineKm(19.076, 72.8777, 18.5204, 73.8567) - 120) < 3);
});

test("constant speed gives the right distance and max speed", () => {
  const { p } = run(drive(36, 120));
  assert.ok(Math.abs(p.distanceKm - 1.2) < 0.02);
  assert.ok(Math.abs(p.maxSpeedKmh - 36) < 0.5);
});

test("stationary drift is not distance", () => {
  const pts: GpsPoint[] = [];
  for (let i = 0; i < 600; i += 2) {
    pts.push({ lat: LAT + (8 * Math.cos(i / 5)) / M, lon: LON + (8 * Math.sin(i / 7)) / (M * Math.cos((LAT * Math.PI) / 180)), t: i, speedKmh: 0, accuracyM: 12 });
  }
  const { p } = run(pts);
  assert.ok(p.distanceKm < 0.01);
});

test("impossible jump, low accuracy and invalid points are rejected", () => {
  const pts = drive(36, 60);
  pts.splice(16, 0, { lat: LAT + 50_000 / M, lon: LON, t: 31, speedKmh: 36, accuracyM: 8 });
  pts[3].accuracyM = 400;
  const { p, results } = run(pts);
  assert.equal(results[16].reason, "impossible_jump");
  assert.equal(results[3].reason, "low_accuracy");
  assert.equal(validate({ lat: 91, lon: 0, t: 1 }), "invalid_coordinates");
  assert.equal(validate({ lat: 0, lon: 0, t: 1 }), "null_island");
  assert.ok(p.distanceKm < 0.62);
});

test("segments (pause/resume) are never joined", () => {
  const { p } = run([...drive(36, 60, { seg: 0 }), ...drive(36, 60, { seg: 1, t0: 3600, startM: 20_000 })]);
  assert.ok(Math.abs(p.distanceKm - 1.2) < 0.04);
});

test("negative reported speed falls back to computed speed", () => {
  const pts = drive(36, 60, { report: false });
  pts[5].speedKmh = -12;
  const { results } = run(pts);
  assert.ok(results.every((r) => r.speedKmh >= 0));
});

test("duplicates and out-of-order fixes are not double counted", () => {
  const pts = drive(36, 60);
  const { p, results } = run([...pts, pts[10], pts[11]]);
  assert.deepEqual(results.slice(-2).map((r) => r.reason), ["out_of_order", "out_of_order"]);
  assert.ok(Math.abs(p.distanceKm - 0.6) < 0.02);
});
