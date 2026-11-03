# API documentation

Interactive docs are generated from the code: **http://localhost:8000/docs** (Swagger) and `/redoc`. All routes are under `/api` and require the session cookie (or `Authorization: Bearer`) except `/auth/register` and `/auth/login`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Transactions | `GET/POST /transactions`, `PUT/DELETE /transactions/{id}` (filters: `start,end,type,category_id,account_id,q,limit,offset`) |
| Accounts & balances | `GET/POST /accounts`, `PUT /accounts/{id}`, `GET /balances/accounts`, `GET /balances/daily?start&end` |
| Categories | `GET/POST /categories`, `PUT/DELETE /categories/{id}`, `POST /categories/{id}/subcategories`, `DELETE /categories/{id}/subcategories/{sub}` |
| Dashboard | `GET /dashboard/overview`, `GET /dashboard/ai-summary` |
| Analytics | `GET /analytics/daily?day`, `/weekly?day`, `/monthly?year&month`, `/yearly?year` |
| Budgets & goals | `GET/PUT /budgets`, `DELETE /budgets/{id}`, `GET/POST /goals`, `PUT/DELETE /goals/{id}` |
| Reports | `GET /reports/export?kind=transactions\|monthly\|yearly` (CSV) |
| Stocks | `GET /stocks/indices`, `/search`, `/quote/{sym}`, `/history/{sym}?range`, `/analysis/{sym}`, `/compare?symbols`, `/news/{sym}`, `/market-summary`; watchlist `GET/POST /stocks/watchlist`, `DELETE /stocks/watchlist/{id}` |
| News | `GET /news?category&q&limit`, `/news/categories`, `/news/briefing`, `POST /news/check-important`, saved `GET/POST /news/saved`, `DELETE /news/saved/{id}` |
| Chat | `POST /chat/message {message, session_id?}` → `{session_id, reply, sources[]}`, `GET /chat/sessions`, `GET /chat/sessions/{id}/messages`, `DELETE /chat/sessions/{id}` |
| System | `GET /notifications`, `POST /notifications/read`, `GET /modules`, `PUT /modules/{key}`, `GET/PUT /settings/dashboard` |
| RubiRide | see [rubiride.md](rubiride.md): `/rides`, `/ride-analytics`, `/bikes`, `/fuel`, `/parking`, `/maintenance`, `/ride-preferences`, `/ride-reports/export` |
| MCP | `GET /integrations/mcp`, `PUT /integrations/mcp/{name}`, `GET /integrations/mcp/{name}/tools` |

Errors use `{"detail": "..."}` with 401 (unauthenticated), 404 (not found *or not yours*), 409 (duplicate), 422 (validation), 429 (rate limited, with `Retry-After`), 502 (upstream data provider failed).
