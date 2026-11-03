"""RubiRide: bikes, fuel (with finance integration), parking, maintenance, preferences and report export."""
import csv
import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.transactions import _budget_alerts
from app.core.config import today
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import (Account, Bike, BikeSetting, Category, FuelEntry, MaintenanceRecord, Ride, SavedLocation,
                        Transaction, User, UserPreference)
from app.ride import service as svc
from app.ride.fuel import fuel_summary
from app.ride.gps import Point, validate
from app.services.common import audit

router = APIRouter(tags=["rubiride"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


# ============================== bikes ==============================
class BikeIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    make: str = Field(default="", max_length=80)
    model: str = Field(default="", max_length=80)
    year: int | None = Field(default=None, ge=1950, le=2100)
    registration: str = Field(default="", max_length=32)
    is_default: bool = False
    tank_capacity_l: float | None = Field(default=None, gt=0, le=60)
    expected_mileage_kmpl: float | None = Field(default=None, gt=0, le=200)
    initial_odometer_km: float | None = Field(default=None, ge=0)
    service_interval_km: float | None = Field(default=None, gt=0)


def bike_out(b: Bike, s: BikeSetting | None) -> dict:
    return {"id": b.id, "name": b.name, "make": b.make, "model": b.model, "year": b.year, "registration": b.registration,
            "is_default": b.is_default, "tank_capacity_l": s.tank_capacity_l if s else None,
            "expected_mileage_kmpl": s.expected_mileage_kmpl if s else None,
            "initial_odometer_km": s.initial_odometer_km if s else None,
            "service_interval_km": s.service_interval_km if s else None}


def _bike(db, user, bike_id) -> Bike:
    b = db.get(Bike, bike_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "Bike not found")
    return b


def _save_bike(db: Session, user: User, b: Bike, body: BikeIn):
    for k in ("name", "make", "model", "year", "registration"):
        setattr(b, k, getattr(body, k))
    others = db.scalar(select(Bike.id).where(Bike.user_id == user.id, Bike.id != (b.id or 0))) is not None
    if body.is_default or not others:  # the only bike is always the default
        for other in db.scalars(select(Bike).where(Bike.user_id == user.id, Bike.is_default)):
            other.is_default = False
        b.is_default = True
    else:
        b.is_default = False
    db.add(b)
    db.flush()
    s = db.scalar(select(BikeSetting).where(BikeSetting.bike_id == b.id)) or BikeSetting(bike_id=b.id)
    for k in ("tank_capacity_l", "expected_mileage_kmpl", "initial_odometer_km", "service_interval_km"):
        setattr(s, k, getattr(body, k))
    db.add(s)
    db.commit()
    return bike_out(b, s)


@router.get("/bikes")
def list_bikes(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bikes = db.scalars(select(Bike).where(Bike.user_id == user.id).order_by(Bike.id)).all()
    sets = {s.bike_id: s for s in db.scalars(select(BikeSetting).where(BikeSetting.bike_id.in_([b.id for b in bikes] or [0])))}
    return [bike_out(b, sets.get(b.id)) for b in bikes]


@router.post("/bikes", status_code=201)
def create_bike(body: BikeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _save_bike(db, user, Bike(user_id=user.id), body)


@router.put("/bikes/{bike_id}")
def update_bike(bike_id: int, body: BikeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _save_bike(db, user, _bike(db, user, bike_id), body)


@router.delete("/bikes/{bike_id}", status_code=204)
def delete_bike(bike_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = _bike(db, user, bike_id)
    db.delete(b)  # rides and fuel entries stay (bike_id becomes NULL)
    db.commit()
    audit(db, user.id, "bike.delete", "bike", bike_id, ip=_ip(request))


# ============================== fuel ==============================
class FuelIn(BaseModel):
    date: date
    odometer_km: float = Field(ge=0, le=2_000_000)
    litres: float = Field(gt=0, le=100)
    price_per_litre: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    total_amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    station: str = Field(default="", max_length=120)
    notes: str | None = Field(default=None, max_length=1000)
    is_full_tank: bool = True
    bike_id: int | None = None
    record_expense: bool = True        # also create a RubiCore expense transaction
    account_id: int | None = None

    @model_validator(mode="after")
    def _total(self):
        calc = (Decimal(str(self.litres)) * self.price_per_litre).quantize(Decimal("0.01"))
        if self.total_amount is None:
            self.total_amount = calc
        elif abs(self.total_amount - calc) > max(Decimal("1.00"), calc * Decimal("0.01")):
            raise ValueError(f"Total {self.total_amount} doesn't match litres x price ({calc})")
        return self


def fuel_out(e: FuelEntry) -> dict:
    return {"id": e.id, "date": e.date.isoformat(), "odometer_km": e.odometer_km, "litres": e.litres,
            "price_per_litre": float(e.price_per_litre), "total_amount": float(e.total_amount), "station": e.station,
            "notes": e.notes, "is_full_tank": e.is_full_tank, "bike_id": e.bike_id, "transaction_id": e.transaction_id}


def _fuel_owned(db, user, fid) -> FuelEntry:
    e = db.get(FuelEntry, fid)
    if not e or e.user_id != user.id:
        raise HTTPException(404, "Fuel entry not found")
    return e


def _fuel_category(db: Session, user: User) -> Category | None:
    cats = db.scalars(select(Category).where(Category.user_id == user.id, Category.type == "expense")).all()
    return next((c for c in cats if "fuel" in c.name.lower() or "petrol" in c.name.lower()), None)


def _check_odometer(db: Session, user: User, body: FuelIn, exclude_id: int | None = None):
    q = select(FuelEntry).where(FuelEntry.user_id == user.id, FuelEntry.bike_id == body.bike_id)
    for e in db.scalars(q):
        if e.id == exclude_id:
            continue
        if (e.date < body.date and e.odometer_km > body.odometer_km) or (e.date > body.date and e.odometer_km < body.odometer_km):
            raise HTTPException(422, f"Odometer {body.odometer_km:g} km conflicts with the entry on {e.date} ({e.odometer_km:g} km)")


@router.post("/fuel", status_code=201)
def add_fuel(body: FuelIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.bike_id is not None:
        _bike(db, user, body.bike_id)
    _check_odometer(db, user, body)
    e = FuelEntry(user_id=user.id, bike_id=body.bike_id, date=body.date, odometer_km=body.odometer_km, litres=body.litres,
                  price_per_litre=body.price_per_litre, total_amount=body.total_amount, station=body.station,
                  notes=body.notes, is_full_tank=body.is_full_tank)
    db.add(e)
    db.flush()
    if body.record_expense:  # integration with the RubiCore finance tracker (same database, same user)
        acc_id = body.account_id
        if acc_id is not None:
            acc = db.get(Account, acc_id)
            if not acc or acc.user_id != user.id:
                raise HTTPException(422, "Unknown account")
        else:
            acc = db.scalar(select(Account).where(Account.user_id == user.id, Account.is_active).order_by(Account.type.desc(), Account.id))
            if not acc:
                raise HTTPException(422, "Create an account first, or turn off “record as expense”")
        cat = _fuel_category(db, user)
        tx = Transaction(user_id=user.id, account_id=acc.id, type="expense", amount=body.total_amount, date=body.date,
                         category_id=cat.id if cat else None, payment_method="other",
                         description=f"Fuel{' - ' + body.station if body.station else ''} ({body.litres:g} L)", notes=body.notes)
        db.add(tx)
        db.flush()
        e.transaction_id = tx.id
    db.commit()
    if e.transaction_id:
        _budget_alerts(db, user, db.get(Transaction, e.transaction_id))
    return fuel_out(e)


@router.put("/fuel/{fuel_id}")
def update_fuel(fuel_id: int, body: FuelIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = _fuel_owned(db, user, fuel_id)
    if body.bike_id is not None:
        _bike(db, user, body.bike_id)
    _check_odometer(db, user, body, exclude_id=e.id)
    for k in ("date", "odometer_km", "litres", "price_per_litre", "total_amount", "station", "notes", "is_full_tank", "bike_id"):
        setattr(e, k, getattr(body, k))
    tx = db.get(Transaction, e.transaction_id) if e.transaction_id else None
    if tx and tx.user_id == user.id:  # keep the linked expense in step
        tx.amount, tx.date, tx.notes = body.total_amount, body.date, body.notes
        tx.description = f"Fuel{' - ' + body.station if body.station else ''} ({body.litres:g} L)"
    db.commit()
    return fuel_out(e)


@router.delete("/fuel/{fuel_id}", status_code=204)
def delete_fuel(fuel_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = _fuel_owned(db, user, fuel_id)
    tx = db.get(Transaction, e.transaction_id) if e.transaction_id else None
    if tx and tx.user_id == user.id:
        db.delete(tx)
    db.delete(e)
    db.commit()
    audit(db, user.id, "fuel.delete", "fuel", fuel_id, {"linked_expense_deleted": tx is not None}, _ip(request))


@router.get("/fuel")
def list_fuel(bike_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = select(FuelEntry).where(FuelEntry.user_id == user.id)
    if bike_id:
        q = q.where(FuelEntry.bike_id == bike_id)
    return [fuel_out(e) for e in db.scalars(q.order_by(FuelEntry.date.desc(), FuelEntry.odometer_km.desc()))]


@router.get("/fuel/analytics")
def fuel_analytics(bike_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return fuel_summary(db, user.id, bike_id)


# ============================== parking ==============================
class ParkingIn(BaseModel):
    latitude: float
    longitude: float
    accuracy_m: float | None = Field(default=None, ge=0)
    note: str = Field(default="", max_length=300)


def parking_out(p: SavedLocation) -> dict:
    return {"id": p.id, "latitude": p.latitude, "longitude": p.longitude, "accuracy_m": p.accuracy_m, "note": p.note,
            "saved_at": p.saved_at, "is_active": p.is_active,
            "navigate_url": f"https://www.google.com/maps/dir/?api=1&destination={p.latitude},{p.longitude}&travelmode=walking"}


@router.post("/parking", status_code=201)
def save_parking(body: ParkingIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if validate(Point(body.latitude, body.longitude, 0, accuracy_m=body.accuracy_m)):
        raise HTTPException(422, "Invalid coordinates")
    for old in db.scalars(select(SavedLocation).where(SavedLocation.user_id == user.id, SavedLocation.kind == "parking",
                                                      SavedLocation.is_active)):
        old.is_active = False  # only the newest parking spot is "current"
    p = SavedLocation(user_id=user.id, kind="parking", latitude=body.latitude, longitude=body.longitude,
                      accuracy_m=body.accuracy_m, note=body.note)
    db.add(p)
    db.commit()
    return parking_out(p)


@router.get("/parking")
def list_parking(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(SavedLocation).where(SavedLocation.user_id == user.id, SavedLocation.kind == "parking")
                      .order_by(SavedLocation.saved_at.desc()).limit(50)).all()
    return {"current": next((parking_out(p) for p in rows if p.is_active), None), "history": [parking_out(p) for p in rows]}


class ParkingUpdate(BaseModel):
    note: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None


def _park(db, user, pid) -> SavedLocation:
    p = db.get(SavedLocation, pid)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Not found")
    return p


@router.put("/parking/{pid}")
def update_parking(pid: int, body: ParkingUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _park(db, user, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return parking_out(p)


@router.delete("/parking/{pid}", status_code=204)
def delete_parking(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_park(db, user, pid))
    db.commit()


# ============================== maintenance ==============================
class MaintIn(BaseModel):
    date: date
    kind: str = Field(min_length=1, max_length=80)
    odometer_km: float | None = Field(default=None, ge=0)
    cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    notes: str | None = Field(default=None, max_length=1000)
    bike_id: int | None = None


def maint_out(m: MaintenanceRecord) -> dict:
    return {"id": m.id, "date": m.date.isoformat(), "kind": m.kind, "odometer_km": m.odometer_km, "cost": float(m.cost),
            "notes": m.notes, "bike_id": m.bike_id}


@router.get("/maintenance")
def list_maintenance(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [maint_out(m) for m in db.scalars(select(MaintenanceRecord).where(MaintenanceRecord.user_id == user.id)
                                             .order_by(MaintenanceRecord.date.desc()))]


@router.post("/maintenance", status_code=201)
def add_maintenance(body: MaintIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.bike_id is not None:
        _bike(db, user, body.bike_id)
    m = MaintenanceRecord(user_id=user.id, **body.model_dump())
    db.add(m)
    db.commit()
    return maint_out(m)


@router.delete("/maintenance/{mid}", status_code=204)
def delete_maintenance(mid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    m = db.get(MaintenanceRecord, mid)
    if not m or m.user_id != user.id:
        raise HTTPException(404, "Not found")
    db.delete(m)
    db.commit()


# ============================== preferences ==============================
class PrefsIn(BaseModel):
    distance_unit: str | None = Field(default=None, pattern="^(km|mi)$")
    max_accuracy_m: int | None = Field(default=None, ge=10, le=200)
    reverse_geocode: bool | None = None
    retention_days: int | None = Field(default=None, ge=7, le=3650)
    keep_screen_on: bool | None = None


@router.get("/ride-preferences")
def get_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return svc.get_prefs(db, user.id)


@router.put("/ride-preferences")
def set_preferences(body: PrefsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    data = dict((row.data or {}) if row else {})
    data.update(body.model_dump(exclude_unset=True))
    if row:
        row.data = data
    else:
        db.add(UserPreference(user_id=user.id, data=data))
    db.commit()
    return svc.get_prefs(db, user.id)


# ============================== reports ==============================
def _fmt_dur(s: int) -> str:
    return f"{s // 3600}h {s % 3600 // 60:02d}m"


def _table(kind: str, db: Session, user: User, start, end, year, month) -> tuple[str, list[list]]:
    t = today()
    if kind == "rides":
        end = end or t
        start = start or end - timedelta(days=89)
        rides = svc.rides_between(db, user.id, start, end)
        rows = [["date", "start", "end", "start_location", "end_location", "distance_km", "duration", "avg_kmh", "max_kmh"]]
        for r in reversed(rides):
            rows.append([svc.local_date(r.started_at), svc.aware(r.started_at).strftime("%H:%M"),
                         svc.aware(r.ended_at).strftime("%H:%M") if r.ended_at else "",
                         r.start_label or (f"{r.start_latitude:.4f},{r.start_longitude:.4f}" if r.start_latitude is not None else ""),
                         r.end_label or (f"{r.end_latitude:.4f},{r.end_longitude:.4f}" if r.end_latitude is not None else ""),
                         f"{r.total_distance_km:.2f}", _fmt_dur(r.duration_seconds), r.average_speed_kmh, r.maximum_speed_kmh])
        return f"Rides {start} to {end}", rows
    if kind == "monthly":
        y, m = year or t.year, month or t.month
        a, b = svc.month_bounds(y, m)
        rides = svc.rides_between(db, user.id, a, b)
        tt, fuel = svc.totals(rides), svc.fuel_between(db, user.id, a, b)
        rows = [["metric", "value"], ["rides", tt["rides"]], ["distance_km", tt["distance_km"]],
                ["riding_time", _fmt_dur(tt["duration_seconds"])], ["average_speed_kmh", tt["average_speed_kmh"]],
                ["max_speed_kmh", tt["max_speed_kmh"]], ["fuel_spend", fuel], [], ["date", "distance_km", "rides"]]
        rows += [[d["date"], d["distance_km"], d["rides"]] for d in svc.by_day(rides, a, b)]
        return f"Monthly report {y}-{m:02d}", rows
    if kind == "yearly":
        y = year or t.year
        rows = [["month", "rides", "distance_km", "riding_time", "avg_kmh", "fuel_spend"]]
        for m in range(1, 13):
            a, b = svc.month_bounds(y, m)
            tt = svc.totals(svc.rides_between(db, user.id, a, b))
            rows.append([a.strftime("%b"), tt["rides"], tt["distance_km"], _fmt_dur(tt["duration_seconds"]),
                         tt["average_speed_kmh"], svc.fuel_between(db, user.id, a, b)])
        return f"Yearly report {y}", rows
    if kind == "fuel":
        rows = [["date", "odometer_km", "litres", "price_per_litre", "total", "full_tank", "station"]]
        for e in db.scalars(select(FuelEntry).where(FuelEntry.user_id == user.id).order_by(FuelEntry.date.desc())):
            rows.append([e.date, e.odometer_km, e.litres, float(e.price_per_litre), float(e.total_amount), e.is_full_tank, e.station])
        return "Fuel log", rows
    raise HTTPException(422, "kind must be rides, monthly, yearly or fuel")


def _pdf(title: str, rows: list[list]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), title=title, leftMargin=28, rightMargin=28, topMargin=28, bottomMargin=28)
    st = getSampleStyleSheet()
    body = [[str(c) for c in r] for r in rows if r] or [["No data"]]
    table = Table(body, repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                               ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                               ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")])]))
    doc.build([Paragraph(f"RubiRide - {title}", st["Title"]), Paragraph(f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC", st["Normal"]),
               Spacer(1, 10), table])
    return buf.getvalue()


@router.get("/ride-reports/export")
def export(request: Request, kind: str = "rides", format: str = Query("csv", pattern="^(csv|pdf)$"), start: date | None = None,
           end: date | None = None, year: int | None = None, month: int | None = None, db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    title, rows = _table(kind, db, user, start, end, year, month)
    audit(db, user.id, "ride.report_export", "report", kind, {"format": format}, _ip(request))
    name = title.lower().replace(" ", "_")
    if format == "pdf":
        return Response(_pdf(title, rows), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
