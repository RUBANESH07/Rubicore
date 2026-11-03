from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Transaction


def _filters(user_id, start=None, end=None, types=None, category_id=None, account_id=None, q=None):
    conds = [Transaction.user_id == user_id]
    if start:
        conds.append(Transaction.date >= start)
    if end:
        conds.append(Transaction.date <= end)
    if types:
        conds.append(Transaction.type.in_(types))
    if category_id:
        conds.append(Transaction.category_id == category_id)
    if account_id:
        conds.append(or_(Transaction.account_id == account_id, Transaction.transfer_account_id == account_id))
    if q:
        like = f"%{q}%"
        conds.append(or_(Transaction.description.ilike(like), Transaction.notes.ilike(like)))
    return conds


def list_transactions(db: Session, user_id: int, *, limit=50, offset=0, **filters):
    conds = _filters(user_id, **filters)
    total = db.scalar(select(func.count()).select_from(Transaction).where(*conds)) or 0
    rows = db.scalars(select(Transaction).where(*conds)
                      .order_by(Transaction.date.desc(), Transaction.id.desc())
                      .limit(limit).offset(offset)).unique().all()
    return rows, total


def fetch(db: Session, user_id: int, start: date | None, end: date | None,
          types=("income", "expense")) -> list[Transaction]:
    """All transactions in a range. Transfers are excluded unless asked for explicitly."""
    return list(db.scalars(select(Transaction).where(*_filters(user_id, start, end, types))
                           .order_by(Transaction.date)).unique().all())


def get_owned(db: Session, user_id: int, tx_id: int) -> Transaction | None:
    tx = db.get(Transaction, tx_id)
    return tx if tx and tx.user_id == user_id else None
