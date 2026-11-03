"""Weather (Open-Meteo), economic indicators (World Bank) and encyclopedic search (Wikipedia). All keyless."""
from app.integrations.http import ProviderError, get

WMO = {0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
       51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
       71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers", 81: "Rain showers", 82: "Violent showers",
       95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail"}

INDICATORS = {"inflation": ("FP.CPI.TOTL.ZG", "Inflation, consumer prices (annual %)"),
              "gdp_growth": ("NY.GDP.MKTP.KD.ZG", "GDP growth (annual %)"),
              "unemployment": ("SL.UEM.TOTL.ZS", "Unemployment (% of labour force)"),
              "interest_rate": ("FR.INR.RINR", "Real interest rate (%)"),
              "gdp": ("NY.GDP.MKTP.CD", "GDP (current US$)")}


def weather(city: str) -> dict:
    geo = get("https://geocoding-api.open-meteo.com/v1/search", params={"name": city, "count": 1}, ttl=3600)
    if not geo.get("results"):
        raise ProviderError(f"Unknown location: {city}")
    g = geo["results"][0]
    w = get("https://api.open-meteo.com/v1/forecast", ttl=600, params={
        "latitude": g["latitude"], "longitude": g["longitude"], "timezone": "auto", "forecast_days": 3,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code"})
    cur, d = w["current"], w["daily"]
    return {"location": f"{g['name']}, {g.get('country', '')}", "temperature_c": cur["temperature_2m"],
            "humidity_pct": cur["relative_humidity_2m"], "wind_kmh": cur["wind_speed_10m"],
            "conditions": WMO.get(cur["weather_code"], "Unknown"),
            "forecast": [{"date": d["time"][i], "max_c": d["temperature_2m_max"][i], "min_c": d["temperature_2m_min"][i],
                          "rain_chance_pct": d["precipitation_probability_max"][i],
                          "conditions": WMO.get(d["weather_code"][i], "Unknown")} for i in range(len(d["time"]))],
            "source": "Open-Meteo"}


def economic_indicator(indicator: str = "inflation", country: str = "IN") -> dict:
    code, label = INDICATORS.get(indicator, INDICATORS["inflation"])
    data = get(f"https://api.worldbank.org/v2/country/{country}/indicator/{code}",
               params={"format": "json", "per_page": 8}, ttl=3600)
    rows = [{"year": r["date"], "value": r["value"]} for r in (data[1] if len(data) > 1 and data[1] else [])
            if r["value"] is not None][:5]
    return {"indicator": label, "country": country.upper(), "values": rows, "source": "World Bank"}


def wiki_search(query: str, limit: int = 4) -> list[dict]:
    data = get("https://en.wikipedia.org/w/api.php", ttl=900, params={
        "action": "query", "list": "search", "srsearch": query, "srlimit": limit, "format": "json"})
    import re
    return [{"title": r["title"], "snippet": re.sub(r"<[^>]+>", "", r["snippet"]),
             "url": "https://en.wikipedia.org/wiki/" + r["title"].replace(" ", "_")}
            for r in data.get("query", {}).get("search", [])]
