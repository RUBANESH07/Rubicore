"""Stock market data adapters (public data only). Add a paid provider by subclassing StockProvider
and registering it in PROVIDERS; nothing else in the app changes."""
import math
import os
from abc import ABC, abstractmethod

import httpx

from app.integrations.http import UA, ProviderError, get

INDEX_ALIASES = {"NIFTY": "^NSEI", "NIFTY50": "^NSEI", "NIFTY 50": "^NSEI", "SENSEX": "^BSESN",
                 "BANKNIFTY": "^NSEBANK", "NIFTY BANK": "^NSEBANK"}
INDICES = [("NIFTY 50", "^NSEI"), ("SENSEX", "^BSESN"), ("NIFTY BANK", "^NSEBANK")]


def normalize_symbol(symbol: str, exchange: str = "NSE") -> str:
    s = symbol.strip().upper()
    if s in INDEX_ALIASES:
        return INDEX_ALIASES[s]
    if s.startswith("^") or "." in s:
        return s
    return f"{s}{'.BO' if exchange.upper() == 'BSE' else '.NS'}"


class StockProvider(ABC):
    name = "base"

    @abstractmethod
    def history(self, symbol: str, range_: str = "1mo", interval: str = "1d") -> dict: ...

    @abstractmethod
    def quote(self, symbol: str) -> dict: ...

    @abstractmethod
    def search(self, query: str) -> list[dict]: ...

    def fundamentals(self, symbol: str) -> dict:
        return {}


class YahooProvider(StockProvider):
    """Unofficial public Yahoo Finance endpoints. Data is typically delayed ~15 min for Indian markets."""
    name = "yahoo"
    base = "https://query1.finance.yahoo.com"

    def _chart(self, symbol, range_, interval, ttl=60):
        data = get(f"{self.base}/v8/finance/chart/{symbol}", params={"range": range_, "interval": interval}, ttl=ttl)
        res = (data.get("chart") or {}).get("result")
        if not res:
            raise ProviderError(f"No market data for {symbol}")
        return res[0]

    def history(self, symbol, range_="1mo", interval="1d"):
        r = self._chart(symbol, range_, interval, ttl=300)
        q = r["indicators"]["quote"][0]
        pts = []
        for i, ts in enumerate(r.get("timestamp") or []):
            c = q["close"][i]
            if c is None:
                continue
            pts.append({"t": ts, "open": q["open"][i], "high": q["high"][i], "low": q["low"][i],
                        "close": c, "volume": q["volume"][i] or 0})
        return {"symbol": symbol, "currency": r["meta"].get("currency"), "points": pts}

    def quote(self, symbol):
        r = self._chart(symbol, "5d", "1d")
        m = r["meta"]
        closes = [c for c in r["indicators"]["quote"][0]["close"] if c is not None]
        price = m.get("regularMarketPrice") or (closes[-1] if closes else None)
        prev = closes[-2] if len(closes) >= 2 else m.get("chartPreviousClose")
        change = (price - prev) if price is not None and prev else None
        return {"symbol": symbol, "name": m.get("longName") or m.get("shortName") or symbol,
                "exchange": m.get("fullExchangeName") or m.get("exchangeName"), "currency": m.get("currency"),
                "price": price, "previous_close": prev, "change": change,
                "change_pct": (change / prev * 100) if change is not None and prev else None,
                "day_high": m.get("regularMarketDayHigh"), "day_low": m.get("regularMarketDayLow"),
                "volume": m.get("regularMarketVolume"), "week52_high": m.get("fiftyTwoWeekHigh"),
                "week52_low": m.get("fiftyTwoWeekLow"), "market_time": m.get("regularMarketTime"),
                "source": "Yahoo Finance (delayed)"}

    def search(self, query):
        data = get(f"{self.base}/v1/finance/search", params={"q": query, "quotesCount": 8, "newsCount": 0}, ttl=600)
        return [{"symbol": q["symbol"], "name": q.get("longname") or q.get("shortname") or "",
                 "exchange": q.get("exchDisp", "")} for q in data.get("quotes", [])
                if q.get("symbol", "").endswith((".NS", ".BO")) or q.get("symbol", "").startswith("^")]

    def fundamentals(self, symbol):
        """Best-effort: quoteSummary needs a cookie+crumb. Returns {} if Yahoo refuses."""
        try:
            with httpx.Client(headers=UA, timeout=10, follow_redirects=True) as c:
                c.get("https://fc.yahoo.com")
                crumb = c.get(f"{self.base}/v1/test/getcrumb").text
                r = c.get(f"{self.base}/v10/finance/quoteSummary/{symbol}",
                          params={"modules": "summaryDetail,defaultKeyStatistics,financialData,assetProfile",
                                  "crumb": crumb})
                r.raise_for_status()
                res = r.json()["quoteSummary"]["result"][0]
        except Exception:
            return {}
        raw = lambda d, k: (d.get(k) or {}).get("raw") if isinstance(d.get(k), dict) else d.get(k)
        sd, ks, fd, ap = (res.get(k, {}) for k in ("summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"))
        return {"sector": ap.get("sector"), "industry": ap.get("industry"),
                "market_cap": raw(sd, "marketCap"), "pe_ratio": raw(sd, "trailingPE"),
                "forward_pe": raw(sd, "forwardPE"), "dividend_yield": raw(sd, "dividendYield"),
                "beta": raw(sd, "beta"), "eps": raw(ks, "trailingEps"), "book_value": raw(ks, "bookValue"),
                "price_to_book": raw(ks, "priceToBook"), "profit_margin": raw(fd, "profitMargins"),
                "roe": raw(fd, "returnOnEquity"), "debt_to_equity": raw(fd, "debtToEquity"),
                "revenue": raw(fd, "totalRevenue")}


