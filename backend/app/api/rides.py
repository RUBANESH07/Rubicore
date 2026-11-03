"""RubiRide: ride lifecycle, GPS ingestion, history, overview and analytics. Every query is scoped to the user."""
import math
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import today
from app.core.database import get_db
from app.core.deps import get_current_user
from app.integrations import geocode
from app.models import Bike, FuelEntry, Ride, RideEvent, RideGpsPoint, RideStatistic, User
from app.ride import service as svc
from app.ride.gps import Point, validate
from app.services.common import audit, notify

router = APIRouter(prefix="/rides", tags=["rides"])
analytics = APIRouter(prefix="/ride-analytics", tags=["ride analytics"])

MAX_BATCH = 500


# ---------- schemas ----------
class StartIn(BaseModel):
    bike_id: int | None = None
    client_id: str | None = Field(default=None, max_length=64)  # lets an offline client retry safely
    started_at: datetime | None = None
    source: str = Field(default="web", pattern="^(web|mobile)$")
    latitude: float | None = None
    longitude: float | None = None


class PointIn(BaseModel):
    latitude: float
    longitude: float
    recorded_at: datetime
    speed_kmh: float | None = None
    accuracy_m: float | None = None
    altitude_m: float | None = None


class PointsIn(BaseModel):
    points: list[PointIn] = Field(min_length=1, max_length=MAX_BATCH)


class AtIn(BaseModel):
    at: datetime | None = None


class RideUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    start_label: str | None = Field(default=None, max_length=200)
    end_label: str | None = Field(default=None, max_length=200)
    bike_id: int | None = None


class CompactIn(BaseModel):
    older_than_days: int = Field(default=90, ge=7, le=3650)


# ---------- helpers ----------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _owned(db: Session, user: User, ride_id: int) -> Ride:
    r = db.get(Ride, ride_id)
    if not r or r.user_id != user.id:
        raise HTTPException(404, "Ride not found")
    return r


def _stat(db: Session, ride_id: int) -> RideStatistic | None:
    return db.scalar(select(RideStatistic).where(RideStatistic.ride_id == ride_id))


def ride_out(r: Ride, stat: RideStatistic | None = None) -> dict:
    out = {"id": r.id, "bike_id": r.bike_id, "title": r.title, "source": r.source, "status": r.status,
           "started_at": r.started_at, "ended_at": r.ended_at, "date": svc.local_date(r.started_at).isoformat(),
           "start_latitude": r.start_latitude, "start_longitude": r.start_longitude,
           "end_latitude": r.end_latitude, "end_longitude": r.end_longitude,
           "start_label": r.start_label, "end_label": r.end_label,
           "total_distance_km": r.total_distance_km, "average_speed_kmh": r.average_speed_kmh,
           "maximum_speed_kmh": r.maximum_speed_kmh, "duration_seconds": r.duration_seconds,
           "paused_seconds": r.paused_seconds}
    if stat is not None:
        out["statistics"] = {"moving_seconds": stat.moving_seconds, "stationary_seconds": stat.stationary_seconds,
                             "moving_average_speed_kmh": stat.moving_average_speed_kmh, "accepted_points": stat.accepted_points,
                             "rejected_points": stat.rejected_points, "rejected_by_reason": stat.rejected_by_reason or {},
                             "gap_count": stat.gap_count, "raw_distance_km": stat.raw_distance_km,
                             "min_altitude_m": stat.min_altitude_m, "max_altitude_m": stat.max_altitude_m,
                             "elevation_gain_m": stat.elevation_gain_m, "points_compacted": stat.points_compacted_at is not None}
    return out


def _check_bike(db, user, bike_id):
    if bike_id is not None:
        b = db.get(Bike, bike_id)
        if not b or b.user_id != user.id:
            raise HTTPException(422, "Unknown bike")


def _add_event(db: Session, ride: Ride, typ: str, at: datetime):
    db.add(RideEvent(ride_id=ride.id, type=typ, at=at))


def _clamp_at(ride: Ride, at: datetime | None) -> datetime:
    at = svc.aware(at) if at else _now()
    if at > _now() + timedelta(minutes=5):
        raise HTTPException(422, "Timestamp is in the future")
    return max(at, svc.aware(ride.started_at))


