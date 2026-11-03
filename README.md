# RubiCore

**Track Your Day. Understand Your Money. Explore the World.**

An AI-powered personal intelligence platform: expense tracking, daily balances, financial analytics, Indian stock-market intelligence, news, and an AI assistant that answers from two strictly separate data systems — your private finance records and public information via MCP.

## Quick start (local, SQLite)

```bash
# 1. Backend  (Python 3.10+)
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pip install face_recognition --no-deps   # face lock (dlib wheels come prebuilt via dlib-bin)
cp .env.example .env              # then set SECRET_KEY and GEMINI_API_KEY
python database/seed/seed.py      # OPTIONAL: creates a demo account with sample data (skip for real use; the app also runs migrations on start)
uvicorn app.main:app --app-dir backend --port 8000

# 2. Frontend (Node 20+), in another terminal
cd frontend && npm install && npm run dev
```

Open http://localhost:3000. There is no sign-up or password: enter the PIN **1224** (set `APP_PIN` in `.env` to change it; it must be 4 digits) or use your face once enrolled. The single owner account, with default categories and Cash/Bank/Wallet accounts, is created the first time the PIN is used.
API docs (Swagger): http://localhost:8000/docs

## Tests

```bash
python -m pytest backend/tests
cd frontend && npm run lint      # TypeScript type-check
```

## Configuration (`.env`, never committed)

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Signs session tokens. Required outside development. |
| `LLM_PROVIDER` | `gemini` (default), `ollama`, or `none` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini access. Free-tier keys are rate limited; the app retries once and then falls back to a rule-based router. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local open-source models (text generation; tool use goes through the built-in router) |
| `DATABASE_URL` | Defaults to SQLite at `database/rubicore.db`; use `postgresql+psycopg://...` for Postgres |

API keys live only in the backend environment. The frontend never sees them: the browser calls `/api/*`, which Next.js proxies to FastAPI.

## Structure

```
frontend/   Next.js + TypeScript + Tailwind + Recharts (shadcn-style UI primitives in components/ui)
backend/    FastAPI, SQLAlchemy, analytics, agents (assistant), integrations (public-data adapters)
mobile/     Expo / React Native app (shares the backend, GPS engine and FD/RD maths)
mcp/        MCP client + four public-data MCP servers (stocks, news, search, public_data)
database/   Alembic migrations + seed data
docs/       architecture, database design, API, MCP integration, roadmap
```

See [docs/architecture.md](docs/architecture.md) for the design and [docs/mcp-integration.md](docs/mcp-integration.md) for the privacy boundary.

## Mobile app (Expo / React Native)

`mobile/` is a phone app that uses **the same backend and database as the website** (one set of REST APIs). It signs in with your email or username and has Home, Money, live GPS rides, fuel, parking and the FD & RD calculators. Test it immediately with Expo Go, using your Wi-Fi address or ngrok for the backend. Steps, the exact commands and the limits (no background tracking inside Expo Go) are in [mobile/README.md](mobile/README.md).

## RubiRide (bike & ride intelligence)

A module inside the same site: record rides from your phone's browser GPS (start, pause, resume, stop), then see distance, speed, routes on a map, history, analytics, fuel and mileage, parking, and CSV/PDF reports. Fuel entries can also post an expense to the finance tracker. Open **RubiRide** in the sidebar; the optional seed script can add a demo bike and about 70 sample rides.

Browsers only receive GPS while the page is open and the screen is on, so reliable background tracking needs a native app, which is not built yet (the API already supports one). Details, GPS rules and limits: [docs/rubiride.md](docs/rubiride.md). Tests: `python -m pytest backend/tests` and `cd frontend && npm test`.

## FD & RD calculators

A separate module (sidebar: **FD & RD Calculator**, switchable in Settings > Modules). Fixed deposit: cumulative or interest payout, monthly to yearly compounding. Recurring deposit: monthly deposits with the standard bank (quarterly) or other compounding. Both show maturity value, total interest, effective yield, tax-adjusted and inflation-adjusted value, a maturity date, charts, a year-by-year table with CSV export, and a goal planner ("what do I need to deposit to reach X?"). It runs entirely in the browser: nothing you type is stored or sent. Figures are estimates; banks differ in rounding and part-period rules, and tax rules change. The maths is in `frontend/lib/deposits.ts` and covered by `npm test`.

## Private by design: sign-in, auto-lock and face

This is a single-owner app. With `SINGLE_USER_MODE=true` (set in `.env`), registration closes as soon as the first account exists.

- **Open the app:** the PIN (default 1224, `APP_PIN`), or "Sign in with face" on the PIN page (only shown once a face is enrolled and enabled).
- **Session ends with the browser:** the login cookie has no expiry, so closing the browser signs you out.
- **Auto-lock:** after 10 idle minutes (`FACE_LOCK_IDLE_MINUTES`), or when you press the padlock in the header, the API refuses requests (HTTP 423) and a lock screen appears. Unlock with the PIN, or your face when enrolled. For a stricter setup use a smaller number such as 2.
- **Face setup:** Settings > Face lock > Enroll face (PIN + 6 webcam photos). A checkbox decides whether the face may also *sign in*; it can be switched off at any time with your PIN.
- **Engine:** the Python [`face_recognition`](https://github.com/ageitgey/face_recognition) library (dlib embeddings). Only encrypted embeddings are stored (key derived from `SECRET_KEY`); photos are never saved. Face sign-in uses a stricter match (0.45) than unlock (0.5) and refuses ambiguous matches.
- **Brute force:** 5 failed face scans from one address block face sign-in for 5 minutes; 5 wrong PINs from one address block the PIN for 5 minutes (`PIN_MAX_FAILURES`, `PIN_LOCKOUT_MINUTES`). Every attempt is audit logged.
- **Honest limits:** there is no liveness check, so a photo or video of you may fool face sign-in or unlock. If that matters, turn "Sign in with face" off and keep face for unlock only. Face recognition has only been tested with synthetic stand-ins; try it with your own camera. Without `face_recognition` installed the app still runs and shows face features as unavailable.

## Notes and limits

- Market data comes from unofficial Yahoo Finance endpoints (delayed ~15 min) and may break or be rate limited; adapters in `backend/app/integrations` make swapping in a paid provider a one-class change.
- Company fundamentals are best-effort and may be empty when the free provider refuses the request.
- Stock commentary is labelled AI-generated and never gives buy/sell instructions.
- Rate limiting is in-memory (single process). Use a shared store before running multiple workers.
- Sessions are signed JWTs in an httpOnly cookie; there is no server-side revocation list yet (logout clears the cookie).
