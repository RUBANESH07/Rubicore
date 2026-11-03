"""Optional reverse geocoding (OpenStreetMap Nominatim). Only used when the user opts in, and only for a ride's
start and end coordinates (rounded), never for the whole GPS history."""
import re

from app.integrations.http import ProviderError, get


def reverse(lat: float, lon: float) -> str | None:
    try:
        data = get("https://nominatim.openstreetmap.org/reverse", ttl=86400,
                   params={"lat": round(lat, 4), "lon": round(lon, 4), "format": "jsonv2", "zoom": 16})
    except ProviderError:
        return None
    a = data.get("address", {}) if isinstance(data, dict) else {}
    parts = [a.get("road") or a.get("neighbourhood") or a.get("suburb"), a.get("suburb") or a.get("city_district"),
             a.get("city") or a.get("town") or a.get("village")]
    seen, out = set(), []
    for p in parts:
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    label = ", ".join(out) or (data.get("display_name", "") if isinstance(data, dict) else "")
    return re.sub(r"\s+", " ", label)[:200] or None