# ---------- lifecycle ----------
@router.post("/start", status_code=201)
def start(body: StartIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.client_id:  # idempotent: a retried offline start returns the same ride
        existing = db.scalar(select(Ride).where(Ride.user_id == user.id, Ride.client_id == body.client_id))
        if existing:
            return ride_out(existing, _stat(db, existing.id))
    active = db.scalar(select(Ride).where(Ride.user_id == user.id, Ride.status.in_(("active", "paused"))))
    if active:
        raise HTTPException(409, {"message": "A ride is already in progress", "ride_id": active.id})
    _check_bike(db, user, body.bike_id)
    bike_id = body.bike_id
    if bike_id is None:
        bike_id = db.scalar(select(Bike.id).where(Bike.user_id == user.id, Bike.is_default))
    started = svc.aware(body.started_at) if body.started_at else _now()
    if started > _now() + timedelta(minutes=5):
        raise HTTPException(422, "Timestamp is in the future")
    if body.latitude is not None and body.longitude is not None and validate(Point(body.latitude, body.longitude, 0)):
        body.latitude = body.longitude = None
    ride = Ride(user_id=user.id, bike_id=bike_id, client_id=body.client_id, source=body.source, started_at=started,
                start_latitude=body.latitude, start_longitude=body.longitude, status="active")
    db.add(ride)
    db.commit()
    _add_event(db, ride, "start", started)
    db.commit()
    audit(db, user.id, "ride.start", "ride", ride.id, {"source": body.source})
    return ride_out(ride, None)


@router.post("/{ride_id}/points")
def add_points(ride_id: int, body: PointsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Validated, de-duplicated ingestion. Structurally invalid points are reported back (never silently dropped);
    every valid point is stored raw, and the engine decides afterwards which count towards distance."""
    ride = _owned(db, user, ride_id)
    if ride.status == "completed":
        raise HTTPException(409, "Ride is already finished")
    lo, hi = svc.aware(ride.started_at) - timedelta(hours=1), _now() + timedelta(minutes=5)
    seen = {svc.epoch(t) for (t,) in db.execute(select(RideGpsPoint.recorded_at).where(RideGpsPoint.ride_id == ride.id))}
    stored, duplicate, invalid = 0, 0, []
    for i, p in enumerate(body.points):
        t = svc.aware(p.recorded_at)
        bad = validate(Point(p.latitude, p.longitude, t.timestamp(), p.speed_kmh, p.accuracy_m, p.altitude_m))
        if not bad and not (lo <= t <= hi):
            bad = "bad_timestamp"
        if not bad and p.speed_kmh is not None and not math.isfinite(p.speed_kmh):
            bad = "invalid_speed"
        if bad:
            invalid.append({"index": i, "reason": bad})
            continue
        if t.timestamp() in seen:
            duplicate += 1
            continue
        seen.add(t.timestamp())
        db.add(RideGpsPoint(ride_id=ride.id, latitude=p.latitude, longitude=p.longitude, recorded_at=t,
                            speed_kmh=p.speed_kmh if p.speed_kmh is not None and p.speed_kmh >= 0 else None,
                            accuracy_m=p.accuracy_m, altitude_m=p.altitude_m))
        stored += 1
    try:
        db.commit()
    except IntegrityError:  # concurrent retry hit the unique (ride, time) index
        db.rollback()
        raise HTTPException(409, "Duplicate batch")
    svc.reprocess(db, ride)
    return {"stored": stored, "duplicates": duplicate, "invalid": invalid, "live": svc.live_state(ride, _stat(db, ride.id))}


def _transition(db, user, ride_id, at, frm, to, event):
    ride = _owned(db, user, ride_id)
    if ride.status == to:  # idempotent for offline retries
        return ride
    if ride.status not in frm:
        raise HTTPException(409, f"Ride is {ride.status}")
    when = _clamp_at(ride, at)
    _add_event(db, ride, event, when)
    ride.status = to
    db.commit()
    return ride


@router.post("/{ride_id}/pause")
def pause(ride_id: int, body: AtIn | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ride = _transition(db, user, ride_id, body.at if body else None, ("active",), "paused", "pause")
    svc.reprocess(db, ride)
    return ride_out(ride, _stat(db, ride.id))


@router.post("/{ride_id}/resume")
def resume(ride_id: int, body: AtIn | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ride = _transition(db, user, ride_id, body.at if body else None, ("paused",), "active", "resume")
    svc.reprocess(db, ride)
    return ride_out(ride, _stat(db, ride.id))


@router.post("/{ride_id}/stop")
def stop(ride_id: int, body: AtIn | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ride = _owned(db, user, ride_id)
    if ride.status == "completed":
        return ride_out(ride, _stat(db, ride.id))
    ride.ended_at = _clamp_at(ride, body.at if body else None)
    _add_event(db, ride, "stop", ride.ended_at)
    ride.status = "completed"
    db.commit()
    s = svc.reprocess(db, ride, final=True)
    prefs = svc.get_prefs(db, user.id)
    if prefs.get("reverse_geocode"):  # opt-in: only the start and end coordinates leave the server
        if ride.start_latitude is not None and not ride.start_label:
            ride.start_label = geocode.reverse(ride.start_latitude, ride.start_longitude) or ""
        if ride.end_latitude is not None and not ride.end_label:
            ride.end_label = geocode.reverse(ride.end_latitude, ride.end_longitude) or ""
        db.commit()
    notify(db, user.id, "ride", f"Ride saved: {s['distance_km']:.1f} km",
           f"{s['duration_seconds'] // 60} min, avg {s['average_speed_kmh']} km/h, max {s['max_speed_kmh']} km/h", ref=f"ride:{ride.id}")
    audit(db, user.id, "ride.stop", "ride", ride.id, {"distance_km": s["distance_km"]})
    return ride_out(ride, _stat(db, ride.id))


@router.get("/active")
def active(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.scalar(select(Ride).where(Ride.user_id == user.id, Ride.status.in_(("active", "paused"))))
    if not r:
        return {"ride": None}
    last = db.scalar(select(RideGpsPoint).where(RideGpsPoint.ride_id == r.id, RideGpsPoint.accepted)
                     .order_by(RideGpsPoint.recorded_at.desc()))
    return {"ride": ride_out(r, _stat(db, r.id)),
            "last_point": {"latitude": last.latitude, "longitude": last.longitude, "recorded_at": last.recorded_at,
                           "accuracy_m": last.accuracy_m} if last else None}


# ---------- history ----------
def _range(preset: str | None, start: date | None, end: date | None) -> tuple[date | None, date | None]:
    t = today()
    if preset == "today":
        return t, t
    if preset == "yesterday":
        return t - timedelta(days=1), t - timedelta(days=1)
    if preset == "7d":
        return t - timedelta(days=6), t
    if preset == "30d":
        return t - timedelta(days=29), t
    return start, end


@router.get("")
def list_rides(preset: str | None = Query(None, pattern="^(today|yesterday|7d|30d|custom)$"), start: date | None = None,
               end: date | None = None, bike_id: int | None = None, limit: int = Query(50, ge=1, le=200),
               offset: int = Query(0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    lo, hi = _range(preset, start, end)
    q = select(Ride).where(Ride.user_id == user.id, Ride.status == "completed")
    if bike_id:
        q = q.where(Ride.bike_id == bike_id)
    rides = [r for r in db.scalars(q.order_by(Ride.started_at.desc()))
             if (lo is None or svc.local_date(r.started_at) >= lo) and (hi is None or svc.local_date(r.started_at) <= hi)]
    return {"items": [ride_out(r) for r in rides[offset:offset + limit]], "total": len(rides), "totals": svc.totals(rides)}


@router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = today()
    week_start = t - timedelta(days=t.weekday())
    m_start, m_end = svc.month_bounds(t.year, t.month)
    all_rides = svc.rides_between(db, user.id, date(2000, 1, 1), t)
    day_r = [r for r in all_rides if svc.local_date(r.started_at) == t]
    week_r = [r for r in all_rides if svc.local_date(r.started_at) >= week_start]
    month_r = [r for r in all_rides if svc.local_date(r.started_at) >= m_start]
    # charts
    d30 = svc.by_day([r for r in all_rides if svc.local_date(r.started_at) >= t - timedelta(days=29)], t - timedelta(days=29), t)
    weeks = []
    for i in range(7, -1, -1):
        ws = week_start - timedelta(weeks=i)
        wr = [r for r in all_rides if ws <= svc.local_date(r.started_at) <= ws + timedelta(days=6)]
        weeks.append({"label": ws.strftime("%d %b"), **svc.totals(wr)})
    months, fuel_trend = [], []
    for i in range(11, -1, -1):
        y, m = t.year, t.month - i
        while m < 1:
            y, m = y - 1, m + 12
        a, b = svc.month_bounds(y, m)
        mr = [r for r in all_rides if a <= svc.local_date(r.started_at) <= b]
        months.append({"label": a.strftime("%b %y"), **svc.totals(mr)})
        fuel_trend.append({"label": a.strftime("%b %y"), "amount": svc.fuel_between(db, user.id, a, b)})
    last = all_rides[-20:]
    return {
        "cards": {"today_km": svc.totals(day_r)["distance_km"], "week_km": svc.totals(week_r)["distance_km"],
                  "month_km": svc.totals(month_r)["distance_km"], "total_rides": len(all_rides),
                  "average_speed_kmh": svc.totals(all_rides)["average_speed_kmh"],
                  "max_speed_kmh": svc.totals(all_rides)["max_speed_kmh"],
                  "riding_seconds": sum(r.duration_seconds for r in all_rides),
                  "fuel_total": svc.fuel_between(db, user.id, date(2000, 1, 1), t),
                  "fuel_month": svc.fuel_between(db, user.id, m_start, m_end)},
        "daily_distance": d30, "weekly": weeks, "monthly": months, "fuel_trend": fuel_trend,
        "speed_trend": [{"label": svc.local_date(r.started_at).strftime("%d %b"), "average": r.average_speed_kmh, "max": r.maximum_speed_kmh} for r in last],
        "duration_trend": [{"label": svc.local_date(r.started_at).strftime("%d %b"), "minutes": round(r.duration_seconds / 60, 1)} for r in last],
        "recent": [ride_out(r) for r in reversed(all_rides[-8:])],
    }


@router.get("/routes")
def route_overlay(preset: str | None = Query("30d", pattern="^(today|yesterday|7d|30d|custom)$"), start: date | None = None,
                  end: date | None = None, limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """Simplified tracks of several rides for the Route Maps page, plus the most travelled routes."""
    lo, hi = _range(preset, start, end)
    rides = svc.rides_between(db, user.id, lo or date(2000, 1, 1), hi or today())
    out = []
    for r in reversed(rides[-limit:]):
        rows = list(db.scalars(select(RideGpsPoint).where(RideGpsPoint.ride_id == r.id).order_by(RideGpsPoint.recorded_at)))
        out.append({**ride_out(r), "track": svc.track(rows, 400)})
    return {"rides": out, "popular_routes": svc.popular_routes(rides, 8)}


@router.get("/{ride_id}")
def ride_detail(ride_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _owned(db, user, ride_id)
    rows = list(db.scalars(select(RideGpsPoint).where(RideGpsPoint.ride_id == r.id).order_by(RideGpsPoint.recorded_at)))
    events = list(db.scalars(select(RideEvent).where(RideEvent.ride_id == r.id).order_by(RideEvent.at)))
    speeds = svc.track(rows, 300)
    return {**ride_out(r, _stat(db, r.id)), "track": svc.track(rows), "points_total": len(rows),
            "events": [{"type": e.type, "at": e.at} for e in events],
            "speed_profile": [{"t": p[2], "speed": p[3] or 0} for p in speeds]}


@router.get("/{ride_id}/points")
def raw_points(ride_id: int, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000), rejected_only: bool = False,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _owned(db, user, ride_id)
    q = select(RideGpsPoint).where(RideGpsPoint.ride_id == r.id)
    if rejected_only:
        q = q.where(RideGpsPoint.accepted.is_(False))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(RideGpsPoint.recorded_at).offset(offset).limit(limit)).all()
    return {"total": total, "items": [{"id": p.id, "latitude": p.latitude, "longitude": p.longitude, "recorded_at": p.recorded_at,
                                       "speed_kmh": p.speed_kmh, "computed_speed_kmh": p.computed_speed_kmh,
                                       "accuracy_m": p.accuracy_m, "altitude_m": p.altitude_m, "accepted": p.accepted,
                                       "reject_reason": p.reject_reason} for p in rows]}


@router.put("/{ride_id}")
def update_ride(ride_id: int, body: RideUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _owned(db, user, ride_id)
    data = body.model_dump(exclude_unset=True)
    if "bike_id" in data:
        _check_bike(db, user, data["bike_id"])
    for k, v in data.items():
        setattr(r, k, v)
    db.commit()
    return ride_out(r, _stat(db, r.id))


@router.post("/{ride_id}/reprocess")
def reprocess_ride(ride_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _owned(db, user, ride_id)
    svc.reprocess(db, r, final=r.status == "completed")
    return ride_out(r, _stat(db, r.id))


@router.delete("/{ride_id}", status_code=204)
def delete_ride(ride_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = _owned(db, user, ride_id)
    db.delete(r)
    db.commit()
    audit(db, user.id, "ride.delete", "ride", ride_id, ip=request.client.host if request.client else "")


@router.delete("", status_code=200)
def delete_all(request: Request, confirm: str = Query(""), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Erase the user's whole ride history and every GPS point. Requires ?confirm=DELETE."""
    if confirm != "DELETE":
        raise HTTPException(422, "Add confirm=DELETE to erase all ride history")
    ids = [i for (i,) in db.execute(select(Ride.id).where(Ride.user_id == user.id))]
    if ids:
        db.execute(delete(RideGpsPoint).where(RideGpsPoint.ride_id.in_(ids)))
        db.execute(delete(RideEvent).where(RideEvent.ride_id.in_(ids)))
        db.execute(delete(RideStatistic).where(RideStatistic.ride_id.in_(ids)))
        db.execute(delete(Ride).where(Ride.id.in_(ids)))
        db.commit()
    audit(db, user.id, "ride.delete_all", "ride", "", {"rides": len(ids)}, request.client.host if request.client else "")
    return {"deleted_rides": len(ids)}


@router.post("/compact")
def compact(body: CompactIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Retention: thin the GPS points of old completed rides down to a simplified route. Totals are kept."""
    cutoff = _now() - timedelta(days=body.older_than_days)
    rides = db.scalars(select(Ride).where(Ride.user_id == user.id, Ride.status == "completed", Ride.started_at < cutoff))
    removed = n = 0
    for r in rides:
        stat = _stat(db, r.id)
        if stat and stat.points_compacted_at:
            continue
        removed += svc.compact_points(db, r)
        n += 1
    audit(db, user.id, "ride.compact", "ride", "", {"rides": n, "points_removed": removed})
    return {"rides_compacted": n, "points_removed": removed}


# ---------- analytics ----------
@analytics.get("/daily")
def a_daily(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = day or today()
    rides = svc.rides_between(db, user.id, d, d)
    return {"date": d.isoformat(), **svc.totals(rides), "rides_list": [ride_out(r) for r in rides]}


@analytics.get("/weekly")
def a_weekly(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = day or today()
    start = d - timedelta(days=d.weekday())
    end = start + timedelta(days=6)
    rides = svc.rides_between(db, user.id, start, end)
    prev = svc.rides_between(db, user.id, start - timedelta(days=7), start - timedelta(days=1))
    t, pt = svc.totals(rides), svc.totals(prev)
    days = svc.by_day(rides, start, end)
    return {"start": start.isoformat(), "end": end.isoformat(), **t, "riding_hours": round(t["duration_seconds"] / 3600, 2),
            "riding_days": sum(1 for x in days if x["rides"]), "daily": days, "previous_week": pt,
            "distance_change_pct": round((t["distance_km"] - pt["distance_km"]) / pt["distance_km"] * 100, 1) if pt["distance_km"] else None}


@analytics.get("/monthly")
def a_monthly(year: int | None = None, month: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = today()
    y, m = year or t.year, month or t.month
    if not 1 <= m <= 12:
        raise HTTPException(422, "Invalid month")
    a, b = svc.month_bounds(y, m)
    rides = svc.rides_between(db, user.id, a, b)
    tt = svc.totals(rides)
    fuel = svc.fuel_between(db, user.id, a, b)
    from app.ride.fuel import fuel_summary
    fs = fuel_summary(db, user.id)
    days_elapsed = ((min(b, t) - a).days + 1) if (y, m) == (t.year, t.month) else (b - a).days + 1
    return {"year": y, "month": m, **tt, "average_daily_km": round(tt["distance_km"] / max(1, days_elapsed), 2),
            "fuel_spend": fuel, "fuel_efficiency_kmpl": fs["average_mileage_kmpl"],
            "fuel_cost_per_km": round(fuel / tt["distance_km"], 2) if tt["distance_km"] and fuel else None,
            "daily": svc.by_day(rides, a, b), "popular_routes": svc.popular_routes(rides)}


@analytics.get("/yearly")
def a_yearly(year: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    y = year or today().year
    rides = svc.rides_between(db, user.id, date(y, 1, 1), date(y, 12, 31))
    months = []
    for m in range(1, 13):
        a, b = svc.month_bounds(y, m)
        mr = [r for r in rides if a <= svc.local_date(r.started_at) <= b]
        months.append({"label": a.strftime("%b"), **svc.totals(mr), "fuel": svc.fuel_between(db, user.id, a, b)})
    tt = svc.totals(rides)
    return {"year": y, **tt, "fuel_cost": svc.fuel_between(db, user.id, date(y, 1, 1), date(y, 12, 31)), "months": months,
            "riding_hours": round(tt["duration_seconds"] / 3600, 1)}
