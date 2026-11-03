from collections import defaultdict
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import today
from app.models import FuelEntry
from app.ride import service as svc


def fuel_summary(db: Session, user_id: int, bike_id: int | None = None) -> dict:
    q = select(FuelEntry).where(FuelEntry.user_id == user_id)
    if bike_id:
        q = q.where(FuelEntry.bike_id == bike_id)
    entries = list(db.scalars(q.order_by(FuelEntry.date, FuelEntry.odometer_km)))
    segs = svc.mileage_segments(entries)
    for s in segs:  # GPS distance for the same window: a cross-check only, never used for consumption
        a, b = date.fromisoformat(s["from_date"]), date.fromisoformat(s["to_date"])
        s["gps_km"] = round(sum(r.total_distance_km for r in svc.rides_between(db, user_id, a, b)), 1)
    km = sum(s["distance_km"] for s in segs)
    litres = sum(s["litres"] for s in segs)
    cost = sum(s["cost"] for s in segs)
    t = today()
    monthly = defaultdict(float)
    for e in entries:
        monthly[(e.date.year, e.date.month)] += float(e.total_amount)
    series = []
    for i in range(11, -1, -1):
        y, m = t.year, t.month - i
        while m < 1:
            y, m = y - 1, m + 12
        series.append({"label": date(y, m, 1).strftime("%b %y"), "amount": round(monthly[(y, m)], 2)})
    full = sum(1 for e in entries if e.is_full_tank)
    return {
        "total_spent": round(sum(float(e.total_amount) for e in entries), 2),
        "total_litres": round(sum(e.litres for e in entries), 2),
        "entries": len(entries),
        "average_mileage_kmpl": round(km / litres, 2) if litres else None,
        "cost_per_km": round(cost / km, 2) if km else None,
        "measured_distance_km": round(km, 1),
        "segments": segs,
        "monthly": series,
        "reliable": bool(segs),
        "note": None if segs else (
            "Mileage needs two full-tank fill-ups with odometer readings. Tick “full tank” when you fill to the brim; "
            f"you have {full} so far." if full < 2 else "Odometer readings must increase between full-tank fill-ups."),
    }
