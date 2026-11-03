"""Financial analytics. Pure aggregation over a user's own transactions; transfers are never counted."""
import calendar
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import today
from app.models import Budget
from app.repositories.finance import fetch
from app.services.balances import account_balances


def f(x) -> float:
    return round(float(x), 2)


def _total(txs, typ) -> float:
    return f(sum((t.amount for t in txs if t.type == typ), 0))


def by_category(txs, typ="expense") -> list[dict]:
    agg: dict[str, dict] = {}
    for t in txs:
        if t.type != typ:
            continue
        name = t.category.name if t.category else "Uncategorized"
        color = t.category.color if t.category else "#94a3b8"
        row = agg.setdefault(name, {"category": name, "color": color, "amount": 0.0, "count": 0})
        row["amount"] = f(row["amount"] + float(t.amount))
        row["count"] += 1
    return sorted(agg.values(), key=lambda r: -r["amount"])


def _pct_change(cur: float, prev: float) -> float | None:
    return None if not prev else round((cur - prev) / prev * 100, 1)


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def daily_series(txs, start: date, end: date) -> list[dict]:
    inc, exp = defaultdict(float), defaultdict(float)
    for t in txs:
        (inc if t.type == "income" else exp)[t.date] += float(t.amount)
    out, d = [], start
    while d <= end:
        out.append({"date": d.isoformat(), "income": f(inc[d]), "expense": f(exp[d])})
        d += timedelta(days=1)
    return out


def daily_report(db: Session, user_id: int, day: date) -> dict:
    txs = fetch(db, user_id, day, day)
    prev_txs = fetch(db, user_id, day - timedelta(days=1), day - timedelta(days=1))
    cats = by_category(txs)
    spend, prev_spend = _total(txs, "expense"), _total(prev_txs, "expense")
    remaining = sum((b["balance"] for b in account_balances(db, user_id, day)), 0)
    return {"date": day.isoformat(), "total_income": _total(txs, "income"), "total_spending": spend,
            "remaining_balance": f(remaining), "highest_category": cats[0] if cats else None,
            "by_category": cats, "previous_day_spending": prev_spend,
            "change_vs_previous_day_pct": _pct_change(spend, prev_spend),
            "transaction_count": len(txs)}


def weekly_report(db: Session, user_id: int, day: date) -> dict:
    start = day - timedelta(days=day.weekday())
    end = start + timedelta(days=6)
    txs = fetch(db, user_id, start, end)
    exp, inc = _total(txs, "expense"), _total(txs, "income")
    prev = fetch(db, user_id, start - timedelta(days=7), start - timedelta(days=1))
    return {"start": start.isoformat(), "end": end.isoformat(), "expenses": exp, "income": inc,
            "savings": f(inc - exp), "by_category": by_category(txs),
            "daily": daily_series(txs, start, end),
            "previous_week_expenses": _total(prev, "expense"),
            "change_vs_previous_week_pct": _pct_change(exp, _total(prev, "expense"))}


def budget_performance(db: Session, user_id: int, txs) -> list[dict]:
    spent_by_cat = {c["category"]: c["amount"] for c in by_category(txs)}
    total_spent = _total(txs, "expense")
    out = []
    for b in db.scalars(select(Budget).where(Budget.user_id == user_id)).unique():
        spent = total_spent if b.category_id is None else spent_by_cat.get(b.category.name, 0.0)
        limit = float(b.amount)
        pct = round(spent / limit * 100, 1) if limit else 0
        out.append({"id": b.id, "category_id": b.category_id,
                    "category": b.category.name if b.category else "Overall", "limit": f(limit),
                    "spent": f(spent), "remaining": f(limit - spent), "percent": pct,
                    "status": "over" if pct > 100 else "warning" if pct >= 80 else "ok"})
    return sorted(out, key=lambda r: (r["category_id"] is not None, -r["percent"]))


def monthly_report(db: Session, user_id: int, year: int, month: int) -> dict:
    start, end = month_bounds(year, month)
    txs = fetch(db, user_id, start, end)
    inc, exp = _total(txs, "income"), _total(txs, "expense")
    py, pm = (year - 1, 12) if month == 1 else (year, month - 1)
    ps, pe = month_bounds(py, pm)
    ptxs = fetch(db, user_id, ps, pe)
    pinc, pexp = _total(ptxs, "income"), _total(ptxs, "expense")
    days_elapsed = max(1, (min(end, today()) - start).days + 1) if year == today().year and month == today().month else (end - start).days + 1
    return {"year": year, "month": month, "total_income": inc, "total_expenses": exp, "savings": f(inc - exp),
            "savings_rate": round((inc - exp) / inc * 100, 1) if inc else 0.0,
            "avg_daily_spending": f(exp / days_elapsed),
            "distribution": by_category(txs), "income_distribution": by_category(txs, "income"),
            "budget_performance": budget_performance(db, user_id, txs),
            "daily": daily_series(txs, start, end),
            "previous_month": {"year": py, "month": pm, "total_income": pinc, "total_expenses": pexp,
                               "savings": f(pinc - pexp),
                               "distribution": by_category(ptxs)},
            "comparison": {"income_change_pct": _pct_change(inc, pinc), "expense_change_pct": _pct_change(exp, pexp),
                           "expense_difference": f(exp - pexp)}}


def yearly_report(db: Session, user_id: int, year: int) -> dict:
    txs = fetch(db, user_id, date(year, 1, 1), date(year, 12, 31))
    months, cum = [], 0.0
    cat_month: dict[str, list[float]] = defaultdict(lambda: [0.0] * 12)
    for t in txs:
        if t.type == "expense":
            cat_month[t.category.name if t.category else "Uncategorized"][t.date.month - 1] += float(t.amount)
    for m in range(1, 13):
        mt = [t for t in txs if t.date.month == m]
        i, e = _total(mt, "income"), _total(mt, "expense")
        cum += i - e
        months.append({"month": calendar.month_abbr[m], "income": i, "expense": e, "savings": f(i - e),
                       "cumulative_savings": f(cum)})
    inc, exp = _total(txs, "income"), _total(txs, "expense")
    ptxs = fetch(db, user_id, date(year - 1, 1, 1), date(year - 1, 12, 31))
    top = sorted(cat_month.items(), key=lambda kv: -sum(kv[1]))[:6]
    return {"year": year, "annual_income": inc, "annual_expenses": exp, "savings": f(inc - exp),
            "savings_rate": round((inc - exp) / inc * 100, 1) if inc else 0.0, "months": months,
            "category_trends": [{"category": k, "monthly": [round(x, 2) for x in v], "total": f(sum(v))} for k, v in top],
            "distribution": by_category(txs),
            "previous_year": {"income": _total(ptxs, "income"), "expenses": _total(ptxs, "expense")},
            "progress": {"income_change_pct": _pct_change(inc, _total(ptxs, "income")),
                         "expense_change_pct": _pct_change(exp, _total(ptxs, "expense"))}}
