"""Daily balance engine.

Closing = Opening + Income - Expense for the day. Transfers between a user's own accounts move
money between accounts (visible in per-account balances) but never count as income or expense.
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, DailyBalance, Transaction

ZERO = Decimal("0")


def _effects(tx: Transaction):
    """Yield (account_id, delta) pairs for a transaction."""
    if tx.type == "income":
        yield tx.account_id, tx.amount
    elif tx.type == "expense":
        yield tx.account_id, -tx.amount
    elif tx.type == "transfer":
        yield tx.account_id, -tx.amount
        if tx.transfer_account_id:
            yield tx.transfer_account_id, tx.amount


def _load(db: Session, user_id: int, end: date):
    accounts = list(db.scalars(select(Account).where(Account.user_id == user_id, Account.is_active)))
    txs = list(db.scalars(select(Transaction).where(Transaction.user_id == user_id, Transaction.date <= end)))
    return accounts, txs


def account_balances(db: Session, user_id: int, as_of: date) -> list[dict]:
    accounts, txs = _load(db, user_id, as_of)
    bal = {a.id: a.opening_balance for a in accounts}
    for tx in txs:
        for acc_id, delta in _effects(tx):
            if acc_id in bal:
                bal[acc_id] += delta
    return [{"id": a.id, "name": a.name, "type": a.type, "balance": bal[a.id]} for a in accounts]


def totals_by_type(balances: list[dict]) -> dict[str, Decimal]:
    out = {"cash": ZERO, "bank": ZERO, "wallet": ZERO}
    for b in balances:
        out[b["type"]] += b["balance"]
    return out


def daily_balances(db: Session, user_id: int, start: date, end: date, persist: bool = True) -> list[dict]:
    """Per-day opening/income/expense/closing (all accounts) plus cash/bank/wallet closing split."""
    accounts, txs = _load(db, user_id, end)
    types = {a.id: a.type for a in accounts}
    bal = {a.id: a.opening_balance for a in accounts}
    by_day: dict[date, list[Transaction]] = defaultdict(list)
    for tx in txs:
        if tx.date < start:
            for acc_id, delta in _effects(tx):
                if acc_id in bal:
                    bal[acc_id] += delta
        else:
            by_day[tx.date].append(tx)

    rows, snapshots = [], []
    day = start
    while day <= end:
        opening_by_acc = dict(bal)
        income = expense = ZERO
        inc_acc, exp_acc = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
        for tx in by_day.get(day, []):
            if tx.type == "income":
                income += tx.amount
                inc_acc[tx.account_id] += tx.amount
            elif tx.type == "expense":
                expense += tx.amount
                exp_acc[tx.account_id] += tx.amount
            for acc_id, delta in _effects(tx):
                if acc_id in bal:
                    bal[acc_id] += delta
        opening = sum(opening_by_acc.values(), ZERO)
        closing = sum(bal.values(), ZERO)
        split = {"cash": ZERO, "bank": ZERO, "wallet": ZERO}
        for acc_id, v in bal.items():
            split[types[acc_id]] += v
        rows.append({"date": day, "opening": opening, "income": income, "expense": expense,
                     "closing": closing, **{k: v for k, v in split.items()}})
        for acc_id in bal:
            snapshots.append((acc_id, day, opening_by_acc[acc_id], inc_acc[acc_id], exp_acc[acc_id], bal[acc_id]))
        day += timedelta(days=1)

    if persist and snapshots:
        existing = {(d.account_id, d.date): d for d in db.scalars(
            select(DailyBalance).where(DailyBalance.user_id == user_id, DailyBalance.date.between(start, end)))}
        for acc_id, d, o, i, e, c in snapshots:
            row = existing.get((acc_id, d))
            if row:
                row.opening, row.income, row.expense, row.closing = o, i, e, c
            else:
                db.add(DailyBalance(user_id=user_id, account_id=acc_id, date=d, opening=o, income=i,
                                    expense=e, closing=c))
        db.commit()
    return rows
