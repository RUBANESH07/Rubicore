"""The phone app and the website share one backend. This drives the API the way the mobile app does: no cookies, only a bearer token."""
from app.core.config import today as app_today  # the app's own 'today' (India time), not the UTC date
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app

M = 111_195.0


@pytest.fixture()
def phone(make_client, request):
    """A cookie-less client that opens with POST /auth/token and the PIN, like the app's PIN screen."""
    make_client()
    c = TestClient(app)                                          # a separate client: no cookies at all
    r = c.post("/api/auth/token", json={"pin": "1224"})
    assert r.status_code == 200 and r.json()["token_type"] == "bearer"
    c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    c.headers["ngrok-skip-browser-warning"] = "1"                # the app sends this header; the API must ignore it
    return c


def test_token_needs_the_right_pin(make_client):
    make_client()
    anon = TestClient(app)
    assert anon.post("/api/auth/token", json={"pin": "1224"}).status_code == 200
    assert anon.post("/api/auth/token", json={"pin": "0000"}).status_code == 401


def test_phone_session_basics(phone):
    me = phone.get("/api/auth/me").json()
    assert me["name"] == "Owner"
    assert phone.get("/api/accounts").status_code == 200
    assert TestClient(app).get("/api/accounts").status_code == 401       # without the token nothing works
    assert TestClient(app, headers={"Authorization": "Bearer not-a-token"}).get("/api/accounts").status_code == 401


def test_phone_token_is_long_lived_and_not_on_the_idle_timer(phone):
    """Device tokens last about 30 days and are exempt from the website's 10 minute idle lock."""
    import time
    from app.core.security import decode_claims
    claims = decode_claims(phone.headers["Authorization"][7:])
    assert claims is not None
    assert claims["ul"] - time.time() > 29 * 24 * 3600
    assert "set-cookie" not in phone.get("/api/dashboard/overview").headers    # a bearer client is never handed a cookie


def test_home_and_money_screens(phone):
    acc = phone.get("/api/accounts").json()[0]["id"]
    cats = {c["name"]: c["id"] for c in phone.get("/api/categories", params={"type": "expense"}).json()}
    today = app_today().isoformat()
    r = phone.post("/api/transactions", json={"type": "expense", "amount": 250, "date": today, "account_id": acc, "category_id": cats["Food"], "payment_method": "upi", "description": "Lunch"})
    assert r.status_code == 201
    ov = phone.get("/api/dashboard/overview").json()
    assert ov["today"]["expense"] == 250 and ov["expense_breakdown"][0]["category"] == "Food" and ov["recent_transactions"][0]["description"] == "Lunch"
    lst = phone.get("/api/transactions", params={"limit": 50}).json()
    assert lst["total"] == 1 and lst["items"][0]["category_name"] == "Food"
    assert phone.delete(f"/api/transactions/{r.json()['id']}").status_code == 204


def test_ride_screen_flow_with_offline_style_batches(phone):
    t0 = datetime.now(timezone.utc) - timedelta(minutes=20)
    iso = lambda t: t.isoformat()  # noqa: E731
    start = phone.post("/api/rides/start", json={"client_id": "phone-1", "started_at": iso(t0), "source": "mobile"})
    assert start.status_code == 201
    rid = start.json()["id"]
    assert phone.post("/api/rides/start", json={"client_id": "phone-1", "started_at": iso(t0), "source": "mobile"}).json()["id"] == rid   # retry after a dropped connection
    pts = [{"latitude": 19.076 + (10 * i) / M, "longitude": 72.8777, "recorded_at": iso(t0 + timedelta(seconds=i)), "speed_kmh": 36.0, "accuracy_m": 8.0, "altitude_m": 10.0} for i in range(0, 121, 2)]
    for batch in (pts[:30], pts[30:]):                                         # uploaded in batches, as the app does after a dead zone
        assert phone.post(f"/api/rides/{rid}/points", json={"points": batch}).status_code == 200
    assert phone.post(f"/api/rides/{rid}/points", json={"points": pts[:30]}).json()["duplicates"] == 30   # a retried batch is not double counted
    assert phone.post(f"/api/rides/{rid}/pause", json={"at": iso(t0 + timedelta(seconds=130))}).status_code == 200
    assert phone.post(f"/api/rides/{rid}/resume", json={"at": iso(t0 + timedelta(seconds=190))}).status_code == 200
    done = phone.post(f"/api/rides/{rid}/stop", json={"at": iso(t0 + timedelta(seconds=200))}).json()
    assert done["status"] == "completed" and abs(done["total_distance_km"] - 1.2) < 0.05 and done["paused_seconds"] == 60
    detail = phone.get(f"/api/rides/{rid}").json()
    assert len(detail["track"]) >= 2 and detail["points_total"] == 61
    listing = phone.get("/api/rides", params={"preset": "30d", "limit": 8}).json()
    assert listing["total"] == 1 and listing["items"][0]["source"] == "mobile"
    assert phone.get("/api/rides/active").json()["ride"] is None


def test_fuel_parking_and_calculator_free_screens(phone):
    today = app_today().isoformat()
    bike = phone.post("/api/bikes", json={"name": "Phone bike"}).json()
    f = phone.post("/api/fuel", json={"date": today, "odometer_km": 1000, "litres": 5, "price_per_litre": 100, "bike_id": bike["id"], "record_expense": True})
    assert f.status_code == 201 and f.json()["total_amount"] == 500
    assert phone.get("/api/fuel/analytics").json()["total_spent"] == 500
    p = phone.post("/api/parking", json={"latitude": 19.07, "longitude": 72.87, "accuracy_m": 9, "note": "Level 2"})
    assert p.status_code == 201 and "google.com/maps" in p.json()["navigate_url"]
    assert phone.get("/api/parking").json()["current"]["note"] == "Level 2"


def test_health_endpoint_for_the_connection_test(phone):
    """The app's 'Test connection' button calls /health on the backend root (no token, no /api prefix)."""
    r = TestClient(app).get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
