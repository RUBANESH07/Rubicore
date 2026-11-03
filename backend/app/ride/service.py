"""Ride processing and aggregation. Authoritative stats always come from the raw stored points."""
import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FuelEntry, Ride, RideEvent, RideGpsPoint, RideStatistic, UserPreference
from app.ride.gps import GpsConfig, Point, RideProcessor, simplify

DEFAULT_PREFS = {"distance_unit": "km", "max_accuracy_m": 50, "reverse_geocode": False, "retention_days": None,
                 "keep_screen_on": True}


def aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def epoch(dt: datetime) -> float:
    return aware(dt).timestamp()


def local_date(dt: datetime) -> date:
    return aware(dt).astimezone(ZoneInfo(settings.timezone)).date()


def get_prefs(db: Session, user_id: int) -> dict:
    row = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    return {**DEFAULT_PREFS, **((row.data or {}) if row else {})}


def gps_config(prefs: dict) -> GpsConfig:
    return GpsConfig(max_accuracy_m=float(prefs.get("max_accuracy_m", 50)))


# ---------- pauses ----------
def pause_intervals(events: list[RideEvent], end: datetime) -> list[tuple[float, float]]:
    """[(pause_at, resume_at)] as epoch seconds; an unfinished pause runs to `end`."""
    out, start = [], None
    for e in sorted(events, key=lambda e: epoch(e.at)):
        if e.type == "pause" and start is None:
            start = epoch(e.at)
        elif e.type in ("resume", "stop") and start is not None:
            out.append((start, epoch(e.at)))
            start = None
    if start is not None:
        out.append((start, max(start, epoch(end))))
    return out


def paused_total(events: list[RideEvent], end: datetime) -> int:
    return int(sum(b - a for a, b in pause_intervals(events, end)))


# ---------- core: recompute a ride from its raw points ----------
def reprocess(db: Session, ride: Ride, *, final: bool = False) -> dict:
    """Re-run the GPS engine over every stored point, update point flags (only where changed), the ride row and
    its aggregate row. Safe to call repeatedly; the result depends only on the raw points, events and settings."""
    events = list(db.scalars(select(RideEvent).where(RideEvent.ride_id == ride.id)))
    rows = list(db.scalars(select(RideGpsPoint).where(RideGpsPoint.ride_id == ride.id).order_by(RideGpsPoint.recorded_at)))
    cfg = gps_config(get_prefs(db, ride.user_id))
    end = ride.ended_at or (rows[-1].recorded_at if rows else ride.started_at)
    intervals = pause_intervals(events, end)
    resumes = sorted(epoch(e.at) for e in events if e.type == "resume")

    proc = RideProcessor(cfg)
    last_accepted: RideGpsPoint | None = None
    paused_points = 0
    for r in rows:
        t = epoch(r.recorded_at)
        paused = any(a <= t < b for a, b in intervals)
        seg = sum(1 for x in resumes if x <= t)
        r.segment = seg
        if paused:
            ok, reason, speed = False, "paused", None
            paused_points += 1
        else:
            res = proc.add(Point(r.latitude, r.longitude, t, r.speed_kmh, r.accuracy_m, r.altitude_m, seg))
            ok, reason, speed = res.accepted, res.reason, (res.speed_kmh if res.accepted else None)
        r.accepted, r.reject_reason, r.computed_speed_kmh = ok, reason, speed
        if ok:
            last_accepted = r

    paused_s = paused_total(events, end)
    dur = max(0.0, (epoch(end) - epoch(ride.started_at)) - paused_s)
    s = proc.summary(dur if dur > 0 else None)
    if paused_points:  # fixes recorded while paused are kept raw but never counted
        s["rejected_by_reason"]["paused"] = paused_points
        s["rejected_points"] += paused_points
    ride.total_distance_km = s["distance_km"]
    ride.average_speed_kmh = s["average_speed_kmh"]
    ride.maximum_speed_kmh = s["max_speed_kmh"]
    ride.duration_seconds = s["duration_seconds"] if dur > 0 else 0
    ride.paused_seconds = paused_s
    first = next((r for r in rows if r.accepted), None)
    if first and ride.start_latitude is None:
        ride.start_latitude, ride.start_longitude = first.latitude, first.longitude
    if final and last_accepted:
        ride.end_latitude, ride.end_longitude = last_accepted.latitude, last_accepted.longitude

    stat = db.scalar(select(RideStatistic).where(RideStatistic.ride_id == ride.id))
    if not stat:
        stat = RideStatistic(ride_id=ride.id)
        db.add(stat)
    stat.moving_seconds, stat.stationary_seconds = s["moving_seconds"], s["stationary_seconds"]
    stat.moving_average_speed_kmh = s["moving_average_speed_kmh"]
    stat.accepted_points, stat.rejected_points = s["accepted_points"], s["rejected_points"]
    stat.rejected_by_reason, stat.gap_count = s["rejected_by_reason"], s["gap_count"]
    stat.raw_distance_km = s["raw_distance_km"]
    stat.min_altitude_m, stat.max_altitude_m, stat.elevation_gain_m = s["min_altitude_m"], s["max_altitude_m"], s["elevation_gain_m"]
    stat.updated_at = datetime.now(timezone.utc)
    db.commit()
    return s


