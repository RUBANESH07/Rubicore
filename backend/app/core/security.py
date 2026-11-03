import hmac
import time
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings

ALGORITHM = "HS256"
COOKIE_NAME = "rp_session"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def check_pin(pin: str) -> bool:
    return hmac.compare_digest(pin.encode(), settings.app_pin.encode())


_pin_fails: dict[str, list] = {}  # ip -> [count, blocked_until_epoch]


def pin_blocked_for(ip: str) -> int:
    """Seconds this client must still wait after too many wrong PINs (0 = may try)."""
    until = _pin_fails.get(ip, [0, 0.0])[1]
    return int(until - time.time()) + 1 if until > time.time() else 0


def pin_failed(ip: str) -> None:
    rec = _pin_fails.get(ip, [0, 0.0])
    rec[0] += 1
    if rec[0] >= settings.pin_max_failures:
        rec = [0, time.time() + settings.pin_lockout_minutes * 60]
    _pin_fails[ip] = rec


def pin_ok(ip: str) -> None:
    _pin_fails.pop(ip, None)


def create_access_token(user_id: int, unlocked: bool = True, lifetime_min: int | None = None, ul_min: int | None = None) -> str:
    """`ul` = epoch seconds until which the session is unlocked (only enforced for users with face lock)."""
    now = datetime.now(timezone.utc)
    ul = int(now.timestamp()) + (ul_min or settings.face_lock_idle_minutes) * 60 if unlocked else 0
    payload = {"sub": str(user_id), "iat": now, "jti": uuid.uuid4().hex, "ul": ul,
               "exp": now + timedelta(minutes=lifetime_min or settings.access_token_minutes)}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_claims(token: str) -> dict | None:
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return {"user_id": int(data["sub"]), "ul": int(data.get("ul", 0))}
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def decode_token(token: str) -> int | None:
    c = decode_claims(token)
    return c["user_id"] if c else None


def set_session_cookie(resp, user_id: int, unlocked: bool = True) -> None:
    resp.set_cookie(COOKIE_NAME, create_access_token(user_id, unlocked), httponly=True, samesite="lax",
                    secure=settings.cookie_secure, path="/")  # no max-age: a session cookie, gone when the browser closes
