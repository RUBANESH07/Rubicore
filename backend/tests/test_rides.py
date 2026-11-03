"""RubiRide API: lifecycle, ingestion rules, history, analytics, fuel + finance integration, parking, privacy."""
from app.core.config import today as app_today  # the app's own 'today' (India time), not the UTC date
from datetime import datetime, timedelta, timezone

M = 111_195.0
LAT0, LON0 = 19.0760, 72.8777


def iso(t: datetime) -> str:
    return t.isoformat()


def drive_points(t0: datetime, seconds=300, speed=36.0, start_m=0.0, step=2, acc=8.0):
    return [{"latitude": LAT0 + (start_m + speed / 3.6 * i) / M, "longitude": LON0, "recorded_at": iso(t0 + timedelta(seconds=i)),
             "speed_kmh": speed, "accuracy_m": acc, "altitude_m": 12.0} for i in range(0, seconds + 1, step)]


def full_ride(c, minutes_ago=30, seconds=300, bike_id=None):
    t0 = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    r = c.post("/api/rides/start", json={"started_at": iso(t0), "bike_id": bike_id}).json()
    c.post(f"/api/rides/{r['id']}/points", json={"points": drive_points(t0, seconds)})
    done = c.post(f"/api/rides/{r['id']}/stop", json={"at": iso(t0 + timedelta(seconds=seconds))})
    assert done.status_code == 200, done.text
    return done.json()


def test_requires_auth():
    from fastapi.testclient import TestClient
    from app.main import app
    anon = TestClient(app)
    for method, url in [("get", "/api/rides"), ("post", "/api/rides/start"), ("get", "/api/fuel"), ("get", "/api/parking"),
                        ("get", "/api/bikes"), ("get", "/api/ride-analytics/daily")]:
        assert getattr(anon, method)(url).status_code == 401, url


def test_full_ride_lifecycle(client):
    ride = full_ride(client)
    assert ride["status"] == "completed"
    assert abs(ride["total_distance_km"] - 3.0) < 0.06           # 10 m/s for 300 s
    assert abs(ride["average_speed_kmh"] - 36) < 1.5 and abs(ride["maximum_speed_kmh"] - 36) < 1
    assert 295 <= ride["duration_seconds"] <= 305
    assert ride["statistics"]["rejected_points"] == 0
    d = client.get(f"/api/rides/{ride['id']}").json()
    assert d["started_at"].endswith(("Z", "+00:00")) and d["events"][0]["at"].endswith(("Z", "+00:00"))  # never a naive timestamp
    assert d["points_total"] == 151 and len(d["track"]) >= 2
    assert [e["type"] for e in d["events"]] == ["start", "stop"]
    pts = client.get(f"/api/rides/{ride['id']}/points", params={"limit": 10}).json()
    assert pts["total"] == 151 and len(pts["items"]) == 10


def test_pause_and_resume_exclude_paused_time_and_distance(client):
    t0 = datetime.now(timezone.utc) - timedelta(hours=2)
    r = client.post("/api/rides/start", json={"started_at": iso(t0)}).json()
    rid = r["id"]
    client.post(f"/api/rides/{rid}/points", json={"points": drive_points(t0, 120)})                       # 1.2 km
    assert client.post(f"/api/rides/{rid}/pause", json={"at": iso(t0 + timedelta(seconds=120))}).status_code == 200
    # the phone keeps sending a few fixes while paused and then jumps 15 km during a long wait
    client.post(f"/api/rides/{rid}/points", json={"points": drive_points(t0 + timedelta(seconds=200), 20, start_m=1300)})
    assert client.post(f"/api/rides/{rid}/resume", json={"at": iso(t0 + timedelta(seconds=1800))}).status_code == 200
    client.post(f"/api/rides/{rid}/points", json={"points": drive_points(t0 + timedelta(seconds=1810), 120, start_m=15_000)})
    done = client.post(f"/api/rides/{rid}/stop", json={"at": iso(t0 + timedelta(seconds=1930))}).json()
    assert abs(done["total_distance_km"] - 2.4) < 0.1            # 1.2 + 1.2; neither the 15 km jump nor paused fixes count
    assert abs(done["paused_seconds"] - 1680) <= 1
    assert abs(done["duration_seconds"] - 250) <= 3              # 1930 s elapsed - 1680 s paused
    reasons = done["statistics"]["rejected_by_reason"]
    assert reasons.get("paused", 0) >= 5


