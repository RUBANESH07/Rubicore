"""MCP client for RubiCore's public-data servers.

Security model:
  * Servers are spawned over stdio with a *scrubbed* environment (no DATABASE_URL, SECRET_KEY, API keys).
  * Only servers listed in config/servers.json can be started, and only tools they advertise can be called.
  * Arguments are validated against the advertised schema (unknown keys dropped, strings length-capped).
  * This module has no database or private-finance imports by design (enforced by backend/tests).
"""
import asyncio
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MCP_DIR = Path(__file__).resolve().parents[1]
MAX_STR = 200
ALLOWED_ENV = {"PYTHONIOENCODING": "utf-8", "STOCK_PROVIDER": "yahoo"}


def _run(coro):
    """Run a coroutine on a private event loop (works inside uvicorn worker threads, incl. Windows Proactor)."""
    result: dict = {}

    def target():
        loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
        try:
            result["v"] = loop.run_until_complete(coro)
        except BaseException as e:  # noqa: BLE001
            result["e"] = e
        finally:
            loop.close()

    t = threading.Thread(target=target)
    t.start()
    t.join()
    if "e" in result:
        raise result["e"]
    return result["v"]


class McpHub:
    def __init__(self, config_path: str | Path | None = None):
        self.config_path = Path(config_path or MCP_DIR / "config" / "servers.json")
        self._tools: dict[str, tuple[float, list[dict]]] = {}

    def servers(self) -> list[dict]:
        return json.loads(self.config_path.read_text(encoding="utf-8"))["servers"]

    def _server(self, name: str) -> dict:
        for s in self.servers():
            if s["name"] == name:
                return s
        raise KeyError(f"Unknown MCP server: {name}")

    def _params(self, name: str) -> StdioServerParameters:
        script = (MCP_DIR / self._server(name)["script"]).resolve()
        if MCP_DIR not in script.parents:
            raise PermissionError("Server script outside the MCP directory")
        return StdioServerParameters(command=sys.executable, args=[str(script)], env=dict(ALLOWED_ENV), cwd=str(MCP_DIR))

    async def _with_session(self, name: str, fn):
        async with stdio_client(self._params(name)) as (r, w):
            async with ClientSession(r, w) as session:
                await session.initialize()
                return await fn(session)

    def list_tools(self, name: str, ttl: int = 600) -> list[dict]:
        hit = self._tools.get(name)
        if hit and hit[0] > time.time():
            return hit[1]

        async def fn(s):
            res = await s.list_tools()
            return [{"name": t.name, "description": t.description or "", "input_schema": t.inputSchema} for t in res.tools]

        tools = _run(asyncio.wait_for(self._with_session(name, fn), 40))
        self._tools[name] = (time.time() + ttl, tools)
        return tools

    def all_tools(self, names: list[str]) -> dict[str, dict]:
        """tool name -> {server, description, input_schema}; servers are queried in parallel."""
        def one(n):
            try:
                return n, self.list_tools(n)
            except Exception:
                return n, []
        out: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=4) as ex:
            for server, tools in ex.map(one, names):
                for t in tools:
                    out[t["name"]] = {"server": server, **t}
        return out

    @staticmethod
    def sanitize_args(schema: dict, args: dict) -> dict:
        props = (schema or {}).get("properties", {})
        clean = {}
        for k, v in (args or {}).items():
            if k not in props:
                continue
            if isinstance(v, str):
                v = v[:MAX_STR]
            elif not isinstance(v, (int, float, bool)):
                continue
            clean[k] = v
        return clean

    def call_tool(self, server: str, tool: str, args: dict) -> str:
        spec = next((t for t in self.list_tools(server) if t["name"] == tool), None)
        if spec is None:
            raise PermissionError(f"Tool {tool!r} is not exposed by server {server!r}")
        clean = self.sanitize_args(spec["input_schema"], args)

        async def fn(s):
            res = await s.call_tool(tool, clean)
            return "\n".join(c.text for c in res.content if getattr(c, "text", None))

        return _run(asyncio.wait_for(self._with_session(server, fn), 40))
