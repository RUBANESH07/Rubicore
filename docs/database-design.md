# Database design

Migrations: Alembic (`database/migrations`, applied automatically at API start; `alembic.ini` at the repo root). Create a new one with:

```bash
alembic revision --autogenerate -m "describe change"
```

| Table | Notes |
|---|---|
| `users` | email (unique), bcrypt hash, currency |
| `accounts` | `type` cash/bank/wallet, `opening_balance`, `opening_date` |
| `categories` | per user, `type` income/expense, unique (user, name, type) |
| `subcategories` | belongs to a category |
| `transactions` | `type` income/expense/transfer, `amount` Numeric(14,2), `date`, `occurred_at` (UTC), `transfer_account_id` for transfers; category FKs are `SET NULL` on delete |
| `budgets` | monthly recurring; `category_id` NULL = overall budget |
| `daily_balances` | per-account daily snapshot (opening, income, expense, closing), refreshed when `/balances/daily` is read |
| `savings_goals` | target, saved, optional target date |
| `stock_watchlists` | unique (user, symbol), exchange NSE/BSE |
| `saved_articles` | unique (user, url) |
| `notifications` | `ref` is a de-duplication key (budget thresholds, news, goals) |
| `chat_sessions`, `chat_messages` | messages store the `sources` used |
| `module_settings` | `module_key` e.g. `stocks`, `dashboard`, `mcp:news`; JSON `config` |
| `audit_logs` | sensitive operations; user, action, entity, IP, JSON detail |

All user-owned tables cascade on user delete. SQLite is used for development (foreign keys enabled via PRAGMA); a self-managed PostgreSQL server is possible by setting `DATABASE_URL`. SQLite stores `Numeric` as floating point, so use PostgreSQL where exact decimal storage matters.
