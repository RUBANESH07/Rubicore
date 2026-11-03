from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents import llm
from app.core.database import get_db
from app.core.deps import get_current_user
from app.integrations import news as news_int
from app.integrations import stocks as st
from app.integrations.http import ProviderError
from app.models import StockWatchlist, User
from app.schemas import WatchlistIn

router = APIRouter(prefix="/stocks", tags=["stocks"])
DISCLAIMER = ("Informational only. Market data may be delayed. Not investment advice; "
              "past performance does not guarantee future results.")


def _sym(symbol: str, exchange: str = "NSE") -> str:
    return st.normalize_symbol(symbol, exchange)


def _safe_quote(sym: str) -> dict:
    try:
        return st.provider().quote(sym)
    except ProviderError as e:
        return {"symbol": sym, "error": str(e)}


def _quotes(symbols: list[str]) -> list[dict]:
    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(_safe_quote, symbols))


@router.get("/indices")
def indices(user: User = Depends(get_current_user)):
    qs = _quotes([s for _, s in st.INDICES])
    return {"data": [{**q, "label": n} for (n, _), q in zip(st.INDICES, qs)], "disclaimer": DISCLAIMER}


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=40), user: User = Depends(get_current_user)):
    try:
        return st.provider().search(q)
    except ProviderError as e:
        raise HTTPException(502, str(e))


@router.get("/quote/{symbol}")
def quote(symbol: str, exchange: str = "NSE", user: User = Depends(get_current_user)):
    try:
        return st.provider().quote(_sym(symbol, exchange))
    except ProviderError as e:
        raise HTTPException(502, str(e))


@router.get("/history/{symbol}")
def history(symbol: str, range: str = Query("3mo", pattern="^(5d|1mo|3mo|6mo|1y|5y)$"), exchange: str = "NSE",
            user: User = Depends(get_current_user)):
    interval = "1wk" if range == "5y" else "1d"
    try:
        h = st.provider().history(_sym(symbol, exchange), range, interval)
    except ProviderError as e:
        raise HTTPException(502, str(e))
    pts = h["points"]
    perf = ((pts[-1]["close"] / pts[0]["close"] - 1) * 100) if len(pts) > 1 else None
    return {**h, "performance_pct": perf, "high": max((p["high"] or 0) for p in pts) if pts else None,
            "low": min((p["low"] or p["close"]) for p in pts) if pts else None}


@router.get("/compare")
def compare(symbols: str = Query(max_length=200), range: str = Query("6mo", pattern="^(1mo|3mo|6mo|1y)$"),
            user: User = Depends(get_current_user)):
    syms = [_sym(s) for s in symbols.split(",") if s.strip()][:5]
    if len(syms) < 2:
        raise HTTPException(422, "Provide at least two symbols")

    def one(s):
        try:
            pts = st.provider().history(s, range, "1d")["points"]
            base = pts[0]["close"]
            return {"symbol": s, "series": [{"t": p["t"], "pct": round((p["close"] / base - 1) * 100, 2)} for p in pts],
                    "performance_pct": round((pts[-1]["close"] / base - 1) * 100, 2),
                    "indicators": st.indicators(pts)}
        except (ProviderError, IndexError, ZeroDivisionError) as e:
            return {"symbol": s, "error": str(e) or "no data"}
    with ThreadPoolExecutor(max_workers=5) as ex:
        return {"data": list(ex.map(one, syms)), "disclaimer": DISCLAIMER}


@router.get("/analysis/{symbol}")
def analysis(symbol: str, exchange: str = "NSE", user: User = Depends(get_current_user)):
    """Factual data (quote, fundamentals, indicators) is kept separate from AI-generated commentary."""
    sym = _sym(symbol, exchange)
    p = st.provider()
    try:
        q = p.quote(sym)
        pts = p.history(sym, "1y", "1d")["points"]
    except ProviderError as e:
        raise HTTPException(502, str(e))
    ind = st.indicators(pts)
    obs = st.observations(q, ind)
    facts = {"quote": q, "indicators": ind, "fundamentals": p.fundamentals(sym)}
    text = llm.generate(
        f"Data for {q['name']} ({sym}) as JSON: {facts}\nRule-based flags: {obs}\n"
        "Write a neutral 4-6 sentence market commentary: trend, momentum, volume, and key risks. "
        "Do not predict prices, promise returns, or tell the reader to buy/sell/hold. Use only the data given.",
        "You are a careful markets analyst writing educational commentary.")
    return {"factual": facts, "observations": {**obs, "source": "rule-based from the indicators above"},
            "ai_commentary": {"text": text, "ai_generated": True, "available": text is not None},
            "disclaimer": DISCLAIMER}


@router.get("/news/{symbol}")
def stock_news(symbol: str, user: User = Depends(get_current_user)):
    try:
        name = st.provider().quote(_sym(symbol))["name"]
    except ProviderError:
        name = symbol
    return [{k: v for k, v in n.items() if k != "ts"} for n in news_int.company_news(name)]


@router.get("/market-summary")
def market_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    idx = indices(user)["data"]
    wl = db.scalars(select(StockWatchlist).where(StockWatchlist.user_id == user.id)).all()
    quotes = [q for q in _quotes([_sym(w.symbol, w.exchange) for w in wl]) if q.get("change_pct") is not None]
    movers = sorted(quotes, key=lambda q: q["change_pct"], reverse=True)
    text = llm.generate(f"Indian market snapshot (JSON): {idx}\nWatchlist movers: {movers[:3]} / {movers[-3:]}\n"
                        "Write a 3-4 sentence neutral daily market summary. No predictions or advice.",
                        "You are a careful markets analyst.")
    gainers = [q for q in movers if q["change_pct"] > 0][:3]
    losers = [q for q in reversed(movers) if q["change_pct"] < 0][:3]
    return {"indices": idx, "gainers": gainers, "losers": losers,
            "ai_summary": {"text": text, "ai_generated": True, "available": text is not None}, "disclaimer": DISCLAIMER}


# ---------- watchlist ----------
@router.get("/watchlist")
def get_watchlist(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    wl = db.scalars(select(StockWatchlist).where(StockWatchlist.user_id == user.id).order_by(StockWatchlist.id)).all()
    quotes = _quotes([_sym(w.symbol, w.exchange) for w in wl])
    return [{"id": w.id, "symbol": w.symbol, "exchange": w.exchange, "quote": q} for w, q in zip(wl, quotes)]


@router.post("/watchlist", status_code=201)
def add_watch(body: WatchlistIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sym = body.symbol.strip().upper().replace(".NS", "").replace(".BO", "")
    try:
        q = st.provider().quote(_sym(sym, body.exchange))
    except ProviderError:
        raise HTTPException(404, f"Could not find market data for {sym} on {body.exchange}")
    w = StockWatchlist(user_id=user.id, symbol=sym, name=q.get("name", ""), exchange=body.exchange)
    db.add(w)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Already on your watchlist")
    return {"id": w.id, "symbol": sym}


@router.delete("/watchlist/{wid}", status_code=204)
def del_watch(wid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    w = db.get(StockWatchlist, wid)
    if not w or w.user_id != user.id:
        raise HTTPException(404, "Not found")
    db.delete(w)
    db.commit()
