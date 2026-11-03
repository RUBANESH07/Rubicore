"""Tiny shared HTTP helper with TTL cache. Pure public-data code: must not import anything private."""
import threading
import time

import httpx

UA = {"User-Agent": "Mozilla/5.0 (compatible; RubiCore/1.0)"}
_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


class ProviderError(Exception):
    pass


def get(url: str, *, params=None, ttl: int = 60, as_json: bool = True, headers=None, timeout: float = 12.0):
    key = f"{url}|{sorted((params or {}).items())}"
    with _lock:
        hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        r = httpx.get(url, params=params, headers={**UA, **(headers or {})}, timeout=timeout, follow_redirects=True)
        r.raise_for_status()
        data = r.json() if as_json else r.text
    except (httpx.HTTPError, ValueError) as e:
        raise ProviderError(f"Upstream request failed: {type(e).__name__}") from e
    with _lock:
        _cache[key] = (time.time() + ttl, data)
    return data
