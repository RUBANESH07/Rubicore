import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ.update(DATABASE_URL=f"sqlite:///{Path(_tmp, 'test.db').as_posix()}", LLM_PROVIDER="none",
                  GEMINI_API_KEY="", RATE_LIMIT_AUTH="1000", RATE_LIMIT_DEFAULT="10000", RATE_LIMIT_CHAT="1000",
                  SECRET_KEY="test-secret-test-secret-test-secret-123", APP_PIN="1224")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def make_client():
    with TestClient(app) as first:  # runs migrations once
        pass

    def factory(_name: str = ""):
        """A client opened with the PIN, on an empty database (there is only ever one owner)."""
        from app.core import security
        from app.core.database import Base, engine
        with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(table.delete())
        security._pin_fails.clear()
        c = TestClient(app)
        r = c.post("/api/auth/pin", json={"pin": "1224"})
        assert r.status_code == 200, r.text
        return c
    return factory


@pytest.fixture()
def client(make_client, request):
    return make_client(f"{request.node.name}@example.com")