def live_state(ride: Ride, stat: RideStatistic | None, now: datetime | None = None) -> dict:
    return {"status": ride.status, "distance_km": ride.total_distance_km, "average_speed_kmh": ride.average_speed_kmh,
            "max_speed_kmh": ride.maximum_speed_kmh, "duration_seconds": ride.duration_seconds,
            "paused_seconds": ride.paused_seconds, "accepted_points": stat.accepted_points if stat else 0,
            "rejected_points": stat.rejected_points if stat else 0}


def track(rows: list[RideGpsPoint], max_points: int = 1500) -> list[list]:
    """Map polyline: accepted points per segment, simplified (3 m tolerance) then thinned. [lat, lon, t, speed, segment]"""
    acc = [r for r in rows if r.accepted]
    if len(acc) > 2:
        keep = simplify([(r.latitude, r.longitude) for r in acc], 3.0)
        acc = [acc[i] for i in keep]
    if len(acc) > max_points:
        step = len(acc) / max_points
        acc = [acc[int(i * step)] for i in range(max_points - 1)] + [acc[-1]]
    return [[r.latitude, r.longitude, int(epoch(r.recorded_at)), r.computed_speed_kmh, r.segment] for r in acc]


def compact_points(db: Session, ride: Ride, tolerance_m: float = 5.0) -> int:
    """Retention: keep only the simplified route for old rides. Aggregates are already stored."""
    reprocess(db, ride, final=ride.status == "completed")
    rows = list(db.scalars(select(RideGpsPoint).where(RideGpsPoint.ride_id == ride.id).order_by(RideGpsPoint.recorded_at)))
    acc = [r for r in rows if r.accepted]
    if len(acc) < 3:
        return 0
    keep = {acc[i].id for i in simplify([(r.latitude, r.longitude) for r in acc], tolerance_m)}
    removed = 0
    for r in rows:
        if r.id not in keep:
            db.delete(r)
            removed += 1
    stat = db.scalar(select(RideStatistic).where(RideStatistic.ride_id == ride.id))
    if stat:
        stat.points_compacted_at = datetime.now(timezone.utc)
    db.commit()
    return removed


# ---------- aggregation ----------
def rides_between(db: Session, user_id: int, start: date, end: date) -> list[Ride]:
    pad = timedelta(days=1)
    lo = datetime.combine(start - pad, datetime.min.time(), tzinfo=timezone.utc)
    hi = datetime.combine(end + pad + pad, datetime.min.time(), tzinfo=timezone.utc)
    rows = db.scalars(select(Ride).where(Ride.user_id == user_id, Ride.status == "completed",
                                         Ride.started_at >= lo, Ride.started_at < hi).order_by(Ride.started_at))
    return [r for r in rows if start <= local_date(r.started_at) <= end]


