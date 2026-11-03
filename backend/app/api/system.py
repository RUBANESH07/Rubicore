"""Chat, notifications, module settings and MCP integration management."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import agent, mcp_bridge
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import ChatMessage, ChatSession, ModuleSetting, Notification, User
from app.schemas import ChatIn, ModuleToggle, NotificationOut
from app.services.common import audit

router = APIRouter(tags=["system"])

# Module registry: every feature is an independently switchable module.
MODULES = [
    {"key": "finance", "name": "Personal Finance", "core": True, "available": True},
    {"key": "stocks", "name": "Stock Market", "available": True},
    {"key": "news", "name": "News Intelligence", "available": True},
    {"key": "assistant", "name": "AI Assistant", "available": True},
    {"key": "deposits", "name": "FD & RD Calculators", "available": True},
    {"key": "rides", "name": "RubiRide (bike & ride intelligence)", "available": True},
    {"key": "journal", "name": "Daily Journal", "available": False},
    {"key": "tasks", "name": "Task Management", "available": False},
    {"key": "habits", "name": "Habit Tracker", "available": False},
    {"key": "health", "name": "Health & Fitness", "available": False},
    {"key": "learning", "name": "Learning Tracker", "available": False},
    {"key": "career", "name": "Career Tracker", "available": False},
    {"key": "business", "name": "Business Analytics", "available": False},
    {"key": "portfolio", "name": "Investment Portfolio", "available": False},
    {"key": "subscriptions", "name": "Subscription Management", "available": False},
    {"key": "bills", "name": "Bill Reminders", "available": False},
    {"key": "documents", "name": "Document Management", "available": False},
    {"key": "research", "name": "AI Research Assistant", "available": False},
]
DASHBOARD_WIDGETS = ["balance", "ai_summary", "cashflow", "expense_chart", "funnel", "ratio", "budget_rings", "radar", "heatmap", "treemap",
                     "pyramid", "income_chart", "recent", "stocks", "news"]


def _settings(db, user) -> dict[str, ModuleSetting]:
    return {s.module_key: s for s in db.scalars(select(ModuleSetting).where(ModuleSetting.user_id == user.id))}


def _upsert(db, user, key, enabled, config=None):
    s = _settings(db, user).get(key)
    if s:
        s.enabled = enabled
        if config is not None:
            s.config = config
    else:
        db.add(ModuleSetting(user_id=user.id, module_key=key, enabled=enabled, config=config))
    db.commit()


@router.get("/modules")
def modules(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user)
    return [{**m, "enabled": s[m["key"]].enabled if m["key"] in s else m["available"]} for m in MODULES]


@router.put("/modules/{key}")
def toggle_module(key: str, body: ModuleToggle, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mod = next((m for m in MODULES if m["key"] == key), None)
    if not mod or not mod["available"] or mod.get("core"):
        raise HTTPException(422, "This module cannot be toggled")
    _upsert(db, user, key, body.enabled, body.config)
    return {"ok": True}


@router.get("/settings/dashboard")
def get_widgets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user).get("dashboard")
    hidden = (s.config or {}).get("hidden", []) if s else []
    return {"widgets": [{"key": w, "visible": w not in hidden} for w in DASHBOARD_WIDGETS]}


@router.put("/settings/dashboard")
def set_widgets(body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    hidden = [w for w in body.get("hidden", []) if w in DASHBOARD_WIDGETS]
    _upsert(db, user, "dashboard", True, {"hidden": hidden})
    return {"ok": True}


# ---------- notifications ----------
@router.get("/notifications")
def notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id)
                      .order_by(Notification.id.desc()).limit(30)).all()
    return {"items": [NotificationOut.model_validate(r) for r in rows], "unread": sum(1 for r in rows if not r.is_read)}


@router.post("/notifications/read")
def mark_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))):
        n.is_read = True
    db.commit()
    return {"ok": True}


# ---------- MCP integrations ----------
@router.get("/integrations/mcp")
def mcp_servers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db, user)
    out = []
    for srv in mcp_bridge.server_catalog():
        row = s.get(f"mcp:{srv['name']}")
        out.append({**{k: srv[k] for k in ("name", "title", "description", "permissions")},
                    "enabled": row.enabled if row else srv.get("default_enabled", True)})
    return {"servers": out, "policy": "Public MCP servers run in a sandboxed process with no access to your financial "
            "data, database or secrets. Private questions are answered by internal APIs only."}


@router.put("/integrations/mcp/{name}")
def mcp_toggle(name: str, body: ModuleToggle, request: Request, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    if name not in {s["name"] for s in mcp_bridge.server_catalog()}:
        raise HTTPException(404, "Unknown MCP server")
    _upsert(db, user, f"mcp:{name}", body.enabled)
    audit(db, user.id, "mcp.toggle", "mcp_server", name, {"enabled": body.enabled},
          request.client.host if request.client else "")
    return {"ok": True}


@router.get("/integrations/mcp/{name}/tools")
def mcp_tools(name: str, user: User = Depends(get_current_user)):
    if name not in {s["name"] for s in mcp_bridge.server_catalog()}:
        raise HTTPException(404, "Unknown MCP server")
    try:
        tools = mcp_bridge.hub().list_tools(name)
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "Could not start the MCP server")
    return [{"name": t["name"], "description": t["description"]} for t in tools]


# ---------- chat ----------
@router.get("/chat/sessions")
def sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(ChatSession).where(ChatSession.user_id == user.id).order_by(ChatSession.id.desc()).limit(30))
    return [{"id": r.id, "title": r.title, "created_at": r.created_at} for r in rows]


def _session(db, user, sid) -> ChatSession:
    s = db.get(ChatSession, sid)
    if not s or s.user_id != user.id:
        raise HTTPException(404, "Chat not found")
    return s


@router.get("/chat/sessions/{sid}/messages")
def messages(sid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _session(db, user, sid)
    rows = db.scalars(select(ChatMessage).where(ChatMessage.session_id == sid).order_by(ChatMessage.id))
    return [{"id": m.id, "role": m.role, "content": m.content, "sources": m.sources or []} for m in rows]


@router.delete("/chat/sessions/{sid}", status_code=204)
def delete_session(sid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_session(db, user, sid))
    db.commit()


@router.post("/chat/message")
def chat(body: ChatIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.session_id:
        sess = _session(db, user, body.session_id)
    else:
        sess = ChatSession(user_id=user.id, title=body.message[:60])
        db.add(sess)
        db.commit()
    history = [{"role": m.role, "content": m.content} for m in db.scalars(
        select(ChatMessage).where(ChatMessage.session_id == sess.id).order_by(ChatMessage.id))]
    db.add(ChatMessage(session_id=sess.id, role="user", content=body.message))
    db.commit()
    result = agent.answer(db, user, body.message, history, request.client.host if request.client else "")
    db.add(ChatMessage(session_id=sess.id, role="assistant", content=result["reply"], sources=result["sources"]))
    db.commit()
    return {"session_id": sess.id, **result}
