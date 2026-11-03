from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import analytics as an
from app.core.config import today
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Account, Category, Subcategory, Transaction, User
from app.repositories import finance as repo
from app.schemas import (AccountIn, AccountOut, AccountUpdate, TransactionIn, TransactionOut,
                         TransactionPage)
from app.services import balances
from app.services.common import audit, notify

router = APIRouter(tags=["transactions"])


def _out(tx: Transaction) -> TransactionOut:
    o = TransactionOut.model_validate(tx)
    o.category_name = tx.category.name if tx.category else None
    o.subcategory_name = tx.subcategory.name if tx.subcategory else None
    return o


def _validate_refs(db: Session, user: User, body: TransactionIn):
    for acc_id in filter(None, (body.account_id, body.transfer_account_id)):
        acc = db.get(Account, acc_id)
        if not acc or acc.user_id != user.id:
            raise HTTPException(422, "Unknown account")
    if body.category_id:
        cat = db.get(Category, body.category_id)
        if not cat or cat.user_id != user.id or cat.type != body.type:
            raise HTTPException(422, f"Category must be an existing {body.type} category")
        if body.subcategory_id:
            sub = db.get(Subcategory, body.subcategory_id)
            if not sub or sub.category_id != cat.id:
                raise HTTPException(422, "Subcategory does not belong to the category")
    elif body.subcategory_id:
        raise HTTPException(422, "Subcategory requires a category")


def _budget_alerts(db: Session, user: User, tx: Transaction):
    if tx.type != "expense" or (tx.date.year, tx.date.month) != (today().year, today().month):
        return
    for b in an.monthly_report(db, user.id, tx.date.year, tx.date.month)["budget_performance"]:
        if b["category_id"] in (None, tx.category_id) and b["status"] != "ok":
            level = 100 if b["status"] == "over" else 80
            notify(db, user.id, "budget", f"{b['category']} budget {'exceeded' if level == 100 else 'at 80%'}",
                   f"Spent {b['spent']:.0f} of {b['limit']:.0f} this month.",
                   ref=f"budget:{b['id']}:{tx.date:%Y-%m}:{level}")


@router.get("/transactions", response_model=TransactionPage)
def list_tx(start: date | None = None, end: date | None = None, type: str | None = None,
            category_id: int | None = None, account_id: int | None = None, q: str | None = Query(None, max_length=100),
            limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows, total = repo.list_transactions(db, user.id, limit=limit, offset=offset, start=start, end=end,
                                         types=[type] if type else None, category_id=category_id,
                                         account_id=account_id, q=q)
    return TransactionPage(items=[_out(r) for r in rows], total=total)


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_tx(body: TransactionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _validate_refs(db, user, body)
    tx = Transaction(user_id=user.id, **body.model_dump())
    db.add(tx)
    db.commit()
    db.refresh(tx)
    _budget_alerts(db, user, tx)
    return _out(tx)


@router.put("/transactions/{tx_id}", response_model=TransactionOut)
def update_tx(tx_id: int, body: TransactionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tx = repo.get_owned(db, user.id, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    _validate_refs(db, user, body)
    for k, v in body.model_dump().items():
        setattr(tx, k, v)
    db.commit()
    db.refresh(tx)
    audit(db, user.id, "transaction.update", "transaction", tx_id)
    _budget_alerts(db, user, tx)
    return _out(tx)


@router.delete("/transactions/{tx_id}", status_code=204)
def delete_tx(tx_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tx = repo.get_owned(db, user.id, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    detail = {"type": tx.type, "amount": float(tx.amount), "date": tx.date.isoformat()}
    db.delete(tx)
    db.commit()
    audit(db, user.id, "transaction.delete", "transaction", tx_id, detail, request.client.host if request.client else "")


# ---------- accounts & balances ----------
@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(Account).where(Account.user_id == user.id).order_by(Account.id)).all()


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(body: AccountIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.scalar(select(Account.id).where(Account.user_id == user.id, Account.name == body.name)):
        raise HTTPException(409, "Account name already used")
    acc = Account(user_id=user.id, name=body.name, type=body.type, opening_balance=body.opening_balance,
                  opening_date=body.opening_date or today())
    db.add(acc)
    db.commit()
    return acc


@router.put("/accounts/{acc_id}", response_model=AccountOut)
def update_account(acc_id: int, body: AccountUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    acc = db.get(Account, acc_id)
    if not acc or acc.user_id != user.id:
        raise HTTPException(404, "Account not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(acc, k, v)
    db.commit()
    audit(db, user.id, "account.update", "account", acc_id, body.model_dump(exclude_unset=True, mode="json"))
    return acc


@router.get("/balances/accounts")
def current_balances(as_of: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bals = balances.account_balances(db, user.id, as_of or today())
    return {"as_of": (as_of or today()).isoformat(),
            "accounts": [{**b, "balance": float(b["balance"])} for b in bals],
            "by_type": {k: float(v) for k, v in balances.totals_by_type(bals).items()},
            "total": float(sum((b["balance"] for b in bals), 0))}


@router.get("/balances/daily")
def daily(start: date | None = None, end: date | None = None, db: Session = Depends(get_db),
          user: User = Depends(get_current_user)):
    end = end or today()
    start = start or end - timedelta(days=29)
    if (end - start).days > 400 or start > end:
        raise HTTPException(422, "Range must be 1-400 days")
    rows = balances.daily_balances(db, user.id, start, end)
    return [{**r, "date": r["date"].isoformat(), **{k: float(r[k]) for k in
             ("opening", "income", "expense", "closing", "cash", "bank", "wallet")}} for r in rows]
