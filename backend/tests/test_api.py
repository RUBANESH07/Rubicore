from datetime import date


def accounts(c):
    return {a["type"]: a for a in c.get("/api/accounts").json()}


def cats(c, typ="expense"):
    return {x["name"]: x for x in c.get("/api/categories", params={"type": typ}).json()}


def tx(c, **kw):
    body = {"type": "expense", "amount": 100, "date": date.today().isoformat(), "payment_method": "cash", **kw}
    return c.post("/api/transactions", json=body)


def test_requires_auth(make_client):
    from fastapi.testclient import TestClient
    from app.main import app
    assert TestClient(app).get("/api/transactions").status_code == 401


def test_register_seeds_defaults(client):
    assert len(cats(client)) == 13 and len(cats(client, "income")) == 5
    assert set(accounts(client)) == {"cash", "bank", "wallet"}


def test_balance_math_and_transfers_not_income(client):
    a = accounts(client)
    client.put(f"/api/accounts/{a['bank']['id']}", json={"opening_balance": 1000})
    tx(client, type="income", amount=500, account_id=a["bank"]["id"], category_id=cats(client, "income")["Salary"]["id"])
    tx(client, amount=200, account_id=a["bank"]["id"], category_id=cats(client)["Food"]["id"])
    tx(client, type="transfer", amount=300, account_id=a["bank"]["id"], transfer_account_id=a["cash"]["id"])
    bal = client.get("/api/balances/accounts").json()
    assert bal["by_type"]["bank"] == 1000 + 500 - 200 - 300
    assert bal["by_type"]["cash"] == 300
    day = client.get("/api/balances/daily", params={"start": date.today().isoformat(), "end": date.today().isoformat()}).json()[0]
    assert (day["income"], day["expense"]) == (500, 200)  # transfer excluded
    assert day["closing"] == day["opening"] + 500 - 200 == 1300
    ov = client.get("/api/analytics/daily").json()
    assert ov["total_spending"] == 200 and ov["total_income"] == 500


def test_validation(client):
    acc = accounts(client)["cash"]["id"]
    assert tx(client, amount=-5, account_id=acc).status_code == 422
    assert tx(client, type="transfer", account_id=acc).status_code == 422
    inc_cat = cats(client, "income")["Salary"]["id"]
    assert tx(client, account_id=acc, category_id=inc_cat).status_code == 422  # income category on expense


def test_budget_alert_and_delete_category(client):
    acc = accounts(client)["cash"]["id"]
    food = cats(client)["Food"]["id"]
    client.put("/api/budgets", json={"category_id": food, "amount": 100})
    tx(client, amount=150, account_id=acc, category_id=food)
    notes = client.get("/api/notifications").json()
    assert notes["unread"] >= 1 and "Food" in notes["items"][0]["title"]
    client.delete(f"/api/categories/{food}")
    assert client.get("/api/transactions").json()["items"][0]["category_id"] is None


def test_monthly_report_and_csv(client):
    acc = accounts(client)["cash"]["id"]
    tx(client, amount=250, account_id=acc, category_id=cats(client)["Rent"]["id"])
    r = client.get("/api/analytics/monthly").json()
    assert r["total_expenses"] == 250 and r["distribution"][0]["category"] == "Rent"
    csv = client.get("/api/reports/export", params={"kind": "transactions"})
    assert csv.status_code == 200 and "Rent" in csv.text


def test_chat_private_fallback(client):
    acc = accounts(client)["cash"]["id"]
    tx(client, amount=400, account_id=acc, category_id=cats(client)["Petrol / Fuel"]["id"])
    r = client.post("/api/chat/message", json={"message": "How much did I spend on petrol this month?"}).json()
    assert r["sources"] and r["sources"][0]["type"] == "private"
    assert "400" in r["reply"]


# ---------------- PIN sign-in (no accounts, no passwords) ----------------
def _anon():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def test_pin_opens_the_app_and_wrong_pin_does_not(make_client):
    make_client()
    from app.core import security
    a = _anon()
    assert a.post("/api/auth/pin", json={"pin": "0000"}).status_code == 401
    assert a.get("/api/accounts").status_code == 401
    r = a.post("/api/auth/pin", json={"pin": "1224"})
    assert r.status_code == 200 and r.json()["name"] == "Owner"
    assert a.get("/api/accounts").status_code == 200
    security._pin_fails.clear()


def test_removed_sign_in_and_sign_up_routes_are_gone(make_client):
    a = _anon()
    for path in ("/api/auth/login", "/api/auth/register", "/api/auth/register/start", "/api/auth/register/verify", "/api/auth/username"):
        assert a.post(path, json={"email": "x@example.com", "password": "password123", "name": "X"}).status_code in (404, 405), path


def test_too_many_wrong_pins_block_even_the_right_one(make_client):
    make_client()
    from app.core import security
    a = _anon()
    for _ in range(5):
        assert a.post("/api/auth/pin", json={"pin": "9999"}).status_code == 401
    assert a.post("/api/auth/pin", json={"pin": "1224"}).status_code == 429
    security._pin_fails.clear()
    assert a.post("/api/auth/pin", json={"pin": "1224"}).status_code == 200


def test_device_token_needs_the_pin(make_client):
    make_client()
    from app.core import security
    a = _anon()
    assert a.post("/api/auth/token", json={"pin": "0000"}).status_code == 401
    r = a.post("/api/auth/token", json={"pin": "1224"})
    assert r.status_code == 200 and r.json()["token_type"] == "bearer"
    security._pin_fails.clear()
