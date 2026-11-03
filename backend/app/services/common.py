from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AuditLog, Category, Notification, Subcategory, User

DEFAULT_EXPENSE = {
    "Food": ("#f97316", ["Groceries", "Restaurants", "Delivery"]),
    "Petrol / Fuel": ("#ef4444", ["Petrol", "Diesel", "CNG"]),
    "Snacks": ("#eab308", ["Tea & Coffee", "Street food"]),
    "Shopping": ("#ec4899", ["Clothing", "Electronics", "Home"]),
    "Transportation": ("#0ea5e9", ["Metro / Bus", "Cab", "Parking"]),
    "Rent": ("#8b5cf6", []),
    "Bills": ("#14b8a6", ["Electricity", "Internet", "Mobile", "Water"]),
    "Entertainment": ("#a855f7", ["Movies", "Streaming", "Games"]),
    "Education": ("#3b82f6", ["Courses", "Books"]),
    "Health": ("#22c55e", ["Doctor", "Medicine", "Fitness"]),
    "Travel": ("#06b6d4", ["Flights", "Hotels", "Trips"]),
    "Investments": ("#64748b", ["Mutual funds", "Stocks", "SIP"]),
    "Other": ("#94a3b8", []),
}
DEFAULT_INCOME = {
    "Salary": "#16a34a", "Freelancing": "#0d9488", "Business": "#2563eb",
    "Investment returns": "#7c3aed", "Other income": "#64748b",
}


def seed_user_defaults(db: Session, user: User, today: date) -> None:
    for name, (color, subs) in DEFAULT_EXPENSE.items():
        c = Category(user_id=user.id, name=name, type="expense", color=color, is_default=True)
        c.subcategories = [Subcategory(name=s) for s in subs]
        db.add(c)
    for name, color in DEFAULT_INCOME.items():
        db.add(Category(user_id=user.id, name=name, type="income", color=color, is_default=True))
    for name, typ in (("Cash", "cash"), ("Bank", "bank"), ("Wallet", "wallet")):
        db.add(Account(user_id=user.id, name=name, type=typ, opening_date=today))
    db.commit()


def audit(db: Session, user_id: int | None, action: str, entity: str = "", entity_id="", detail=None, ip: str = ""):
    db.add(AuditLog(user_id=user_id, action=action, entity=entity, entity_id=str(entity_id),
                    detail=detail, ip=ip))
    db.commit()


def notify(db: Session, user_id: int, kind: str, title: str, body: str = "", ref: str | None = None) -> bool:
    if ref and db.scalar(select(Notification.id).where(Notification.user_id == user_id, Notification.ref == ref)):
        return False
    db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, ref=ref))
    db.commit()
    return True
