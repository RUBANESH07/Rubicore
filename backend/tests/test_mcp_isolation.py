"""MCP must never touch private finance data."""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN = re.compile(r"app\.(models|core\.database|core\.security|core\.deps|repositories|services|analytics|agents|api)|sqlalchemy|database_url|secret_key", re.I)


def test_mcp_code_has_no_private_imports():
    files = list((ROOT / "mcp").rglob("*.py")) + list((ROOT / "backend" / "app" / "integrations").rglob("*.py"))
    assert files
    for f in files:
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            mods = ([a.name for a in node.names] if isinstance(node, ast.Import)
                    else [node.module or ""] if isinstance(node, ast.ImportFrom) else [])
            for mod in mods:
                assert not FORBIDDEN.search(mod), f"{f} imports private module {mod}"


def test_servers_launch_with_scrubbed_env():
    import importlib.util
    spec = importlib.util.spec_from_file_location("c", ROOT / "mcp" / "client" / "client.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    params = m.McpHub()._params("news")
    assert set(params.env) <= {"PYTHONIOENCODING", "STOCK_PROVIDER"}


def test_arg_sanitizer_drops_unknown_and_truncates():
    import importlib.util
    spec = importlib.util.spec_from_file_location("c2", ROOT / "mcp" / "client" / "client.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    out = m.McpHub.sanitize_args({"properties": {"q": {}}}, {"q": "x" * 999, "balance": 1234, "o": {"a": 1}})
    assert out == {"q": "x" * 200}


def test_public_arg_guard_blocks_private_terms():
    sys.path.insert(0, str(ROOT / "backend"))
    from app.agents.agent import _guard_public_args
    assert _guard_public_args({"query": "alice@example.com salary"}, [])
    assert _guard_public_args({"query": "HDFC Savings details"}, ["hdfc savings"])
    assert _guard_public_args({"query": "my balance is low"}, [])
    assert not _guard_public_args({"query": "NIFTY outlook"}, ["hdfc savings"])


def test_mcp_code_never_touches_ride_or_location_data():
    """GPS history, parking and fuel records stay out of every public MCP server and its adapters."""
    pattern = re.compile(r"RideGpsPoint|ride_gps|saved_locations|SavedLocation|fuel_entries|FuelEntry|app\.ride", re.I)
    files = list((ROOT / "mcp").rglob("*.py")) + list((ROOT / "backend" / "app" / "integrations").rglob("*.py"))
    for f in files:
        assert not pattern.search(f.read_text(encoding="utf-8")), f"{f} references ride/location data"
    servers = (ROOT / "mcp" / "config" / "servers.json").read_text(encoding="utf-8").lower()
    assert "ride" not in servers and "gps" not in servers