def test_state_machine_and_idempotency(client):
    t0 = datetime.now(timezone.utc) - timedelta(minutes=10)
    a = client.post("/api/rides/start", json={"client_id": "dev-1", "started_at": iso(t0)})
    assert a.status_code == 201
    again = client.post("/api/rides/start", json={"client_id": "dev-1", "started_at": iso(t0)}).json()
    assert again["id"] == a.json()["id"]                          # a retried offline start returns the same ride
    assert client.post("/api/rides/start", json={}).status_code == 409   # only one ride at a time
    rid = a.json()["id"]
    assert client.post(f"/api/rides/{rid}/resume").status_code == 200    # already active: harmless no-op for offline retries
    assert client.post(f"/api/rides/{rid}/pause").status_code == 200
    assert client.post(f"/api/rides/{rid}/pause").status_code == 200     # retry is harmless
    assert client.get("/api/rides/active").json()["ride"]["status"] == "paused"
    client.post(f"/api/rides/{rid}/stop")
    assert client.post(f"/api/rides/{rid}/stop").status_code == 200      # stop is idempotent
    assert client.post(f"/api/rides/{rid}/pause").status_code == 409     # a finished ride can't be paused
    assert client.post(f"/api/rides/{rid}/points", json={"points": drive_points(t0, 4)}).status_code == 409
    assert client.get("/api/rides/active").json()["ride"] is None


def test_point_validation_and_dedup(client):
    t0 = datetime.now(timezone.utc) - timedelta(minutes=5)
    rid = client.post("/api/rides/start", json={"started_at": iso(t0)}).json()["id"]
    pts = drive_points(t0, 20)
    bad = [{"latitude": 95, "longitude": 10, "recorded_at": iso(t0)},
           {"latitude": 0, "longitude": 0, "recorded_at": iso(t0 + timedelta(seconds=1))},
           {"latitude": LAT0, "longitude": LON0, "recorded_at": iso(t0 + timedelta(days=3))}]
    r = client.post(f"/api/rides/{rid}/points", json={"points": pts + bad}).json()
    assert r["stored"] == len(pts) and [i["reason"] for i in r["invalid"]] == ["invalid_coordinates", "null_island", "bad_timestamp"]
    r2 = client.post(f"/api/rides/{rid}/points", json={"points": pts}).json()
    assert r2["stored"] == 0 and r2["duplicates"] == len(pts)    # replayed batch never double counts
    assert abs(r2["live"]["distance_km"] - 0.2) < 0.02
    assert client.post(f"/api/rides/{rid}/points", json={"points": []}).status_code == 422
    assert client.post(f"/api/rides/{rid}/points", json={"points": [{"latitude": "x", "longitude": 1, "recorded_at": "bad"}]}).status_code == 422


def test_low_accuracy_points_are_kept_but_not_counted(client):
    t0 = datetime.now(timezone.utc) - timedelta(minutes=5)
    rid = client.post("/api/rides/start", json={"started_at": iso(t0)}).json()["id"]
    pts = drive_points(t0, 60)
    for p in pts[5:10]:
        p["accuracy_m"] = 150
    client.post(f"/api/rides/{rid}/points", json={"points": pts})
    done = client.post(f"/api/rides/{rid}/stop", json={"at": iso(t0 + timedelta(seconds=60))}).json()
    assert done["statistics"]["rejected_by_reason"] == {"low_accuracy": 5}
    raw = client.get(f"/api/rides/{rid}/points", params={"rejected_only": True}).json()
    assert raw["total"] == 5 and all(p["reject_reason"] == "low_accuracy" for p in raw["items"])   # raw data retained
    # tightening settings and reprocessing is possible because nothing was discarded
    client.put("/api/ride-preferences", json={"max_accuracy_m": 200})
    again = client.post(f"/api/rides/{rid}/reprocess").json()
    assert again["statistics"]["rejected_points"] == 0


