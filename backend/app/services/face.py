"""Face lock engine: the Python `face_recognition` library (dlib 128-d face embeddings).

This is a convenience lock layered on top of password login, NOT a replacement for it:
  * a face can never create a session; it only unlocks one that a password already created
  * there is no liveness check, so a photo or video of the user may fool it
  * only embeddings (128 numbers per photo) are stored, encrypted with a key derived from SECRET_KEY;
    photos are never saved
"""
import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

import numpy as np
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FaceTemplate

MIN_SAMPLES = 5
MAX_SAMPLES = 12
MAX_IMAGE_BYTES = 400_000
TOLERANCE = 0.5          # lower is stricter; the library default is 0.6
SAME_PERSON_MAX = 0.6    # enrollment photos must all look like one person
VERSION = 2
LOGIN_TOLERANCE = 0.45   # stricter than unlock: this one creates a session without a password
LOGIN_MARGIN = 0.06      # the best match must beat any other enrolled person by this much


class FaceError(Exception):
    pass


def _lib():
    try:
        import face_recognition
        return face_recognition
    except ImportError:
        raise FaceError("Face recognition is not installed on the server (see README: face lock setup).")


def available() -> bool:
    try:
        _lib()
        return True
    except FaceError:
        return False


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("face:" + settings.secret_key).encode()).digest()))


def decode_image(data_url: str) -> np.ndarray:
    """Data URL (JPEG/PNG) -> RGB array."""
    import cv2
    raw = data_url.split(",", 1)[-1]
    if len(raw) > MAX_IMAGE_BYTES * 4 // 3:
        raise FaceError("Image too large")
    try:
        buf = np.frombuffer(base64.b64decode(raw, validate=True), np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except Exception:  # noqa: BLE001
        raise FaceError("Invalid image")
    if img is None or min(img.shape[:2]) < 120 or max(img.shape[:2]) > 2000:
        raise FaceError("Invalid image size")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def extract_face(rgb: np.ndarray) -> np.ndarray:
    """Exactly one clear face -> 128-d embedding."""
    fr = _lib()
    locs = fr.face_locations(rgb, number_of_times_to_upsample=1, model="hog")
    if not locs:
        raise FaceError("No face found. Face the camera in good light.")
    area = lambda l: (l[2] - l[0]) * (l[1] - l[3])  # noqa: E731  (top, right, bottom, left)
    locs.sort(key=area, reverse=True)
    if len(locs) > 1 and area(locs[1]) > 0.4 * area(locs[0]):
        raise FaceError("More than one face in view.")
    if area(locs[0]) < 60 * 60:
        raise FaceError("Move closer to the camera.")
    enc = fr.face_encodings(rgb, [locs[0]], num_jitters=1)
    if not enc:
        raise FaceError("Couldn't read the face. Try again.")
    return enc[0]


def _distances(known: np.ndarray, probe: np.ndarray) -> np.ndarray:
    return np.linalg.norm(known - probe, axis=1)


def _pack(embeddings: list[np.ndarray]) -> bytes:
    payload = {"v": VERSION, "embeddings": [e.round(6).tolist() for e in embeddings]}
    return _fernet().encrypt(json.dumps(payload).encode())


def _unpack(blob: bytes) -> np.ndarray:
    try:
        payload = json.loads(_fernet().decrypt(blob))
    except InvalidToken:
        raise FaceError("Stored face data cannot be read (SECRET_KEY changed?). Enroll again.")
    if payload.get("v") != VERSION:
        raise FaceError("Face data is from an older version. Enroll again.")
    return np.array(payload["embeddings"], dtype=np.float64)


def get_template(db: Session, user_id: int) -> FaceTemplate | None:
    return db.scalar(select(FaceTemplate).where(FaceTemplate.user_id == user_id))


def enroll(db: Session, user_id: int, images: list[str]) -> int:
    if len(images) < MIN_SAMPLES:
        raise FaceError(f"Capture at least {MIN_SAMPLES} photos.")
    embeddings = []
    for data_url in images[:MAX_SAMPLES]:
        try:
            embeddings.append(extract_face(decode_image(data_url)))
        except FaceError as e:
            if "not installed" in str(e):
                raise
    if len(embeddings) < MIN_SAMPLES:
        raise FaceError(f"Only {len(embeddings)} of {len(images)} photos had one clear face. Try again with better light.")
    known = np.array(embeddings)
    spread = max(_distances(known, e).max() for e in known)
    if spread > SAME_PERSON_MAX:
        raise FaceError("The photos don't look like the same person. Make sure only you are in frame.")
    blob = _pack(embeddings)
    tpl = get_template(db, user_id)
    if tpl:
        tpl.data, tpl.failed_attempts, tpl.locked_until = blob, 0, None
    else:
        db.add(FaceTemplate(user_id=user_id, data=blob))
    db.commit()
    return len(embeddings)


def remove(db: Session, user_id: int) -> None:
    tpl = get_template(db, user_id)
    if tpl:
        db.delete(tpl)
        db.commit()


def verify(db: Session, user_id: int, image: str) -> bool:
    """True on match. Repeated failures disable face unlock for a few minutes (password still works)."""
    tpl = get_template(db, user_id)
    if not tpl:
        raise FaceError("Face lock is not set up.")
    now = datetime.now(timezone.utc)
    if tpl.locked_until and tpl.locked_until.replace(tzinfo=timezone.utc) > now:
        raise FaceError("Too many failed attempts. Use your password.")
    probe = extract_face(decode_image(image))  # no-face errors don't count as an impostor attempt
    known = _unpack(tpl.data)
    nearest = np.sort(_distances(known, probe))[:3]
    if float(nearest.mean()) <= TOLERANCE:
        tpl.failed_attempts, tpl.locked_until = 0, None
        db.commit()
        return True
    tpl.failed_attempts += 1
    if tpl.failed_attempts >= settings.face_max_failures:
        tpl.failed_attempts = 0
        tpl.locked_until = now + timedelta(minutes=settings.face_lockout_minutes)
    db.commit()
    return False


def login_available(db: Session) -> bool:
    return available() and db.scalar(select(FaceTemplate.id).where(FaceTemplate.allow_login.is_(True)).limit(1)) is not None


def identify(db: Session, image: str) -> int | None:
    """Who is this? Returns a user id, or None when nobody matches clearly. Raises FaceError for unusable photos."""
    probe = extract_face(decode_image(image))
    scored = []
    for tpl in db.scalars(select(FaceTemplate).where(FaceTemplate.allow_login.is_(True))):
        try:
            known = _unpack(tpl.data)
        except FaceError:
            continue
        scored.append((float(np.sort(_distances(known, probe))[:3].mean()), tpl.user_id))
    if not scored:
        return None
    scored.sort()
    best = scored[0]
    if best[0] > LOGIN_TOLERANCE:
        return None
    if len(scored) > 1 and scored[1][0] - best[0] < LOGIN_MARGIN:
        return None  # ambiguous between two enrolled people
    return best[1]
