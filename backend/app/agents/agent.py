"""Source-aware finance assistant.

Two independent data-access systems:
  * PRIVATE  - in-process finance tools bound to the authenticated user (private_tools)
  * PUBLIC   - MCP servers reached through the sandboxed client (mcp_bridge)

The model chooses tools; every tool call is recorded and returned as `sources` so the UI can show
where each answer came from. Public tool arguments pass through an outbound privacy guard.
"""
import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import llm, mcp_bridge, private_tools
from app.core.config import settings, today
from app.models import Account, Category, ModuleSetting, User
from app.services.common import audit

MAX_STEPS = 6

SYSTEM = """You are RubiCore AI, a personal finance and market assistant for one signed-in user.
Today is {today}. Currency: {currency}.

You have two separate data sources:
1. PRIVATE finance tools (get_spending_summary, list_transactions, get_account_balances, compare_months,
   get_budget_status, get_savings_overview, get_average_daily_spending, get_riding_summary,
   generate_monthly_report). Use them
   for anything about the user's own spending, income, balances, budgets or savings.
2. PUBLIC tools (market quotes, news, weather, economic indicators, encyclopedia search). Use them for
   public information only.

Rules:
- Never put the user's private figures, account names, email or any personal detail into a public tool argument.
- For mixed questions, call the private tool and the public tool separately, then combine the answers.
- Only state numbers that come from tool results. If a tool returns an error, say so plainly.
- Make clear which facts are from the user's private records and which are public. Market commentary is
  informational only: never promise returns or give personalised buy/sell instructions.
- Be concise. Format money with the currency symbol and use short bullet lists when helpful."""


def _enabled_servers(db: Session, user: User) -> list[str]:
    rows = {r.module_key: r.enabled for r in db.scalars(select(ModuleSetting).where(
        ModuleSetting.user_id == user.id, ModuleSetting.module_key.like("mcp:%")))}
    out = []
    for s in mcp_bridge.server_catalog():
        if rows.get(f"mcp:{s['name']}", s.get("default_enabled", True)):
            out.append(s["name"])
    return out


def _private_terms(db: Session, user: User) -> list[str]:
    names = [a.name for a in db.scalars(select(Account).where(Account.user_id == user.id))]
    terms = [user.email, user.email.split("@")[0], *user.name.split()] + names
    return [t.lower() for t in terms if len(t) >= 4]


def _guard_public_args(args: dict, terms: list[str]) -> str | None:
    """Return a reason string if the outbound arguments look like they carry private data."""
    for v in args.values():
        if not isinstance(v, str):
            continue
        low = v.lower()
        if "@" in v or any(t in low for t in terms):
            return "blocked: argument contains personal identifiers"
        if re.search(r"\b(my|our)\s+(balance|salary|income|expenses?|spending|savings)\b", low):
            return "blocked: argument refers to private finances"
    return None


class Run:
    def __init__(self, db: Session, user: User, ip: str = ""):
        self.db, self.user, self.ip = db, user, ip
        self.sources: list[dict] = []
        self.servers = _enabled_servers(db, user)
        self.public = mcp_bridge.tools_for(self.servers)
        self.terms = _private_terms(db, user)

    def declarations(self) -> list[dict]:
        pub = [{"name": n, "description": t["description"], "parameters": mcp_bridge.to_gemini_schema(t["input_schema"])}
               for n, t in self.public.items()]
        return private_tools.DECLARATIONS + pub

    def call(self, name: str, args: dict):
        if name in private_tools.NAMES:
            try:
                result = private_tools.execute(self.db, self.user.id, name, args)
            except Exception as e:  # noqa: BLE001
                result = {"error": f"{type(e).__name__}"}
            audit(self.db, self.user.id, "assistant.private_read", "tool", name, {"args": args}, self.ip)
            self.sources.append({"type": "private", "tool": name})
            return result
        if name in self.public:
            reason = _guard_public_args(args or {}, self.terms)
            server = self.public[name]["server"]
            self.sources.append({"type": "public", "tool": name, "server": server})
            if reason:
                return {"error": reason}
            try:
                return json.loads(mcp_bridge.call(server, name, args or {}))
            except Exception as e:  # noqa: BLE001
                return {"error": f"public tool failed: {type(e).__name__}"}
        return {"error": f"unknown tool {name}"}


