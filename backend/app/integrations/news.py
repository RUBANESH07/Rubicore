"""News adapters: public RSS feeds merged with Google News topic searches. No API keys required."""
import html
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

from app.integrations.http import ProviderError, get

GN = "https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"

CATEGORIES = {
    "technology": {"gn": "technology when:2d", "feeds": [("TechCrunch", "https://techcrunch.com/feed/"),
                                                         ("The Verge", "https://www.theverge.com/rss/index.xml")]},
    "ai": {"gn": "artificial intelligence when:2d", "feeds": []},
    "business": {"gn": "business India when:2d", "feeds": [("Economic Times", "https://economictimes.indiatimes.com/rssfeedstopstories.cms"),
                                                           ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml")]},
    "finance": {"gn": "personal finance banking RBI when:2d", "feeds": []},
    "stock-market": {"gn": "NIFTY SENSEX stock market when:2d", "feeds": [("ET Markets", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms")]},
    "economy": {"gn": "India economy inflation GDP when:3d", "feeds": []},
    "startups": {"gn": "startups funding India when:3d", "feeds": []},
    "science": {"gn": "science discovery when:3d", "feeds": [("BBC Science", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml")]},
    "global": {"gn": "world news when:1d", "feeds": [("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml")]},
    "india": {"gn": "India news when:1d", "feeds": [("The Hindu", "https://www.thehindu.com/news/national/feeder/default.rss")]},
}

IMPORTANT = re.compile(r"\b(RBI|repo rate|rate cut|rate hike|SEBI|budget|inflation|crash|plunge|surge|record high|"
                       r"recession|GDP|Fed|tariff|circuit breaker|default|ban)\b", re.I)


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _parse(xml_text: str, default_source: str, category: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out = []
    for it in root.iter("item"):
        title, link = _clean(it.findtext("title")), (it.findtext("link") or "").strip()
        if not title or not link:
            continue
        source_el = it.find("source")
        source = _clean(source_el.text) if source_el is not None and source_el.text else default_source
        if source_el is not None and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        summary = _clean(it.findtext("description"))
        if summary.lower().startswith(title.lower()[:40]) or len(summary) < 30:
            summary = ""  # Google News descriptions just repeat the headline
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate"))
            iso, ts = dt.isoformat(), dt.timestamp()
        except (TypeError, ValueError):
            iso, ts = "", 0.0
        out.append({"title": title, "url": link, "source": source or "Unknown", "summary": summary[:400],
                    "published_at": iso, "ts": ts, "category": category,
                    "important": bool(IMPORTANT.search(title))})
    return out


def _fetch_feed(args):
    name, url, category = args
    try:
        return _parse(get(url, ttl=300, as_json=False), name, category)
    except ProviderError:
        return []


def latest(category: str = "business", query: str = "", limit: int = 20) -> list[dict]:
    jobs = []
    if query:
        jobs.append(("Google News", GN.format(q=quote_plus(query + " when:7d")), category or "search"))
    else:
        cfg = CATEGORIES.get(category, CATEGORIES["business"])
        jobs.append(("Google News", GN.format(q=quote_plus(cfg["gn"])), category))
        jobs += [(n, u, category) for n, u in cfg["feeds"]]
    with ThreadPoolExecutor(max_workers=4) as ex:
        items = [i for batch in ex.map(_fetch_feed, jobs) for i in batch]
    seen, out = set(), []
    for it in sorted(items, key=lambda i: -i["ts"]):
        key = it["title"].lower()[:60]
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out[:limit]


def company_news(name: str, limit: int = 8) -> list[dict]:
    return latest("stock-market", query=f"{name} stock", limit=limit)
