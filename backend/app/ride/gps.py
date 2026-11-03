"""GPS processing engine for RubiRide.

Design rules:
  * Raw points are never thrown away. Every structurally valid point is stored; the engine labels each
    one accepted or rejected (with a reason), so rides can be reprocessed with different settings.
  * Distance is the Haversine distance between *anchor* points, not between every pair of noisy fixes, so
    stationary GPS drift and jitter are not counted and nothing is counted twice.
  * Points in different segments (before / after a pause) are never joined.
  * Speed is the phone-reported speed when its accuracy is good, otherwise computed from consecutive
    accepted points. Negative or impossible values are never used.

The same algorithm is mirrored in TypeScript for live numbers (frontend/lib/gps.ts, mobile/src/lib/gps.ts);
the server result is authoritative.
"""
import math
from dataclasses import dataclass, field

EARTH_RADIUS_M = 6_371_008.8


@dataclass
class GpsConfig:
    max_accuracy_m: float = 50.0        # fixes less accurate than this are labelled rejected
    max_speed_kmh: float = 250.0        # faster than any motorcycle trip: treat as a GPS jump
    good_speed_accuracy_m: float = 25.0  # reported speed is trusted only at/below this accuracy
    min_move_m: float = 6.0             # least displacement from the anchor that counts as movement
    moving_speed_kmh: float = 3.0       # reported speed above this (with accuracy) counts as moving
    still_speed_kmh: float = 1.0        # accurately reported speed below this means stationary
    gap_s: float = 90.0                 # longer silence = a gap in updates
    max_gap_speed_kmh: float = 160.0    # after a gap the implied speed must still be plausible
    elevation_threshold_m: float = 3.0


@dataclass
class Point:
    lat: float
    lon: float
    t: float                            # epoch seconds
    speed_kmh: float | None = None      # as reported by the device
    accuracy_m: float | None = None
    altitude_m: float | None = None
    segment: int = 0


@dataclass
class PointResult:
    accepted: bool
    reason: str | None = None
    speed_kmh: float = 0.0
    moved_m: float = 0.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    return haversine_m(lat1, lon1, lat2, lon2) / 1000.0


def validate(p: Point) -> str | None:
    """Structural validation. Returns a rejection reason or None."""
    for v in (p.lat, p.lon, p.t):
        if v is None or not math.isfinite(v):
            return "invalid_value"
    if not (-90 <= p.lat <= 90 and -180 <= p.lon <= 180):
        return "invalid_coordinates"
    if p.lat == 0 and p.lon == 0:
        return "null_island"
    if p.accuracy_m is not None and (not math.isfinite(p.accuracy_m) or p.accuracy_m < 0):
        return "invalid_accuracy"
    return None


