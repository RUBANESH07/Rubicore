import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _bootstrap import safe  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

from app.integrations import public_data  # noqa: E402

mcp = FastMCP("rubicore-public-data")


@mcp.tool()
def get_weather(city: str) -> str:
    """Current weather and 3-day forecast for a city."""
    return safe(public_data.weather, city[:80])


@mcp.tool()
def get_economic_indicator(indicator: str = "inflation", country: str = "IN") -> str:
    """Official macro data (World Bank). indicator: inflation, gdp_growth, unemployment, interest_rate, gdp. country: ISO code like IN, US."""
    return safe(public_data.economic_indicator, indicator, country[:3])


if __name__ == "__main__":
    mcp.run()
