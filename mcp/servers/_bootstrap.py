"""Shared bootstrap for public MCP servers.

Servers may import ONLY `app.integrations.*` (public-data adapters). They never import models,
database or settings code, and the client launches them with a scrubbed environment.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))


def safe(fn, *args, **kwargs) -> str:
    try:
        return json.dumps(fn(*args, **kwargs), default=str)
    except Exception as e:  # upstream failures are reported to the model, not raised
        return json.dumps({"error": str(e) or type(e).__name__})
