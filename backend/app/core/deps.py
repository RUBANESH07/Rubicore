import time

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import COOKIE_NAME, decode_claims, set_session_cookie
from app.models import User


def _authenticate(request: Request, db: Session) -> tuple[User, dict]:
    token = request.cookies.get(COOKIE_NAME)
    auth = request.headers.get("authorization", "")
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:]
    claims = decode_claims(token) if token else None
    user = db.get(User, claims["user_id"]) if claims else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user, claims


def get_user_allow_locked(request: Request, db: Session = Depends(get_db)) -> User:
    """For the endpoints a locked session must still reach (status, unlock, lock, me)."""
    return _authenticate(request, db)[0]


def get_current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    """Authenticated user. Every session auto-locks after FACE_LOCK_IDLE_MINUTES without activity (HTTP 423) and
    must be unlocked with the password, or the face when one is enrolled."""
    user, claims = _authenticate(request, db)
    remaining = claims["ul"] - int(time.time())
    if remaining <= 0:
        raise HTTPException(423, "Session locked")
    if remaining < settings.face_lock_idle_minutes * 30:  # sliding idle window
        set_session_cookie(response, user.id)
    return user
