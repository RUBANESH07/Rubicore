"""Private finance tools for the assistant.

These run in-process against the authorised database. `user_id` is bound by the server from the
authenticated session and is NEVER a model-supplied argument, so the model cannot read another
user's data. Nothing in this module talks to MCP or the network.
"""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import analytics as an
from app.core.config import today
from app.models import Category, SavingsGoal
from app.repositories.finance import fetch
from app.services.balances import account_balances, totals_by_type

PERIOD = {"type": "string", "description": "today, yesterday, week, month, last_month, year, or custom (then give start_date/end_date as YYYY-MM-DD)"}
DATES = {"start_date": {"type": "string", "description": "YYYY-MM-DD, only for period=custom"},
         "end_date": {"type": "string", "description": "YYYY-MM-DD, only for period=custom"}}

DECLARATIONS = [
    {"name": "get_spending_summary",
     "description": "User's own total income or expenses for a period, with category breakdown. Optionally filter by category name (e.g. petrol, food).",
     "parameters": {"type": "object", "properties": {"period": PERIOD, **DATES,
                    "category": {"type": "string", "description": "Category name or part of it"},
                    "kind": {"type": "string", "description": "expense (default) or income"}}, "required": ["period"]}},
    {"name": "list_transactions", "description": "User's recent individual transactions, optionally filtered.",
     "parameters": {"type": "object", "properties": {"period": PERIOD, **DATES, "category": {"type": "string"},
                    "limit": {"type": "integer", "description": "max rows, default 10"}}, "required": ["period"]}},
    {"name": "get_account_balances", "description": "User's current cash, bank and wallet balances.",
     "parameters": {"type": "object", "properties": {}}},
    {"name": "compare_months", "description": "Compare a month's income/expenses/categories with the previous month. month format YYYY-MM, default current month.",
     "parameters": {"type": "object", "properties": {"month": {"type": "string"}}}},
    {"name": "get_budget_status", "description": "Budget performance (limit, spent, remaining) for the current month.",
     "parameters": {"type": "object", "properties": {}}},
    {"name": "get_savings_overview", "description": "How much the user saved this month, savings rate, recent average, goals, and how much they could save.",
     "parameters": {"type": "object", "properties": {}}},
    {"name": "get_average_daily_spending", "description": "Average daily spending over a period.",
     "parameters": {"type": "object", "properties": {"period": PERIOD, **DATES}, "required": ["period"]}},
    {"name": "get_riding_summary", "description": "User's own bike rides: distance, number of rides, riding time, average and max speed for a period, plus fuel spend, mileage (from full-tank fill-ups) and cost per km.",
     "parameters": {"type": "object", "properties": {"period": PERIOD, **DATES}, "required": ["period"]}},
    {"name": "generate_monthly_report", "description": "Full monthly financial report. month format YYYY-MM, default current month.",
     "parameters": {"type": "object", "properties": {"month": {"type": "string"}}}},
]
NAMES = {d["name"] for d in DECLARATIONS}


def resolve_period(period: str = "month", start_date: str = "", end_date: str = "") -> tuple[date, date]:
    t = today()
    p = (period or "month").lower()
    if p == "today":
        return t, t
    if p == "yesterday":
        return t - timedelta(days=1), t - timedelta(days=1)
    if p == "week":
        return t - timedelta(days=t.weekday()), t
    if p == "last_month":
        e = t.replace(day=1) - timedelta(days=1)
        return e.replace(day=1), e
    if p == "year":
        return date(t.year, 1, 1), t
    if p == "custom" and start_date:
        try:
            s = date.fromisoformat(start_date)
            return s, date.fromisoformat(end_date) if end_date else t
        except ValueError:
            pass
    return t.replace(day=1), t


def _month(m: str) -> tuple[int, int]:
    try:
        y, mo = m.split("-")
        return int(y), int(mo)
    except (ValueError, AttributeError):
        t = today()
        return t.year, t.month


def _match_category(db: Session, user_id: int, name: str) -> list[int]:
    n = name.lower().strip()
    cats = db.scalars(select(Category).where(Category.user_id == user_id)).all()
    return [c.id for c in cats if n and (n in c.name.lower() or c.name.lower() in n)]