def _history_contents(history: list[dict], message: str) -> list[dict]:
    contents = [{"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]}
                for m in history[-8:]]
    contents.append({"role": "user", "parts": [{"text": message}]})
    return contents


def _gemini_loop(run: Run, history: list[dict], message: str) -> str:
    contents = _history_contents(history, message)
    system = SYSTEM.format(today=today().isoformat(), currency=run.user.currency)
    decls = run.declarations()
    for _ in range(MAX_STEPS):
        data = llm.gemini_raw(contents, system, decls)
        cand = (data.get("candidates") or [{}])[0]
        content = cand.get("content") or {}
        parts = content.get("parts", [])
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            text = "".join(p.get("text", "") for p in parts).strip()
            if text:
                return text
            raise RuntimeError("empty model response")
        contents.append(content)  # keep the model turn verbatim (preserves thought signatures)
        contents.append({"role": "user", "parts": [
            {"functionResponse": {"name": c["name"], "response": {"result": run.call(c["name"], c.get("args") or {})}}}
            for c in calls]})
    raise RuntimeError("tool loop did not converge")


# ---------- offline / non-tool-calling fallback: keyword router ----------
def _route(db: Session, user: User, message: str) -> list[tuple[str, str, dict]]:
    m, plans = message.lower(), []
    period = ("today" if "today" in m else "yesterday" if "yesterday" in m else "week" if "week" in m else
              "last_month" if "last month" in m else "year" if "year" in m else "month")
    cats = [c.name for c in db.scalars(select(Category).where(Category.user_id == user.id, Category.type == "expense"))]
    cat = next((c for c in cats if any(w in m for w in re.split(r"[ /]+", c.lower()) if len(w) > 3)), None)
    if re.search(r"\b(ride|rides|riding|km|kilomet\w*|mileage|bike)\b", m):
        plans.append(("private", "get_riding_summary", {"period": period}))
    elif "report" in m:
        plans.append(("private", "generate_monthly_report", {}))
    elif "compare" in m:
        plans.append(("private", "compare_months", {}))
    elif re.search(r"\bsav(e|ing)", m):
        plans.append(("private", "get_savings_overview", {}))
    elif "average" in m:
        plans.append(("private", "get_average_daily_spending", {"period": period}))
    elif "budget" in m:
        plans.append(("private", "get_budget_status", {}))
    elif "balance" in m:
        plans.append(("private", "get_account_balances", {}))
    elif re.search(r"spen[dt]|expense|highest|most|category", m):
        plans.append(("private", "get_spending_summary", {"period": period, **({"category": cat} if cat else {})}))
    if re.search(r"nifty|sensex|market|stock", m):
        plans.append(("public", "get_index_summary", {}))
    if "news" in m:
        plans.append(("public", "get_news", {"category": "stock-market" if "market" in m else "business"}))
    if re.search(r"inflation|gdp|unemployment", m):
        plans.append(("public", "get_economic_indicator", {"indicator": "gdp_growth" if "gdp" in m else "inflation"}))
    w = re.search(r"weather (?:in|at|for) ([a-zA-Z ]+)", message)
    if w:
        plans.append(("public", "get_weather", {"city": w.group(1).strip()}))
    return plans


def _fallback(run: Run, message: str) -> str:
    plans = _route(run.db, run.user, message)
    if not plans:
        return ("I can answer questions about your spending, balances, budgets and savings, and about public "
                "market data, news, weather and economic indicators. Try: \"How much did I spend this month?\" "
                "or \"What is the NIFTY doing today?\"")
    results = {name: run.call(name, args) for _, name, args in plans}
    text = llm.generate(f"Question: {message}\n\nTool results (JSON):\n{json.dumps(results, default=str)[:6000]}\n\n"
                        "Answer concisely using only these results; say which parts are private records vs public data.",
                        SYSTEM.format(today=today().isoformat(), currency=run.user.currency))
    if text:
        return text
    return "\n\n".join(f"**{n.replace('_', ' ').title()}**\n```json\n{json.dumps(r, indent=1, default=str)[:1500]}\n```"
                       for n, r in results.items())


def answer(db: Session, user: User, message: str, history: list[dict], ip: str = "") -> dict:
    run = Run(db, user, ip)
    reply = None
    if llm.supports_tools():
        try:
            reply = _gemini_loop(run, history, message)
        except Exception:  # noqa: BLE001
            run.sources.clear()
    if reply is None:
        reply = _fallback(run, message)
    seen, sources = set(), []
    for s in run.sources:
        if s["tool"] not in seen:
            seen.add(s["tool"])
            sources.append(s)
    return {"reply": reply, "sources": sources}
