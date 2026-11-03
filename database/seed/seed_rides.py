"""Development sample data for RubiRide: a bike, ~45 days of synthetic rides, fuel fill-ups and a parking spot.
The GPS tracks are generated (waypoints + noise + traffic-light stops); they are not real locations of anyone."""
import math
import random
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models import (Account, Bike, BikeSetting, Category, FuelEntry, Ride, RideEvent, RideGpsPoint, SavedLocation,
                        Transaction)
from app.ride import service as svc

M_LAT = 111_195.0
HOME, OFFICE, LAKE, MARINE = (19.1197, 72.8468), (19.1176, 72.9060), (19.0728, 72.8826), (18.9440, 72.8230)
STOP_LABELS = {HOME: "Home, Andheri", OFFICE: "Office, Powai", LAKE: "Kurla", MARINE: "Marine Drive"}


def _path(waypoints, rnd, cruise_kmh, step=2.0):
    """Points along the waypoints at ~cruise speed with curvy offsets, GPS noise and a few red-light stops."""
    pts, t, speed = [], 0.0, 0.0
    for (a, b) in zip(waypoints, waypoints[1:]):
        dlat, dlon = (b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LAT * math.cos(math.radians(a[0]))
        length = math.hypot(dlat, dlon)
        pos, stop_until = 0.0, 0.0
        while pos < length:
            if t >= stop_until and rnd.random() < 0.004:
                stop_until = t + rnd.uniform(15, 60)
            target = 0.0 if t < stop_until else cruise_kmh * rnd.uniform(0.6, 1.25)
            speed += (target - speed) * 0.35
            pos = min(length, pos + max(0.0, speed) / 3.6 * step)
            f = pos / length
            wiggle = 60 * math.sin(f * math.pi * 5) * math.sin(f * math.pi)
            lat = a[0] + (b[0] - a[0]) * f + (-dlon / length) * wiggle / M_LAT
            lon = a[1] + (b[1] - a[1]) * f + (dlat / length) * wiggle / (M_LAT * math.cos(math.radians(a[0])))
            acc = rnd.uniform(4, 14)
            noise = acc * 0.35
            pts.append((lat + rnd.gauss(0, noise) / M_LAT, lon + rnd.gauss(0, noise) / M_LAT, t,
                        round(max(0.0, speed + rnd.gauss(0, 0.8)), 1), round(acc, 1), 14 + 6 * math.sin(f * 3) + rnd.gauss(0, .4)))
            t += step
    return pts


def seed_rides(db, user, today: date):
    if db.scalar(select(Ride.id).where(Ride.user_id == user.id)):
        return 0
    rnd = random.Random(7)
    bike = Bike(user_id=user.id, name="Duke 200", make="KTM", model="Duke 200", year=2022, registration="MH 02 AB 1234", is_default=True)
    db.add(bike)
    db.flush()
    db.add(BikeSetting(bike_id=bike.id, tank_capacity_l=13.4, expected_mileage_kmpl=35, initial_odometer_km=8_000, service_interval_km=5_000))
    plans = []
    for back in range(45, 0, -1):
        d = today - timedelta(days=back)
        if d.weekday() < 5 and rnd.random() < 0.85:
            plans += [(d, 9, [HOME, OFFICE], 32), (d, 18, [OFFICE, LAKE, HOME], 30)]
        elif d.weekday() >= 5 and rnd.random() < 0.7:
            plans.append((d, 7, [HOME, MARINE, HOME], 48) if d.weekday() == 6 else (d, 11, [HOME, LAKE, HOME], 36))
    total_km, rides = 0.0, []
    for d, hour, wps, cruise in plans:
        wps = [(p[0] + rnd.uniform(-.0008, .0008), p[1] + rnd.uniform(-.0008, .0008)) for p in wps]
        pts = _path(wps, rnd, cruise)
        local = datetime(d.year, d.month, d.day, hour, rnd.randint(0, 40), tzinfo=timezone.utc) - timedelta(hours=5, minutes=30)
        r = Ride(user_id=user.id, bike_id=bike.id, source="mobile", started_at=local, status="completed",
                 ended_at=local + timedelta(seconds=pts[-1][2]), start_label=STOP_LABELS.get(HOME if wps[0][0] > 19.11 and wps[0][1] < 72.9 else OFFICE, ""),
                 end_label="")
        db.add(r)
        db.flush()
        r.start_label = next((v for k, v in STOP_LABELS.items() if abs(k[0] - wps[0][0]) < .01 and abs(k[1] - wps[0][1]) < .01), "")
        r.end_label = next((v for k, v in STOP_LABELS.items() if abs(k[0] - wps[-1][0]) < .01 and abs(k[1] - wps[-1][1]) < .01), "")
        db.add_all([RideEvent(ride_id=r.id, type="start", at=local), RideEvent(ride_id=r.id, type="stop", at=r.ended_at)])
        db.add_all([RideGpsPoint(ride_id=r.id, latitude=la, longitude=lo, recorded_at=local + timedelta(seconds=t), speed_kmh=sp,
                                 accuracy_m=ac, altitude_m=al) for la, lo, t, sp, ac, al in pts])
        db.commit()
        s = svc.reprocess(db, r, final=True)
        total_km += s["distance_km"]
        rides.append((d, total_km))
    # fuel fill-ups every ~10 days; odometer follows the GPS distance (+ a little for rides not tracked)
    acc = db.scalar(select(Account).where(Account.user_id == user.id, Account.type == "bank"))
    cat = next((c for c in db.scalars(select(Category).where(Category.user_id == user.id)) if "Fuel" in c.name), None)
    odo0, last_odo = 8_000.0, 8_000.0
    for i, day in enumerate(range(40, -1, -10)):
        d = today - timedelta(days=day)
        km_so_far = max([k for dd, k in rides if dd <= d] or [0.0])
        odo = round(odo0 + km_so_far * 1.04, 0)
        litres = round(max(2.0, (odo - last_odo) / rnd.uniform(33, 38)) if i else 9.0, 2)
        price = Decimal(str(round(rnd.uniform(102, 106), 2)))
        total = (Decimal(str(litres)) * price).quantize(Decimal("0.01"))
        tx = None
        if acc:
            tx = Transaction(user_id=user.id, account_id=acc.id, type="expense", amount=total, date=d, category_id=cat.id if cat else None,
                             payment_method="upi", description=f"Fuel - Indian Oil ({litres:g} L)")
            db.add(tx)
            db.flush()
        db.add(FuelEntry(user_id=user.id, bike_id=bike.id, date=d, odometer_km=odo, litres=litres, price_per_litre=price, total_amount=total,
                         station="Indian Oil", is_full_tank=True, transaction_id=tx.id if tx else None))
        last_odo = odo
    db.add(SavedLocation(user_id=user.id, kind="parking", latitude=OFFICE[0] + .0004, longitude=OFFICE[1] + .0006, accuracy_m=8,
                         note="Basement level 2, near lift B"))
    db.commit()
    return len(plans)
