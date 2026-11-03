# Architecture

```
Browser ──/api──▶ Next.js (proxy) ──▶ FastAPI ──▶ SQLAlchemy ──▶ SQLite / PostgreSQL
                                        │
                                        ├─ analytics/        pure aggregation over the user's own transactions
                                        ├─ integrations/     public-data adapters (Yahoo, RSS, Open-Meteo, World Bank)
                                        └─ agents/           assistant
                                              ├─ private_tools   in-process, user_id bound server-side
                                              └─ mcp_bridge ──▶ mcp/client ──stdio──▶ mcp/servers/* (public only)
```

## Layers (backend)

| Layer | Responsibility |
|---|---|
| `api/` | HTTP routers, auth dependency, request validation |
| `schemas/` | Pydantic models; money serialised as numbers, stored as `Numeric(14,2)` |
| `services/` | Balance engine, audit log, notifications, default seeding |
| `repositories/` | Query helpers for transactions |
| `analytics/` | Daily/weekly/monthly/yearly reports, budget performance |
| `integrations/` | Provider adapters. `StockProvider` is an ABC; add providers to `PROVIDERS` |
| `agents/` | LLM layer, private tools, MCP bridge, tool-calling loop |

## Key rules

- **Transfers are neither income nor expense.** They move money between accounts (visible in per-account balances) and are excluded from every report. Closing = Opening + Income − Expenses.
- **Every private row has `user_id`**, and every query filters by it. Foreign keys supplied by the client (account, category, subcategory) are verified to belong to the caller.
- **Dates**: `transactions.date` is the user's local business date; `occurred_at` is a UTC timestamp.
- **Modules**: `GET /api/modules` is a registry; users switch modules on/off (stored in `module_settings`). The frontend hides disabled modules. Planned modules are listed as unavailable until implemented.
- **AI vs facts**: stock and news endpoints return factual data and AI text in separate fields, each flagged (`ai_generated`).

## Assistant flow

1. Model receives private tool declarations plus public tools discovered from MCP servers at runtime.
2. Each call is routed: private tools run in-process; public tools go through the MCP client after an outbound privacy guard.
3. Every call is recorded; the response lists `sources` (`private` / `public`) which the UI shows as chips.
4. If the LLM is unavailable (no key, quota, error), a keyword router calls the same tools and formats the result.

## Security summary

Authentication (bcrypt + JWT in httpOnly SameSite cookie), per-user isolation, Pydantic validation, in-memory rate limiting (stricter on auth and chat), env-based secrets, MCP sandboxing, and optional face lock (idle lock enforced server-side, encrypted templates, password required to enroll), audit logs for login, registration, deletes, exports, MCP toggles and every assistant read of private data.
