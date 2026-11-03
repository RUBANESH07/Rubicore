"""No accounts, passwords or sign-up. One owner opens the app with the PIN (APP_PIN, default 1224) or an enrolled face."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings, today
from app.core.database import get_db
from app.core.deps import get_user_allow_locked
from app.core.security import (COOKIE_NAME, check_pin, create_access_token, hash_password, pin_blocked_for, pin_failed, pin_ok,
                               set_session_cookie)
from app.models import User
from app.schemas import PinIn, UserOut
from app.services.common import audit, seed_user_defaults

router = APIRouter(prefix="/auth", tags=["auth"])

OWNER_EMAIL = "owner@rubicore.local"
DEVICE_TOKEN_DAYS = 30


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def owner(db: Session) -> User:
    """The one user of this app; created on first use."""
    user = db.scalar(select(User).order_by(User.id).limit(1))
    if user:
        return user
    user = User(email=OWNER_EMAIL, username="owner", name="Owner", password_hash=hash_password(settings.secret_key + OWNER_EMAIL),
                currency=settings.default_currency)
    db.add(user)
    db.commit()
    seed_user_defaults(db, user, today())
    return user


def require_pin(db: Session, user: User | None, pin: str, request: Request, kind: str) -> None:
    """Raise 429 while blocked and 401 for a wrong PIN. Wrong tries are counted per client IP."""
    ip = _ip(request)
    wait = pin_blocked_for(ip)
    if wait:
        raise HTTPException(429, f"Too many wrong PINs. Try again in {wait} seconds.")
    if not check_pin(pin):
        pin_failed(ip)
        audit(db, user.id if user else None, f"auth.{kind}_failed", "user", user.id if user else "", ip=ip)
        raise HTTPException(401, "Incorrect PIN")
    pin_ok(ip)


@router.post("/pin", response_model=UserOut)
def pin_login(body: PinIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Open the app with the PIN: sets the session cookie."""
    require_pin(db, None, body.pin, request, "pin")
    user = owner(db)
    audit(db, user.id, "auth.pin", "user", user.id, ip=_ip(request))
    set_session_cookie(response, user.id)
    return user


@router.post("/token")
def device_token(body: PinIn, request: Request, db: Session = Depends(get_db)):
    """Bearer token for the phone app (kept in its secure storage), issued for the PIN."""
    require_pin(db, None, body.pin, request, "token")
    user = owner(db)
    audit(db, user.id, "auth.token_issued", "user", user.id, ip=_ip(request))
    minutes = DEVICE_TOKEN_DAYS * 24 * 60
    return {"access_token": create_access_token(user.id, lifetime_min=minutes, ul_min=minutes), "token_type": "bearer",
            "expires_in": minutes * 60}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_user_allow_locked)):
    return user


@router.post("/lock")
def lock_now(request: Request, response: Response, db: Session = Depends(get_db), user: User = Depends(get_user_allow_locked)):
    """Lock this session immediately. Unlock needs the PIN, or the face if enrolled."""
    audit(db, user.id, "auth.lock", "user", user.id, ip=_ip(request))
    set_session_cookie(response, user.id, unlocked=False)
    return {"locked": True}


@router.post("/unlock")
def unlock(body: PinIn, request: Request, response: Response, db: Session = Depends(get_db),
           user: User = Depends(get_user_allow_locked)):
    """Enter the PIN to unlock an idle (locked) session."""
    require_pin(db, user, body.pin, request, "unlock")
    audit(db, user.id, "auth.unlock_pin", "user", user.id, ip=_ip(request))
    set_session_cookie(response, user.id)
    return {"ok": True}


@router.get("/options")
def options(db: Session = Depends(get_db)):
    """What the PIN page may offer: only whether a face can open the app."""
    from app.services import face as face_svc
    return {"face_login": face_svc.login_available(db)}
