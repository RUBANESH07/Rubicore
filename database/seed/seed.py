"""Seed a demo user with ~4 months of realistic sample data.

    python database/seed/seed.py

Demo login (development only): demo@rubicore.dev / demo1234
"""
import random
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sqlalchemy import select  # noqa: E402

from app.core.config import today  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import migrate  # noqa: E402
from app.models import (Account, Budget, Category, SavingsGoal, StockWatchlist, Transaction, User)  # noqa: E402
from app.services.common import seed_user_defaults  # noqa: E402

EMAIL = "demo@rubicore.dev"


def D(x) -> Decimal:
    return Decimal(str(round(x, 2)))


def main():
    migrate()
    db = SessionLocal()
    existing = db.scalar(select(User).where(User.email == EMAIL))
    if existing:
        from seed_rides import seed_rides
        n = seed_rides(db, existing, today())
        print(f"Demo user already exists. Added {n} sample rides." if n else "Demo user already exists.")
        return
    rnd, t = random.Random(42), today()
    user = User(email=EMAIL, name="Demo User", password_hash=hash_password("demo1234"), currency="INR")
    db.add(user)
    db.commit()
    start = t - timedelta(days=120)
    seed_user_defaults(db, user, start)
    acc = {a.type: a for a in db.scalars(select(Account).where(Account.user_id == user.id))}
    acc["cash"].opening_balance, acc["bank"].opening_balance, acc["wallet"].opening_balance = D(8000), D(60000), D(12000)
    cat = {c.name: c for c in db.scalars(select(Category).where(Category.user_id == user.id))}

    def add(day, typ, amount, category, account, desc, pm="upi"):
        db.add(Transaction(user_id=user.id, account_id=acc[account].id, type=typ, amount=D(amount), date=day,
                           category_id=cat[category].id if category else None, payment_method=pm, description=desc))

    spend = [("Food", 120, 450, "bank", "Lunch / groceries"), ("Snacks", 30, 150, "cash", "Tea & snacks"),
             ("Petrol / Fuel", 400, 1200, "bank", "Fuel"), ("Transportation", 40, 400, "wallet", "Metro / cab"),
             ("Shopping", 300, 3000, "bank", "Shopping"), ("Entertainment", 150, 900, "bank", "Movie / OTT"),
             ("Health", 100, 1500, "bank", "Pharmacy"), ("Education", 200, 1800, "bank", "Course / books")]
    weights = [6, 5, 1.2, 3, 0.8, 0.7, 0.3, 0.25]
    day = start
    while day <= t:
        for _ in range(rnd.choice([1, 1, 2, 3])):
            c, lo, hi, a, d = rnd.choices(spend, weights)[0]
            add(day, "expense", rnd.uniform(lo, hi), c, a, d, "cash" if a == "cash" else "upi")
        if day.day == 1:
            add(day, "income", 85000, "Salary", "bank", "Monthly salary", "netbanking")
            add(day, "expense", 18000, "Rent", "bank", "House rent", "netbanking")
            add(day, "expense", 5000, "Investments", "bank", "Mutual fund SIP", "netbanking")
        if day.day == 5:
            add(day, "expense", rnd.uniform(2500, 4000), "Bills", "bank", "Electricity & internet", "netbanking")
        if day.day == 15 and rnd.random() < 0.7:
            add(day, "income", rnd.uniform(5000, 15000), "Freelancing", "bank", "Freelance project", "netbanking")
        if day.day == 10:  # transfers are NOT income/expense
            db.add(Transaction(user_id=user.id, account_id=acc["bank"].id, transfer_account_id=acc["cash"].id,
                               type="transfer", amount=D(3000), date=day, payment_method="netbanking",
                               description="ATM withdrawal"))
        day += timedelta(days=1)

    db.add(Budget(user_id=user.id, category_id=None, amount=D(45000)))
    for name, amt in (("Food", 8000), ("Petrol / Fuel", 5000), ("Shopping", 6000), ("Entertainment", 2500)):
        db.add(Budget(user_id=user.id, category_id=cat[name].id, amount=D(amt)))
    db.add(SavingsGoal(user_id=user.id, name="Emergency fund", target_amount=D(200000), saved_amount=D(85000)))
    db.add(SavingsGoal(user_id=user.id, name="Goa trip", target_amount=D(40000), saved_amount=D(12000),
                       target_date=t + timedelta(days=150)))
    for sym, name in (("RELIANCE", "Reliance Industries"), ("TCS", "Tata Consultancy Services"),
                      ("HDFCBANK", "HDFC Bank"), ("INFY", "Infosys")):
        db.add(StockWatchlist(user_id=user.id, symbol=sym, name=name, exchange="NSE"))
    db.commit()
    from seed_rides import seed_rides
    n_rides = seed_rides(db, user, t)
    print(f"Seeded {n_rides} sample rides.")
    print("Seeded demo data. Login: demo@rubicore.dev / demo1234")


if __name__ == "__main__":
    main()