def test_history_filters_and_edit_delete(client):
    full_ride(client, minutes_ago=30)
    old = full_ride(client, minutes_ago=60 * 24 * 10, seconds=120)
    assert client.get("/api/rides", params={"preset": "today"}).json()["total"] >= 1
    r30 = client.get("/api/rides", params={"preset": "30d"}).json()
    assert r30["total"] == 2 and r30["totals"]["rides"] == 2
    assert client.get("/api/rides", params={"preset": "7d"}).json()["total"] == 1
    day = (app_today() - timedelta(days=10)).isoformat()
    assert client.get("/api/rides", params={"preset": "custom", "start": day, "end": day}).json()["total"] >= 1
    u = client.put(f"/api/rides/{old['id']}", json={"title": "Weekend run", "start_label": "Home", "end_label": "Lonavala"}).json()
    assert u["title"] == "Weekend run" and u["end_label"] == "Lonavala"
    assert client.delete(f"/api/rides/{old['id']}").status_code == 204
    assert client.get(f"/api/rides/{old['id']}").status_code == 404


def test_overview_and_analytics(client):
    full_ride(client, minutes_ago=30)
    ov = client.get("/api/rides/overview").json()
    assert ov["cards"]["total_rides"] == 1 and abs(ov["cards"]["today_km"] - 3.0) < 0.1
    assert len(ov["daily_distance"]) == 30 and len(ov["weekly"]) == 8 and len(ov["monthly"]) == 12
    d = client.get("/api/ride-analytics/daily").json()
    assert d["rides"] == 1 and d["distance_km"] > 2.9
    w = client.get("/api/ride-analytics/weekly").json()
    assert w["riding_days"] == 1 and len(w["daily"]) == 7
    m = client.get("/api/ride-analytics/monthly").json()
    assert m["rides"] == 1 and m["average_daily_km"] > 0
    y = client.get("/api/ride-analytics/yearly").json()
    assert y["rides"] == 1 and len(y["months"]) == 12


def test_fuel_cost_mileage_and_finance_integration(client):
    bike = client.post("/api/bikes", json={"name": "Duke", "tank_capacity_l": 13}).json()
    assert bike["is_default"] is True
    today = app_today()
    first = client.post("/api/fuel", json={"date": str(today - timedelta(days=20)), "odometer_km": 10_000, "litres": 10,
                                           "price_per_litre": 100, "station": "HP", "bike_id": bike["id"]})
    assert first.status_code == 201 and first.json()["total_amount"] == 1000.0     # litres x price
    client.post("/api/fuel", json={"date": str(today - timedelta(days=10)), "odometer_km": 10_150, "litres": 3, "price_per_litre": 100,
                                   "is_full_tank": False, "bike_id": bike["id"]})   # partial fill
    last = client.post("/api/fuel", json={"date": str(today), "odometer_km": 10_300, "litres": 5, "price_per_litre": 102,
                                          "bike_id": bike["id"]}).json()
    a = client.get("/api/fuel/analytics").json()
    assert a["reliable"] and len(a["segments"]) == 1
    seg = a["segments"][0]
    assert seg["distance_km"] == 300 and seg["litres"] == 8.0                       # 3 + 5 litres burned over 300 km
    assert abs(seg["mileage_kmpl"] - 37.5) < 0.01
    assert a["average_mileage_kmpl"] == 37.5 and abs(a["cost_per_km"] - 2.7) < 0.01 and a["total_litres"] == 18
    assert a["total_spent"] == 1000 + 300 + 510
    # integration: each fill became an expense in the finance tracker
    txs = client.get("/api/transactions", params={"q": "Fuel"}).json()
    assert txs["total"] == 3 and all(t["category_name"] == "Petrol / Fuel" for t in txs["items"])
    assert client.get("/api/analytics/monthly").json()["total_expenses"] >= 510
    # deleting a fuel entry removes its linked expense
    assert client.delete(f"/api/fuel/{last['id']}").status_code == 204
    assert client.get("/api/transactions", params={"q": "Fuel"}).json()["total"] == 2


