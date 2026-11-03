import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _bootstrap import safe  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

from app.integrations import stocks  # noqa: E402

mcp = FastMCP("rubicore-stocks")


@mcp.tool()
def get_stock_quote(symbol: str, exchange: str = "NSE") -> str:
    """Public market quote for an Indian stock or index (e.g. RELIANCE, TCS, NIFTY, SENSEX). exchange is NSE or BSE."""
    return safe(lambda: stocks.provider().quote(stocks.normalize_symbol(symbol, exchange)))


@mcp.tool()
def get_index_summary() -> str:
    """Current level and daily change of NIFTY 50, SENSEX and NIFTY BANK."""
    def run():
        p, out = stocks.provider(), []
        for name, sym in stocks.INDICES:
            try:
                q = p.quote(sym)
                out.append({"index": name, "level": q["price"], "change": q["change"], "change_pct": q["change_pct"]})
            except Exception as e:
                out.append({"index": name, "error": str(e)})
        return out
    return safe(run)


@mcp.tool()
def get_company_info(symbol: str, exchange: str = "NSE") -> str:
    """Public company fundamentals (sector, market cap, P/E, etc.) plus technical indicators for a stock."""
    def run():
        p, sym = stocks.provider(), stocks.normalize_symbol(symbol, exchange)
        pts = p.history(sym, "6mo", "1d")["points"]
        return {"quote": p.quote(sym), "fundamentals": p.fundamentals(sym), "technicals": stocks.indicators(pts)}
    return safe(run)


if __name__ == "__main__":
    mcp.run()
