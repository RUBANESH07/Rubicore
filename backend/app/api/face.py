"""Face lock endpoints. The PIN is the fallback credential; a face can also open the app."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.auth import require_pin
from app.core.deps import get_user_allow_locked
from app.core.security import set_session_cookie
from app.models import User
from app.services import face as face_svc
from app.services.common import audit

router = APIRouter(prefix="/face", tags=["face lock"])


class EnrollIn(BaseModel):
    pin: str = Field(max_length=12)
    images: list[str] = Field(min_length=5, max_length=12)
    allow_login: bool = True  # also allow opening the app with the face (no PIN)


class LoginSettingIn(BaseModel):
    pin: str = Field(max_length=12)
    allow_login: bool


class PinBody(BaseModel):
    pin: str = Field(max_length=12)


class VerifyIn(BaseModel):
    image: str


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _require_pin(db, user, pin, request):
    require_pin(db, user, pin, request, "face_pin")  # also proves the caller is the owner


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db), user: User = Depends(get_user_allow_locked)):
    import time

    from app.core.deps import _authenticate
    tpl = face_svc.get_template(db, user.id)
    _, claims = _authenticate(request, db)
    return {"enrolled": tpl is not None, "locked": claims["ul"] <= int(time.time()),
            "available": face_svc.available(), "allow_login": bool(tpl and tpl.allow_login)}


@router.post("/enroll")
def enroll(body: EnrollIn, request: Request, response: Response, db: Session = Depends(get_db),
           user: User = Depends(get_user_allow_locked)):
    _require_pin(db, user, body.pin, request)  # also proves the caller is the account owner
    try:
        n = face_svc.enroll(db, user.id, body.images)
    except face_svc.FaceError as e:
        raise HTTPException(422, str(e))
    tpl = face_svc.get_template(db, user.id)
    tpl.allow_login = body.allow_login
    db.commit()
    audit(db, user.id, "face.enroll", "face", user.id, {"samples": n, "allow_login": body.allow_login}, _ip(request))
    set_session_cookie(response, user.id)
    return {"enrolled": True, "samples": n}


@router.post("/verify")
def verify(body: VerifyIn, request: Request, response: Response, db: Session = Depends(get_db),
           user: User = Depends(get_user_allow_locked)):
    try:
        ok = face_svc.verify(db, user.id, body.image)
    except face_svc.FaceError as e:
        raise HTTPException(422, str(e))
    audit(db, user.id, "face.verify_ok" if ok else "face.verify_failed", "face", user.id, ip=_ip(request))
    if not ok:
        raise HTTPException(401, "Face not recognised")
    set_session_cookie(response, user.id)
    return {"ok": True}


@router.post("/lock")
def lock(request: Request, response: Response, db: Session = Depends(get_db), user: User = Depends(get_user_allow_locked)):
    if not face_svc.get_template(db, user.id):
        raise HTTPException(409, "Set up face lock first")
    audit(db, user.id, "face.lock", "face", user.id, ip=_ip(request))
    set_session_cookie(response, user.id, unlocked=False)
    return {"locked": True}


@router.post("/remove")
def remove(body: PinBody, request: Request, db: Session = Depends(get_db), user: User = Depends(get_user_allow_locked)):
    _require_pin(db, user, body.pin, request)
    face_svc.remove(db, user.id)
    audit(db, user.id, "face.remove", "face", user.id, ip=_ip(request))
    return {"enrolled": False}


@router.post("/login-setting")
def login_setting(body: LoginSettingIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_user_allow_locked)):
    _require_pin(db, user, body.pin, request)
    tpl = face_svc.get_template(db, user.id)
    if not tpl:
        raise HTTPException(409, "Enroll your face first")
    tpl.allow_login = body.allow_login
    db.commit()
    audit(db, user.id, "face.login_setting", "face", user.id, {"allow_login": body.allow_login}, _ip(request))
    return {"allow_login": tpl.allow_login}


# ---- sign in with a face (no session yet) ----
_fails: dict[str, list] = {}  # ip -> [count, blocked_until_epoch]
MAX_FACE_FAILS, BLOCK_SECONDS = 5, 300


@router.post("/login")
def face_login(body: VerifyIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Sign in with a face. Strict match, per-IP lockout after repeated misses, and every attempt is audit logged.
    Without liveness detection a photo of the owner may work: that is why this can be switched off in Settings."""
    import time
    ip = _ip(request)
    rec = _fails.get(ip, [0, 0.0])
    if rec[1] > time.time():
        raise HTTPException(429, "Too many failed face attempts. Use the PIN, or wait a few minutes.")
    try:
        uid = face_svc.identify(db, body.image)
    except face_svc.FaceError as e:
        raise HTTPException(422, str(e))  # no / unclear face: not counted against the lockout
    if uid is None:
        rec[0] += 1
        if rec[0] >= MAX_FACE_FAILS:
            rec = [0, time.time() + BLOCK_SECONDS]
        _fails[ip] = rec
        audit(db, None, "face.login_failed", "face", "", ip=ip)
        raise HTTPException(401, "Face not recognised")
    _fails.pop(ip, None)
    user = db.get(User, uid)
    audit(db, uid, "face.login", "face", uid, ip=ip)
    set_session_cookie(response, uid)
    return {"id": user.id, "email": user.email, "name": user.name, "currency": user.currency}