def test_mileage_not_guessed_without_full_to_full(client):
    today = app_today()
    client.post("/api/fuel", json={"date": str(today), "odometer_km": 500, "litres": 5, "price_per_litre": 100, "is_full_tank": False})
    a = client.get("/api/fuel/analytics").json()
    assert a["reliable"] is False and a["average_mileage_kmpl"] is None and "full-tank" in a["note"]
    assert client.post("/api/fuel", json={"date": str(today), "odometer_km": 600, "litres": 5, "price_per_litre": 100,
                                          "total_amount": 900}).status_code == 422       # total contradicts litres x price
    assert client.post("/api/fuel", json={"date": str(today), "odometer_km": 600, "litres": -1, "price_per_litre": 100}).status_code == 422
    assert client.post("/api/fuel", json={"date": str(today - timedelta(days=5)), "odometer_km": 900, "litres": 5,
                                          "price_per_litre": 100}).status_code == 422   # not recorded as an expense? see below


def test_fuel_without_expense_record(client):
    today = app_today()
    r = client.post("/api/fuel", json={"date": str(today), "odometer_km": 100, "litres": 4, "price_per_litre": 90, "record_expense": False})
    assert r.status_code == 201 and r.json()["transaction_id"] is None
    assert client.get("/api/transactions", params={"q": "Fuel"}).json()["total"] == 0


def test_parking(client):
    p = client.post("/api/parking", json={"latitude": LAT0, "longitude": LON0, "accuracy_m": 9, "note": "Level 2, pillar B"})
    assert p.status_code == 201 and "destination=19.076" in p.json()["navigate_url"]
    p2 = client.post("/api/parking", json={"latitude": LAT0 + 0.01, "longitude": LON0, "note": "Mall"}).json()
    got = client.get("/api/parking").json()
    assert got["current"]["id"] == p2["id"] and len(got["history"]) == 2           # only the newest is current
    assert client.post("/api/parking", json={"latitude": 123, "longitude": 0}).status_code == 422
    assert client.put(f"/api/parking/{p2['id']}", json={"note": "Mall, B1"}).json()["note"] == "Mall, B1"
    client.put(f"/api/parking/{p2['id']}", json={"is_active": False})
    assert client.get("/api/parking").json()["current"] is None


def test_delete_all_history_and_compaction(client):
    full_ride(client, minutes_ago=60 * 24 * 40, seconds=240)
    assert client.post("/api/rides/compact", json={"older_than_days": 30}).json()["points_removed"] > 100
    d = client.get("/api/rides", params={"preset": "custom"}).json()["items"][0]
    detail = client.get(f"/api/rides/{d['id']}").json()
    assert detail["points_total"] < 20 and abs(detail["total_distance_km"] - 2.4) < 0.1       # route shape + totals survive
    assert detail["statistics"]["points_compacted"] is True
    assert client.delete("/api/rides").status_code == 422                                      # needs explicit confirmation
    assert client.delete("/api/rides", params={"confirm": "DELETE"}).json()["deleted_rides"] == 1
    assert client.get("/api/rides").json()["total"] == 0


def test_exports(client):
    full_ride(client)
    csv = client.get("/api/ride-reports/export", params={"kind": "rides"})
    assert csv.status_code == 200 and "distance_km" in csv.text and csv.text.count("\n") >= 2
    pdf = client.get("/api/ride-reports/export", params={"kind": "monthly", "format": "pdf"})
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert client.get("/api/ride-reports/export", params={"kind": "nope"}).status_code == 422


def test_device_token_for_native_apps(make_client):
    make_client()
    from fastapi.testclient import TestClient
    from app.main import app
    anon = TestClient(app)
    assert anon.post("/api/auth/token", json={"pin": "0000"}).status_code == 401
    tok = anon.post("/api/auth/token", json={"pin": "1224"}).json()
    assert anon.get("/api/rides", headers={"Authorization": f"Bearer {tok['access_token']}"}).status_code == 200


def test_assistant_answers_ride_questions_from_private_data(client):
    full_ride(client)
    r = client.post("/api/chat/message", json={"message": "How far did I ride this week?"}).json()
    assert [s["type"] for s in r["sources"]] == ["private"] and r["sources"][0]["tool"] == "get_riding_summary"
    assert "3.0" in r["reply"] or "2.9" in r["reply"] or "3.1" in r["reply"]
