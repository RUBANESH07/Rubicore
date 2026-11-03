"""Bridge from the backend to the public MCP client.

Loaded by file path (not `import mcp...`) so it can't shadow the pip `mcp` package. The bridge only ever
receives tool names and model-chosen arguments; it has no handle on the DB session or user records.
"""
import importlib.util
from functools import lru_cache
from pathlib import Path

from app.core.config import ROOT


@lru_cache
def hub():
    path = Path(ROOT) / "mcp" / "client" / "client.py"
    spec = importlib.util.spec_from_file_location("rubicore_mcp_client", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.McpHub()


def server_catalog() -> list[dict]:
    return hub().servers()


def tools_for(server_names: list[str]) -> dict[str, dict]:
    return hub().all_tools(server_names) if server_names else {}


def call(server: str, tool: str, args: dict) -> str:
    return hub().call_tool(server, tool, args)


_KEEP = {"type", "description", "properties", "required", "items", "enum"}


def to_gemini_schema(schema: dict) -> dict:
    """Reduce a JSON schema to the subset Gemini function declarations accept."""
    if not isinstance(schema, dict):
        return schema
    out = {}
    for k, v in schema.items():
        if k not in _KEEP:
            continue
        if k == "properties":
            out[k] = {pk: to_gemini_schema(pv) for pk, pv in v.items()}
        elif k == "items":
            out[k] = to_gemini_schema(v)
        else:
            out[k] = v
    return out