PROVIDERS = {"yahoo": YahooProvider}


def provider() -> StockProvider:
    return PROVIDERS.get(os.environ.get("STOCK_PROVIDER", "yahoo"), YahooProvider)()


# ---------- technical indicators (computed locally from price history) ----------
def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def ema_series(vals, n):
    k, out = 2 / (n + 1), []
    for v in vals:
        out.append(v if not out else v * k + out[-1] * (1 - k))
    return out


def rsi(vals, n=14):
    if len(vals) <= n:
        return None
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = vals[i] - vals[i - 1]
        gains, losses = gains + max(d, 0), losses + max(-d, 0)
    ag, al = gains / n, losses / n
    for i in range(n + 1, len(vals)):
        d = vals[i] - vals[i - 1]
        ag, al = (ag * (n - 1) + max(d, 0)) / n, (al * (n - 1) + max(-d, 0)) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def indicators(points: list[dict]) -> dict:
    closes = [p["close"] for p in points]
    vols = [p["volume"] for p in points]
    out = {"sma20": sma(closes, 20), "sma50": sma(closes, 50), "rsi14": rsi(closes)}
    if len(closes) >= 26:
        macd = [a - b for a, b in zip(ema_series(closes, 12), ema_series(closes, 26))]
        sig = ema_series(macd, 9)
        out.update(macd=macd[-1], macd_signal=sig[-1], macd_hist=macd[-1] - sig[-1])
    if len(closes) >= 21:
        rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))][-60:]
        mean = sum(rets) / len(rets)
        out["volatility_annual_pct"] = math.sqrt(sum((r - mean) ** 2 for r in rets) / len(rets)) * math.sqrt(252) * 100
    if closes:
        peak = max(closes)
        out["drawdown_from_peak_pct"] = (closes[-1] - peak) / peak * 100
    out["avg_volume_20d"] = sma(vols, 20)
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in out.items()}


def observations(quote: dict, ind: dict) -> dict:
    """Rule-based bullish/bearish/risk flags from the numbers above. Descriptive, not advice."""
    bull, bear, risk = [], [], []
    price = quote.get("price")
    if price and ind.get("sma20") and ind.get("sma50"):
        if price > ind["sma20"] > ind["sma50"]:
            bull.append("Price is above both the 20- and 50-day averages (short-term uptrend).")
        elif price < ind["sma20"] < ind["sma50"]:
            bear.append("Price is below both the 20- and 50-day averages (short-term downtrend).")
    r = ind.get("rsi14")
    if r is not None:
        if r > 70:
            bear.append(f"RSI {r:.0f} is in overbought territory; momentum may be stretched.")
        elif r < 30:
            bull.append(f"RSI {r:.0f} is oversold; selling pressure may be easing.")
    if ind.get("macd_hist") is not None:
        (bull if ind["macd_hist"] > 0 else bear).append(
            "MACD is " + ("above" if ind["macd_hist"] > 0 else "below") + " its signal line.")
    h, l = quote.get("week52_high"), quote.get("week52_low")
    if price and h and price >= 0.97 * h:
        bull.append("Trading within 3% of its 52-week high.")
    if price and l and price <= 1.05 * l:
        bear.append("Trading within 5% of its 52-week low.")
    v = ind.get("volatility_annual_pct")
    if v is not None:
        level = "high" if v > 40 else "moderate" if v > 25 else "low"
        risk.append(f"Annualised volatility {v:.0f}% ({level}).")
    d = ind.get("drawdown_from_peak_pct")
    if d is not None and d < -10:
        risk.append(f"Currently {abs(d):.0f}% below its recent peak.")
    return {"bullish": bull, "bearish": bear, "risk": risk}
