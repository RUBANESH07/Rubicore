import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding-window limiter per client IP. Swap for Redis when running multiple workers."""

    def __init__(self, app):
        super().__init__(app)
        self.hits: dict[tuple[str, str], deque] = defaultdict(deque)

    def _bucket(self, path: str) -> tuple[str, int]:
        if path.startswith(("/api/auth/pin", "/api/auth/unlock", "/api/auth/token", "/api/face/verify", "/api/face/login",
                            "/api/face/enroll")):
            return "auth", settings.rate_limit_auth
        if path.startswith("/api/chat"):
            return "chat", settings.rate_limit_chat
        return "default", settings.rate_limit_default

    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/api"):
            bucket, limit = self._bucket(request.url.path)
            ip = request.client.host if request.client else "unknown"
            q = self.hits[(ip, bucket)]
            now = time.monotonic()
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                return JSONResponse({"detail": "Rate limit exceeded. Try again shortly."}, status_code=429,
                                    headers={"Retry-After": "60"})
            q.append(now)
        return await call_next(request)