class RideProcessor:
    """Incremental processor. Feed points in time order with add(); read totals any time."""

    def __init__(self, cfg: GpsConfig | None = None):
        self.cfg = cfg or GpsConfig()
        self.last: Point | None = None
        self.anchor: Point | None = None
        self.distance_m = 0.0
        self.moving_s = 0.0
        self.stationary_s = 0.0
        self.gap_count = 0
        self.accepted = 0
        self.rejected: dict[str, int] = {}
        self._speeds: list[float] = []
        self._alt_ref: float | None = None
        self.elevation_gain_m = 0.0
        self.min_alt: float | None = None
        self.max_alt: float | None = None
        self.raw_distance_m = 0.0       # naive sum over every valid consecutive pair, for transparency
        self._raw_prev: Point | None = None

    # ---- helpers
    def _reject(self, reason: str) -> PointResult:
        self.rejected[reason] = self.rejected.get(reason, 0) + 1
        return PointResult(False, reason)

    def _reported_ok(self, p: Point) -> bool:
        c = self.cfg
        return (p.speed_kmh is not None and math.isfinite(p.speed_kmh) and 0 <= p.speed_kmh <= c.max_speed_kmh
                and p.accuracy_m is not None and p.accuracy_m <= c.good_speed_accuracy_m)

    def _altitude(self, p: Point):
        if p.altitude_m is None or not math.isfinite(p.altitude_m):
            return
        a = p.altitude_m
        self.min_alt = a if self.min_alt is None else min(self.min_alt, a)
        self.max_alt = a if self.max_alt is None else max(self.max_alt, a)
        if self._alt_ref is None:
            self._alt_ref = a
        elif a - self._alt_ref >= self.cfg.elevation_threshold_m:
            self.elevation_gain_m += a - self._alt_ref
            self._alt_ref = a
        elif self._alt_ref - a >= self.cfg.elevation_threshold_m:
            self._alt_ref = a

    # ---- main entry
    def add(self, p: Point) -> PointResult:
        c = self.cfg
        reason = validate(p)
        if reason:
            return self._reject(reason)
        if self._raw_prev is not None and p.segment == self._raw_prev.segment and p.t > self._raw_prev.t:
            self.raw_distance_m += haversine_m(self._raw_prev.lat, self._raw_prev.lon, p.lat, p.lon)
        self._raw_prev = p
        if p.accuracy_m is not None and p.accuracy_m > c.max_accuracy_m:
            return self._reject("low_accuracy")
        last = self.last
        if last is not None and p.segment == last.segment:
            dt = p.t - last.t
            if dt < 0:
                return self._reject("out_of_order")
            if dt == 0:
                return self._reject("duplicate")
        if last is None or p.segment != last.segment:
            # first fix of a segment (ride start or after a pause): nothing to measure against
            self.last = self.anchor = p
            self.accepted += 1
            self._altitude(p)
            return PointResult(True, None, p.speed_kmh if self._reported_ok(p) and p.speed_kmh < 1 else 0.0, 0.0)

        d_last = haversine_m(last.lat, last.lon, p.lat, p.lon)
        implied = d_last / dt * 3.6
        if implied > c.max_speed_kmh:
            return self._reject("impossible_jump")
        if dt > c.gap_s:
            self.gap_count += 1
            if implied > c.max_gap_speed_kmh:
                return self._reject("gap_jump")

        reported_ok = self._reported_ok(p)
        speed = p.speed_kmh if reported_ok else implied
        d_anchor = haversine_m(self.anchor.lat, self.anchor.lon, p.lat, p.lon)
        acc = p.accuracy_m if p.accuracy_m is not None else 10.0
        # Displacement smaller than the accuracy radius cannot be told apart from noise.
        threshold = max(c.min_move_m, acc)
        # A device that accurately reports "not moving" is believed unless the displacement is clearly large.
        says_still = reported_ok and p.speed_kmh < c.still_speed_kmh and d_anchor < max(3 * threshold, 30.0)
        moving = (not says_still) and (d_anchor >= threshold or
                                       (reported_ok and p.speed_kmh >= c.moving_speed_kmh and d_anchor >= 2.0))

        moved = 0.0
        if moving:
            moved = d_anchor
            self.distance_m += moved
            self.moving_s += dt
            self.anchor = p
            self._speeds.append(max(0.0, min(speed, c.max_speed_kmh)))
        else:
            self.stationary_s += dt
            speed = 0.0
        self.last = p
        self.accepted += 1
        self._altitude(p)
        return PointResult(True, None, speed if moving else 0.0, moved)

    # ---- results
    @property
    def distance_km(self) -> float:
        return self.distance_m / 1000.0

    @property
    def max_speed_kmh(self) -> float:
        s = self._speeds
        if not s:
            return 0.0
        if len(s) < 3:
            return round(max(s), 1)
        # 3-point median filter removes single-fix spikes before taking the maximum
        smoothed = [sorted(s[i - 1:i + 2])[1] for i in range(1, len(s) - 1)]
        return round(max(smoothed), 1)

    def summary(self, duration_s: float | None = None) -> dict:
        """duration_s = riding time excluding pauses (defaults to the time between accepted points)."""
        elapsed = self.moving_s + self.stationary_s
        dur = duration_s if duration_s and duration_s > 0 else elapsed
        km = self.distance_km
        return {
            "distance_km": round(km, 3),
            "duration_seconds": int(round(dur)),
            "moving_seconds": int(round(self.moving_s)),
            "stationary_seconds": int(round(self.stationary_s)),
            "average_speed_kmh": round(km / (dur / 3600), 1) if dur > 0 else 0.0,
            "moving_average_speed_kmh": round(km / (self.moving_s / 3600), 1) if self.moving_s > 0 else 0.0,
            "max_speed_kmh": self.max_speed_kmh,
            "accepted_points": self.accepted,
            "rejected_points": sum(self.rejected.values()),
            "rejected_by_reason": dict(self.rejected),
            "gap_count": self.gap_count,
            "raw_distance_km": round(self.raw_distance_m / 1000.0, 3),
            "min_altitude_m": self.min_alt,
            "max_altitude_m": self.max_alt,
            "elevation_gain_m": round(self.elevation_gain_m, 1),
        }


def process_points(points: list[Point], cfg: GpsConfig | None = None) -> tuple[list[PointResult], RideProcessor]:
    """Batch helper used for reprocessing: sorts by (segment, time) and returns results in the input order."""
    proc = RideProcessor(cfg)
    order = sorted(range(len(points)), key=lambda i: (points[i].segment, points[i].t))
    results: list[PointResult | None] = [None] * len(points)
    for i in order:
        results[i] = proc.add(points[i])
    return results, proc  # type: ignore[return-value]


def simplify(coords: list[tuple[float, float]], tolerance_m: float) -> list[int]:
    """Douglas-Peucker. Returns indices of the points to keep (always first and last)."""
    n = len(coords)
    if n <= 2:
        return list(range(n))
    lat0 = math.radians(coords[0][0])
    xy = [(math.radians(lon) * math.cos(lat0) * EARTH_RADIUS_M, math.radians(lat) * EARTH_RADIUS_M) for lat, lon in coords]
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = xy[a], xy[b]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            x0, y0 = xy[i]
            d = math.hypot(x0 - x1, y0 - y1) if norm == 0 else abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if best > tolerance_m and idx != -1:
            keep.add(idx)
            stack += [(a, idx), (idx, b)]
    return sorted(keep)
