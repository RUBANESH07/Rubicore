import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import analytics as an
from app.agents import llm
from app.core.config import today
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Budget, Category, SavingsGoal, User
from app.repositories import finance as repo
from app.schemas import BudgetIn, GoalIn, GoalOut, GoalUpdate
from app.services import balances
from app.services.common import audit, notify

router = APIRouter(tags=["finance"])


# ---------- dashboard ----------
@router.get("/dashboard/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = today()
    bals = balances.account_balances(db, user.id, t)
    total = float(sum((b["balance"] for b in bals), 0))
    day = an.daily_report(db, user.id, t)
    month = an.monthly_report(db, user.id, t.year, t.month)
    goals = db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user.id)).all()
    recent, _ = repo.list_transactions(db, user.id, limit=8)
    top = day["highest_category"]
    parts = [f"Today you spent {day['total_spending']:,.0f} and earned {day['total_income']:,.0f}."]
    if top:
        parts.append(f"Biggest category: {top['category']} ({top['amount']:,.0f}).")
    if day["change_vs_previous_day_pct"] is not None:
        parts.append(f"Spending is {abs(day['change_vs_previous_day_pct'])}% "
                     f"{'higher' if day['change_vs_previous_day_pct'] > 0 else 'lower'} than yesterday.")
    return {
        "balance": {"total": round(total, 2), "by_type": {k: float(v) for k, v in balances.totals_by_type(bals).items()},
                    "accounts": [{**b, "balance": float(b["balance"])} for b in bals]},
        "today": {"income": day["total_income"], "expense": day["total_spending"]},
        "month": {"income": month["total_income"], "expense": month["total_expenses"], "savings": month["savings"],
                  "savings_rate": month["savings_rate"]},
        "total_goal_savings": round(sum(float(g.saved_amount) for g in goals), 2),
        "expense_breakdown": month["distribution"], "income_breakdown": month["income_distribution"],
        "previous_breakdown": month["previous_month"]["distribution"],
        "daily_trend": month["daily"],
        "recent_transactions": [{"id": r.id, "type": r.type, "amount": float(r.amount), "date": r.date.isoformat(),
                                 "category": r.category.name if r.category else None, "description": r.description}
                                for r in recent],
        "daily_summary": " ".join(parts),
    }


@router.get("/dashboard/ai-summary")
def ai_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = today()
    day, month = an.daily_report(db, user.id, t), an.monthly_report(db, user.id, t.year, t.month)
    facts = {"today": {k: day[k] for k in ("total_income", "total_spending", "highest_category", "change_vs_previous_day_pct")},
             "month": {k: month[k] for k in ("total_income", "total_expenses", "savings_rate", "avg_daily_spending")},
             "budgets": month["budget_performance"][:5], "top_categories": month["distribution"][:4]}
    text = llm.generate(f"Facts about the user's finances (JSON): {facts}\nWrite a friendly 3-4 sentence daily summary "
                        "with one practical, non-judgemental tip. Use only these numbers.",
                        "You are a concise personal finance assistant.")
    return {"summary": text, "ai_generated": True, "available": text is not None}


# ---------- analytics ----------
@router.get("/analytics/daily")
def a_daily(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return an.daily_report(db, user.id, day or today())


@router.get("/analytics/weekly")
def a_weekly(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return an.weekly_report(db, user.id, day or today())


@router.get("/analytics/monthly")
def a_monthly(year: int | None = None, month: int | None = None, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    t = today()
    y, m = year or t.year, month or t.month
    if not 1 <= m <= 12 or not 2000 <= y <= 2100:
        raise HTTPException(422, "Invalid month")
    return an.monthly_report(db, user.id, y, m)


@router.get("/analytics/yearly")
def a_yearly(year: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return an.yearly_report(db, user.id, year or today().year)


# ---------- budgets ----------
@router.get("/budgets")
def list_budgets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = today()
    return an.monthly_report(db, user.id, t.year, t.month)["budget_performance"]


@router.put("/budgets")
def upsert_budget(body: BudgetIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.category_id:
        c = db.get(Category, body.category_id)
        if not c or c.user_id != user.id or c.type != "expense":
            raise HTTPException(422, "Unknown expense category")
    b = db.scalar(select(Budget).where(Budget.user_id == user.id, Budget.category_id == body.category_id))
    if b:
        b.amount = body.amount
    else:
        db.add(Budget(user_id=user.id, category_id=body.category_id, amount=body.amount))
    db.commit()
    return {"ok": True}


@router.delete("/budgets/{budget_id}", status_code=204)
def delete_budget(budget_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = db.get(Budget, budget_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "Budget not found")
    db.delete(b)
    db.commit()


# ---------- goals ----------
def _goal_owned(db, user, goal_id) -> SavingsGoal:
    g = db.get(SavingsGoal, goal_id)
    if not g or g.user_id != user.id:
        raise HTTPException(404, "Goal not found")
    return g


@router.get("/goals", response_model=list[GoalOut])
def list_goals(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user.id).order_by(SavingsGoal.id)).all()


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    g = SavingsGoal(user_id=user.id, **body.model_dump())
    db.add(g)
    db.commit()
    return g


@router.put("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    g = _goal_owned(db, user, goal_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(g, k, v)
    db.commit()
    if g.saved_amount >= g.target_amount:
        notify(db, user.id, "goal", f"Goal reached: {g.name}", "You hit your savings target!", ref=f"goal:{g.id}")
    return g


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_goal_owned(db, user, goal_id))
    db.commit()


# ---------- reports (CSV export) ----------
def _csv(rows: list[list], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/reports/export")
def export(request: Request, kind: str = "transactions", start: date | None = None, end: date | None = None,
           year: int | None = None, month: int | None = None, db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    t = today()
    audit(db, user.id, "report.export", "report", kind, {"start": str(start), "end": str(end)},
          request.client.host if request.client else "")
    if kind == "transactions":
        end = end or t
        start = start or end - timedelta(days=89)
        txs = repo.fetch(db, user.id, start, end, ("income", "expense", "transfer"))
        rows = [["date", "type", "amount", "category", "subcategory", "payment_method", "description", "notes"]]
        rows += [[x.date, x.type, x.amount, x.category.name if x.category else "", x.subcategory.name if x.subcategory else "",
                  x.payment_method, x.description, x.notes or ""] for x in txs]
        return _csv(rows, f"transactions_{start}_{end}.csv")
    if kind == "monthly":
        r = an.monthly_report(db, user.id, year or t.year, month or t.month)
        rows = [["metric", "value"], ["income", r["total_income"]], ["expenses", r["total_expenses"]],
                ["savings", r["savings"]], ["savings_rate_pct", r["savings_rate"]], [], ["category", "amount"]]
        rows += [[c["category"], c["amount"]] for c in r["distribution"]]
        rows += [[], ["budget", "limit", "spent", "percent"]]
        rows += [[b["category"], b["limit"], b["spent"], b["percent"]] for b in r["budget_performance"]]
        return _csv(rows, f"monthly_{r['year']}-{r['month']:02d}.csv")
    if kind == "yearly":
        r = an.yearly_report(db, user.id, year or t.year)
        rows = [["month", "income", "expense", "savings", "cumulative_savings"]]
        rows += [[m["month"], m["income"], m["expense"], m["savings"], m["cumulative_savings"]] for m in r["months"]]
        return _csv(rows, f"yearly_{r['year']}.csv")
    raise HTTPException(422, "kind must be transactions, monthly or yearly")
