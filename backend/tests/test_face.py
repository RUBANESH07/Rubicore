"""Face lock flow. Detection/embedding is stubbed (no real faces in CI); matching, encryption, locking and API rules run for real."""
import base64

import cv2
import numpy as np
import pytest

from app.services import face as face_svc


def img(seed: int, noise: int = 0) -> str:
    rng = np.random.default_rng(seed)
    base = cv2.GaussianBlur((rng.random((140, 140)) * 255).astype(np.uint8), (0, 0), 3)
    base = cv2.normalize(base, None, 0, 255, cv2.NORM_MINMAX)
    if noise:
        base = np.clip(base.astype(int) + np.random.default_rng(noise).integers(-6, 6, base.shape), 0, 255).astype(np.uint8)
    return "data:image/jpeg;base64," + base64.b64encode(cv2.imencode(".jpg", base)[1].tobytes()).decode()


@pytest.fixture(autouse=True)
def stub_detector(monkeypatch):
    def fake_embedding(rgb):  # stands in for the 128-d dlib embedding: unit-norm vector of a downsampled image
        v = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (16, 8)).astype(float).ravel()
        v -= v.mean()
        return v / np.linalg.norm(v)

    monkeypatch.setattr(face_svc, "extract_face", fake_embedding)


PW = "1224"


def enrolled(client, seed=1):
    r = client.post("/api/face/enroll", json={"pin": PW, "images": [img(seed, n + 1) for n in range(6)]})
    assert r.status_code == 200, r.text
    return r


def test_enroll_requires_pin_and_samples(client):
    imgs = [img(1, n + 1) for n in range(6)]
    assert client.post("/api/face/enroll", json={"pin": "0000", "images": imgs}).status_code == 401
    assert client.post("/api/face/enroll", json={"pin": PW, "images": imgs[:3]}).status_code == 422
    st = client.get("/api/face/status").json()
    assert st["enrolled"] is False and st["locked"] is False


def test_lock_blocks_api_until_unlocked(client):
    enrolled(client)
    assert client.get("/api/accounts").status_code == 200
    assert client.post("/api/face/lock").status_code == 200
    assert client.get("/api/accounts").status_code == 423            # data endpoints locked
    assert client.get("/api/face/status").json()["locked"] is True   # lock screen endpoints still work
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/unlock", json={"pin": "0000"}).status_code == 401
    assert client.get("/api/accounts").status_code == 423
    assert client.post("/api/auth/unlock", json={"pin": PW}).status_code == 200
    assert client.get("/api/accounts").status_code == 200


def test_face_unlock_and_impostor_rejected(client):
    enrolled(client, seed=1)
    client.post("/api/face/lock")
    assert client.post("/api/face/verify", json={"image": img(2, 5)}).status_code == 401   # different "person"
    assert client.get("/api/accounts").status_code == 423
    assert client.post("/api/face/verify", json={"image": img(1, 99)}).status_code == 200  # enrolled "person"
    assert client.get("/api/accounts").status_code == 200


def test_lockout_after_repeated_failures(client):
    enrolled(client, seed=1)
    client.post("/api/face/lock")
    for _ in range(5):
        assert client.post("/api/face/verify", json={"image": img(3, 7)}).status_code == 401
    r = client.post("/api/face/verify", json={"image": img(1, 99)})  # even the right face is refused now
    assert r.status_code == 422 and "password" in r.json()["detail"].lower()
    assert client.post("/api/auth/unlock", json={"pin": PW}).status_code == 200


def test_template_is_encrypted_and_remove(client):
    enrolled(client)
    from app.core.database import SessionLocal
    from app.models import FaceTemplate
    with SessionLocal() as db:
        blob = db.query(FaceTemplate).first().data
    assert b"embeddings" not in blob
    assert client.post("/api/face/remove", json={"pin": "0000"}).status_code == 401
    assert client.post("/api/face/remove", json={"pin": PW}).status_code == 200
    assert client.get("/api/face/status").json()["enrolled"] is False
    assert client.post("/api/face/lock").status_code == 409


def test_users_without_face_lock_never_locked(client):
    assert client.get("/api/accounts").status_code == 200
    assert client.post("/api/face/lock").status_code == 409


def test_inconsistent_photos_rejected(client):
    mixed = [img(1, 1), img(1, 2), img(1, 3), img(7, 4), img(8, 5), img(9, 6)]
    r = client.post("/api/face/enroll", json={"pin": PW, "images": mixed})
    assert r.status_code == 422 and "same person" in r.json()["detail"]


def test_status_reports_engine_availability(client):
    assert "available" in client.get("/api/face/status").json()