def execute(db: Session, user_id: int, name: str, args: dict):
    a = args or {}
    if name in ("get_spending_summary", "list_transactions", "get_average_daily_spending"):
        start, end = resolve_period(a.get("period", "month"), a.get("start_date", ""), a.get("end_date", ""))
        kind = "income" if a.get("kind") == "income" else "expense"
        txs = fetch(db, user_id, start, end, (kind,) if name != "list_transactions" else ("income", "expense"))
        cat = a.get("category")
        if cat:
            ids = set(_match_category(db, user_id, cat))
            txs = [t for t in txs if t.category_id in ids]
        if name == "list_transactions":
            rows = sorted(txs, key=lambda t: (t.date, t.id), reverse=True)[: int(a.get("limit") or 10)]
            return {"period": f"{start} to {end}", "transactions": [
                {"date": t.date.isoformat(), "type": t.type, "amount": float(t.amount),
                 "category": t.category.name if t.category else None, "description": t.description} for t in rows]}
        total = round(sum(float(t.amount) for t in txs), 2)
        days = (end - start).days + 1
        if name == "get_average_daily_spending":
            return {"period": f"{start} to {end}", "days": days, "total_spent": total, "average_per_day": round(total / days, 2)}
        return {"period": f"{start} to {end}", "kind": kind, "category_filter": cat, "total": total,
                "transaction_count": len(txs), "by_category": an.by_category(txs, kind)[:8]}
    if name == "get_riding_summary":
        from app.ride import service as rsvc
        from app.ride.fuel import fuel_summary
        start, end = resolve_period(a.get("period", "month"), a.get("start_date", ""), a.get("end_date", ""))
        rides = rsvc.rides_between(db, user_id, start, end)
        fs = fuel_summary(db, user_id)
        return {"period": f"{start} to {end}", **rsvc.totals(rides), "fuel_spent_in_period": rsvc.fuel_between(db, user_id, start, end),
                "average_mileage_kmpl": fs["average_mileage_kmpl"], "fuel_cost_per_km": fs["cost_per_km"],
                "mileage_note": fs["note"]}
    if name == "get_account_balances":
        bals = account_balances(db, user_id, today())
        return {"as_of": today().isoformat(), "accounts": [{**b, "balance": float(b["balance"])} for b in bals],
                "by_type": {k: float(v) for k, v in totals_by_type(bals).items()},
                "total": float(sum((b["balance"] for b in bals), 0))}
    if name in ("compare_months", "generate_monthly_report"):
        y, m = _month(a.get("month", ""))
        rep = an.monthly_report(db, user_id, y, m)
        if name == "compare_months":
            return {"month": f"{y}-{m:02d}", "income": rep["total_income"], "expenses": rep["total_expenses"],
                    "previous": {k: rep["previous_month"][k] for k in ("year", "month", "total_income", "total_expenses")},
                    **rep["comparison"], "top_categories_now": rep["distribution"][:5],
                    "top_categories_previous": rep["previous_month"]["distribution"][:5]}
        return {k: rep[k] for k in ("year", "month", "total_income", "total_expenses", "savings", "savings_rate",
                                    "avg_daily_spending", "budget_performance", "comparison")} | {"top_categories": rep["distribution"][:6]}
    if name == "get_budget_status":
        t = today()
        return {"month": f"{t.year}-{t.month:02d}",
                "budgets": an.monthly_report(db, user_id, t.year, t.month)["budget_performance"]}
    if name == "get_savings_overview":
        t = today()
        cur = an.monthly_report(db, user_id, t.year, t.month)
        past = []
        y, m = t.year, t.month
        for _ in range(3):
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
            r = an.monthly_report(db, user_id, y, m)
            past.append(r["savings"])
        goals = db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user_id)).all()
        avg = round(sum(past) / len(past), 2)
        return {"this_month_savings": cur["savings"], "this_month_savings_rate_pct": cur["savings_rate"],
                "avg_savings_last_3_months": avg,
                "estimated_monthly_saving_capacity": max(avg, 0),
                "goals": [{"name": g.name, "saved": float(g.saved_amount), "target": float(g.target_amount)} for g in goals]}
    raise KeyError(name)