def totals(rides: list[Ride]) -> dict:
    km = sum(r.total_distance_km for r in rides)
    secs = sum(r.duration_seconds for r in rides)
    return {"rides": len(rides), "distance_km": round(km, 2), "duration_seconds": secs,
            "average_speed_kmh": round(km / (secs / 3600), 1) if secs else 0.0,
            "max_speed_kmh": round(max((r.maximum_speed_kmh for r in rides), default=0.0), 1)}


def by_day(rides: list[Ride], start: date, end: date) -> list[dict]:
    km, n, secs = defaultdict(float), defaultdict(int), defaultdict(int)
    for r in rides:
        d = local_date(r.started_at)
        km[d] += r.total_distance_km
        n[d] += 1
        secs[d] += r.duration_seconds
    out, d = [], start
    while d <= end:
        out.append({"date": d.isoformat(), "distance_km": round(km[d], 2), "rides": n[d], "duration_seconds": secs[d]})
        d += timedelta(days=1)
    return out


def fuel_between(db: Session, user_id: int, start: date, end: date) -> float:
    rows = db.scalars(select(FuelEntry).where(FuelEntry.user_id == user_id, FuelEntry.date >= start, FuelEntry.date <= end))
    return round(sum(float(f.total_amount) for f in rows), 2)


def month_bounds(y: int, m: int) -> tuple[date, date]:
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def route_key(r: Ride) -> tuple | None:
    if r.start_latitude is None or r.end_latitude is None:
        return None
    cell = lambda v: round(v, 2)  # ~1 km grid  # noqa: E731
    return (cell(r.start_latitude), cell(r.start_longitude), cell(r.end_latitude), cell(r.end_longitude))


def popular_routes(rides: list[Ride], limit: int = 5) -> list[dict]:
    groups: dict[tuple, list[Ride]] = defaultdict(list)
    for r in rides:
        k = route_key(r)
        if k and r.total_distance_km >= 0.3:
            groups[k].append(r)
    out = []
    for k, rs in groups.items():
        first = rs[0]
        out.append({"count": len(rs), "total_km": round(sum(x.total_distance_km for x in rs), 1),
                    "avg_km": round(sum(x.total_distance_km for x in rs) / len(rs), 1),
                    "start": first.start_label or f"{k[0]:.2f}, {k[1]:.2f}", "end": first.end_label or f"{k[2]:.2f}, {k[3]:.2f}",
                    "ride_ids": [x.id for x in rs][:10]})
    return sorted(out, key=lambda g: (-g["count"], -g["total_km"]))[:limit]


# ---------- fuel / mileage ----------
def mileage_segments(entries: list[FuelEntry]) -> list[dict]:
    """Full-to-full method. Fuel burned between two full fill-ups = litres added at the second fill plus any
    partial fills in between. GPS distance is never used to infer consumption."""
    segs, by_bike = [], defaultdict(list)
    for e in entries:
        by_bike[e.bike_id].append(e)
    for bike_id, es in by_bike.items():
        es.sort(key=lambda e: (e.odometer_km, e.date))
        last_full, litres, cost = None, 0.0, 0.0
        for e in es:
            if last_full is not None:
                litres += e.litres
                cost += float(e.total_amount)
            if e.is_full_tank:
                if last_full is not None:
                    km = e.odometer_km - last_full.odometer_km
                    if km > 0 and litres > 0:
                        segs.append({"bike_id": bike_id, "from_date": last_full.date.isoformat(), "to_date": e.date.isoformat(),
                                     "from_odometer_km": last_full.odometer_km, "to_odometer_km": e.odometer_km,
                                     "distance_km": round(km, 1), "litres": round(litres, 2),
                                     "mileage_kmpl": round(km / litres, 2), "cost": round(cost, 2),
                                     "cost_per_km": round(cost / km, 2)})
                last_full, litres, cost = e, 0.0, 0.0
    return sorted(segs, key=lambda s: s["to_date"])
