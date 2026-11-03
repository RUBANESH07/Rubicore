import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _bootstrap import safe  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

from app.integrations import public_data  # noqa: E402

mcp = FastMCP("rubicore-search")


@mcp.tool()
def web_search(query: str) -> str:
    """Search public encyclopedic knowledge (Wikipedia) for general facts and definitions. Never include personal or financial details in the query."""
    return safe(lambda: public_data.wiki_search(query[:150]))


if __name__ == "__main__":
    mcp.run()
