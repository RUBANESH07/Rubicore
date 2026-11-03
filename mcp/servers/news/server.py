import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _bootstrap import safe  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

from app.integrations import news  # noqa: E402

mcp = FastMCP("rubicore-news")


@mcp.tool()
def get_news(category: str = "business", query: str = "", limit: int = 8) -> str:
    """Latest public headlines. category: technology, ai, business, finance, stock-market, economy, startups, science, global, india. Optional free-text query overrides category."""
    limit = max(1, min(limit, 15))
    def run():
        return [{k: i[k] for k in ("title", "source", "published_at", "url", "summary")}
                for i in news.latest(category, query[:120], limit)]
    return safe(run)


if __name__ == "__main__":
    mcp.run()