# ---------------- face sign-in (no session yet) ----------------
def anon():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture()
def clean_login_state():
    from app.api import face as face_api
    face_api._fails.clear()
    yield
    face_api._fails.clear()


def enroll_login(client, seed, allow=True):
    r = client.post("/api/face/enroll", json={"pin": PW, "allow_login": allow, "images": [img(seed, n + 1) for n in range(6)]})
    assert r.status_code == 200, r.text


def test_face_sign_in_success_and_impostor(client, clean_login_state):
    enroll_login(client, seed=21)
    try:
        a = anon()
        assert a.get("/api/accounts").status_code == 401
        assert a.get("/api/auth/options").json()["face_login"] is True
        assert a.post("/api/face/login", json={"image": img(22, 5)}).status_code == 401        # someone else's face
        ok = a.post("/api/face/login", json={"image": img(21, 77)})
        assert ok.status_code == 200 and ok.json()["name"] == "Owner"
        assert a.get("/api/accounts").status_code == 200                                         # real session now
    finally:
        client.post("/api/face/remove", json={"pin": PW})


def test_face_sign_in_is_off_unless_enabled(client, clean_login_state):
    enroll_login(client, seed=31, allow=False)
    try:
        a = anon()
        assert a.post("/api/face/login", json={"image": img(31, 9)}).status_code == 401
        assert client.get("/api/face/status").json()["allow_login"] is False
        assert client.post("/api/face/login-setting", json={"pin": "0000", "allow_login": True}).status_code == 401
        assert client.post("/api/face/login-setting", json={"pin": PW, "allow_login": True}).json() == {"allow_login": True}
        assert a.post("/api/face/login", json={"image": img(31, 10)}).status_code == 200
        client.post("/api/face/login-setting", json={"pin": PW, "allow_login": False})
        assert anon().post("/api/face/login", json={"image": img(31, 11)}).status_code == 401
    finally:
        client.post("/api/face/remove", json={"pin": PW})


def test_face_sign_in_lockout_per_ip(client, clean_login_state):
    enroll_login(client, seed=41)
    try:
        a = anon()
        for _ in range(5):
            assert a.post("/api/face/login", json={"image": img(99, 3)}).status_code == 401
        blocked = a.post("/api/face/login", json={"image": img(41, 8)})                         # even the right face is refused
        assert blocked.status_code == 429
    finally:
        client.post("/api/face/remove", json={"pin": PW})


def test_face_sign_in_unreadable_photo_does_not_count_as_a_miss(client, clean_login_state, monkeypatch):
    enroll_login(client, seed=61)
    try:
        a = anon()
        monkeypatch.setattr(face_svc, "extract_face", lambda g: (_ for _ in ()).throw(face_svc.FaceError("No face found.")))
        for _ in range(8):
            assert a.post("/api/face/login", json={"image": img(61, 2)}).status_code == 422     # camera saw no face: not a lockout
    finally:
        monkeypatch.undo()
        client.post("/api/face/remove", json={"pin": PW})


# ---------------- lock applies to every account, face or not ----------------
def test_owner_can_lock_and_unlock_by_pin(client):
    assert client.get("/api/accounts").status_code == 200
    assert client.post("/api/auth/lock").status_code == 200
    assert client.get("/api/accounts").status_code == 423                       # no face enrolled, still locked
    st = client.get("/api/face/status").json()
    assert st["locked"] is True and st["enrolled"] is False
    assert client.post("/api/auth/unlock", json={"pin": "0000"}).status_code == 401
    assert client.post("/api/auth/unlock", json={"pin": PW}).status_code == 200
    assert client.get("/api/accounts").status_code == 200


def test_idle_timeout_locks_without_any_face_setup(client):
    from fastapi.testclient import TestClient
    from app.core.security import COOKIE_NAME, create_access_token, decode_token
    from app.main import app
    uid = decode_token(client.cookies.get(COOKIE_NAME))
    expired = create_access_token(uid, unlocked=False)                            # a session whose idle window has run out
    a = TestClient(app, headers={"Authorization": f"Bearer {expired}"})
    assert a.get("/api/accounts").status_code == 423
    assert a.get("/api/auth/me").status_code == 200                               # the lock screen can still identify the user
    assert a.post("/api/auth/unlock", json={"pin": PW}).status_code == 200   # unlock issues a fresh cookie
    assert a.get("/api/accounts").status_code == 200


def test_session_cookie_is_not_persistent(make_client):
    from fastapi.testclient import TestClient
    from app.main import app
    make_client()
    c = TestClient(app)
    r = c.post("/api/auth/pin", json={"pin": PW})
    header = r.headers["set-cookie"].lower()
    assert "httponly" in header and "max-age" not in header and "expires" not in header   # dies with the browser
