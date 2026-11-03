import hashlib

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents import llm
from app.core.config import today
from app.core.database import get_db
from app.core.deps import get_current_user
from app.integrations import news as nw
from app.models import SavedArticle, User
from app.schemas import ArticleIn
from app.services.common import notify

router = APIRouter(prefix="/news", tags=["news"])


def _public(items):
    return [{k: v for k, v in i.items() if k != "ts"} for i in items]


@router.get("/categories")
def categories(user: User = Depends(get_current_user)):
    return list(nw.CATEGORIES)


@router.get("")
def headlines(category: str = "business", q: str = Query("", max_length=100), limit: int = Query(20, ge=1, le=50),
              user: User = Depends(get_current_user)):
    if category not in nw.CATEGORIES:
        raise HTTPException(422, "Unknown category")
    return _public(nw.latest(category, q, limit))


@router.get("/briefing")
def briefing(user: User = Depends(get_current_user)):
    items = []
    for cat in ("india", "stock-market", "economy", "technology", "global"):
        items += [(cat, i) for i in nw.latest(cat, limit=4)]
    lines = "\n".join(f"- [{c}] {i['title']} ({i['source']})" for c, i in items)
    text = llm.generate(f"Today is {today()}. Headlines:\n{lines}\n\nWrite a crisp daily briefing: 5-7 bullets grouped "
                        "by theme, each one sentence. Use only these headlines; do not add facts.",
                        "You are a news editor writing a neutral morning briefing.")
    return {"briefing": text, "ai_generated": True, "available": text is not None,
            "headlines": [{**{k: v for k, v in i.items() if k != "ts"}} for _, i in items]}


@router.post("/check-important")
def check_important(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Create notifications for newly seen market-moving headlines (de-duplicated per headline)."""
    created = 0
    for cat in ("stock-market", "economy", "india"):
        for i in nw.latest(cat, limit=15):
            if i["important"]:
                created += notify(db, user.id, "news", i["title"][:200], f"{i['source']} - {i['url']}",
                                  ref="news:" + hashlib.sha1(i["title"].lower()[:80].encode()).hexdigest()[:16])
    return {"created": created}


@router.get("/saved")
def saved(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(SavedArticle).where(SavedArticle.user_id == user.id).order_by(SavedArticle.id.desc())).all()
    return [{"id": r.id, "title": r.title, "url": r.url, "source": r.source, "category": r.category,
             "summary": r.summary, "published_at": r.published_at} for r in rows]


@router.post("/saved", status_code=201)
def save(body: ArticleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(422, "Invalid URL")
    a = SavedArticle(user_id=user.id, **body.model_dump())
    db.add(a)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Already saved")
    return {"id": a.id}


@router.delete("/saved/{aid}", status_code=204)
def unsave(aid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    a = db.get(SavedArticle, aid)
    if not a or a.user_id != user.id:
        raise HTTPException(404, "Not found")
    db.delete(a)
    db.commit()
