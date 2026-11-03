"""LLM provider layer. Gemini (default, with native tool calling) or Ollama (text generation)."""
import logging
import re
import time

import httpx

from app.core.config import settings

log = logging.getLogger("rubicore.llm")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def available() -> bool:
    if settings.llm_provider == "gemini":
        return bool(settings.gemini_api_key)
    return settings.llm_provider == "ollama"


def supports_tools() -> bool:
    return settings.llm_provider == "gemini" and bool(settings.gemini_api_key)


def gemini_raw(contents: list[dict], system: str | None = None, tools: list[dict] | None = None) -> dict:
    body: dict = {"contents": contents, "generationConfig": {"temperature": 0.3}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if tools:
        body["tools"] = [{"functionDeclarations": tools}]
    for attempt in (1, 2):
        r = httpx.post(GEMINI_URL.format(model=settings.gemini_model), json=body, timeout=60,
                       headers={"x-goog-api-key": settings.gemini_api_key})
        if r.status_code != 429 or attempt == 2:
            break
        m = re.search(r'"retryDelay":\s*"(\d+)', r.text)  # free tier is rate limited per minute
        delay = int(m.group(1)) + 1 if m else 5
        if delay > 30:
            break
        time.sleep(delay)
    if r.status_code >= 400:
        log.warning("Gemini error %s: %s", r.status_code, r.text[:300])
        r.raise_for_status()
    return r.json()


def generate(prompt: str, system: str | None = None) -> str | None:
    """Plain text generation. Returns None when no LLM is configured or the call fails."""
    if not available():
        return None
    try:
        if settings.llm_provider == "gemini":
            data = gemini_raw([{"role": "user", "parts": [{"text": prompt}]}], system)
            parts = data["candidates"][0]["content"].get("parts", [])
            return "".join(p.get("text", "") for p in parts).strip() or None
        r = httpx.post(f"{settings.ollama_base_url}/api/chat", timeout=120, json={
            "model": settings.ollama_model, "stream": False,
            "messages": ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]})
        r.raise_for_status()
        return r.json()["message"]["content"].strip()
    except Exception as e:  # noqa: BLE001
        log.warning("LLM generate failed: %s", type(e).__name__)
        return None
