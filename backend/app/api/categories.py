from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Category, Subcategory, Transaction, User
from app.schemas import CategoryIn, CategoryOut, CategoryUpdate, SubcategoryIn, SubcategoryOut
from app.services.common import audit

router = APIRouter(prefix="/categories", tags=["categories"])


def _owned(db, user, cat_id) -> Category:
    c = db.get(Category, cat_id)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Category not found")
    return c


@router.get("", response_model=list[CategoryOut])
def list_categories(type: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = select(Category).where(Category.user_id == user.id).order_by(Category.type, Category.name)
    if type:
        q = q.where(Category.type == type)
    return db.scalars(q).all()


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = Category(user_id=user.id, **body.model_dump())
    db.add(c)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Category already exists")
    return c


@router.put("/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: int, body: CategoryUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _owned(db, user, cat_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(c, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Category already exists")
    return c


@router.delete("/{cat_id}", status_code=204)
def delete_category(cat_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _owned(db, user, cat_id)
    used = db.scalar(select(func.count()).select_from(Transaction).where(Transaction.category_id == c.id)) or 0
    name = c.name
    db.delete(c)  # transactions keep their rows; category becomes NULL ("Uncategorized")
    db.commit()
    audit(db, user.id, "category.delete", "category", cat_id, {"name": name, "transactions_uncategorized": used})


@router.post("/{cat_id}/subcategories", response_model=SubcategoryOut, status_code=201)
def add_sub(cat_id: int, body: SubcategoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _owned(db, user, cat_id)
    s = Subcategory(category_id=c.id, name=body.name)
    db.add(s)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Subcategory already exists")
    return s


@router.delete("/{cat_id}/subcategories/{sub_id}", status_code=204)
def delete_sub(cat_id: int, sub_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _owned(db, user, cat_id)
    s = db.get(Subcategory, sub_id)
    if not s or s.category_id != c.id:
        raise HTTPException(404, "Subcategory not found")
    db.delete(s)
    db.commit()
