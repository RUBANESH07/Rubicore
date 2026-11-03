# Development roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | structure, FastAPI, Next.js, DB + Alembic, auth | done |
| 2 Expense tracker | transaction CRUD, categories, accounts/transfers, daily balances, dashboard | done |
| 3 Analytics | daily, weekly, monthly, yearly, budgets, CSV export | done |
| 4 Stocks | indices, watchlist, history charts, indicators, compare, company news, AI vs factual split | done (free delayed data) |
| 5 News | categories, search, save, daily AI briefing, important-news notifications | done |
| 6 Chatbot | private tools, public MCP tools, source-aware answers, sessions | done |
| 7 Advanced | notifications, budgets, goals, module registry | done; PDF reports and recurring transactions not built |
| 8 Testing/deploy | backend tests, type-check | backend and GPS-engine tests pass; frontend component/E2E tests, a security scan and a deployment plan are still to do |

## Next

- Persistent MCP session pool; per-user MCP rate limits
- Server-side session revocation, CSRF token, password reset, email verification
- Redis-backed rate limiting
- Fundamentals from a reliable provider; intraday charts
- Recurring transactions, receipt attachments, multi-currency
- Build the planned modules listed in `GET /api/modules` (journal, tasks, habits, ...)
