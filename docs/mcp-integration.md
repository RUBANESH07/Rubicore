# MCP integration

The assistant uses two independent data paths.

| | Private finance | Public information |
|---|---|---|
| Data | transactions, balances, budgets, savings | markets, news, weather, economic indicators, encyclopedia |
| Access | in-process tools in `agents/private_tools.py` | MCP servers in `mcp/servers/*` via `mcp/client/client.py` |
| Identity | `user_id` taken from the authenticated session, never from the model | none |
| Audit | every call logged as `assistant.private_read` | n/a |

## Boundary enforcement

1. **No code path**: MCP servers and the integration adapters import nothing from models, database, security, services or agents. `backend/tests/test_mcp_isolation.py` fails the build if that changes.
2. **Scrubbed process environment**: servers are launched over stdio with only `PYTHONIOENCODING` and `STOCK_PROVIDER` (plus the SDK's minimal safe defaults). No `DATABASE_URL`, `SECRET_KEY` or API keys.
3. **Allow-lists**: only servers in `mcp/config/servers.json` can start, only advertised tools can be called, arguments are filtered to the declared schema and strings capped at 200 characters.
4. **Outbound guard** (`agents/agent.py::_guard_public_args`): public-tool arguments containing the user's email, name, account names, or phrases like "my balance" are rejected.
5. **Per-user switches**: each server can be disabled on the MCP Integrations page (audited).

For mixed questions ("compare my expenses with inflation") the model calls a private tool and a public tool separately and combines the answers. The model sees the private result (that is what the user authorised), but the public server only ever receives the model-chosen arguments.

Residual risk: the guard is heuristic. A model could still paraphrase private information into a free-text query (for example the `web_search` tool). The system prompt forbids it and the guard catches common cases, but treat free-text public tools as the highest-risk surface.

## Servers

| Server | Tools |
|---|---|
| `stocks` | `get_stock_quote`, `get_index_summary`, `get_company_info` |
| `news` | `get_news` |
| `search` | `web_search` (Wikipedia) |
| `public_data` | `get_weather` (Open-Meteo), `get_economic_indicator` (World Bank) |

## Adding a server

1. Create `mcp/servers/<name>/server.py` with FastMCP tools (copy an existing one; use plain-typed parameters with defaults).
2. Register it in `mcp/config/servers.json` with its permissions.
3. It appears on the Integrations page and in the assistant automatically (tool schemas are discovered at runtime, cached 10 minutes).

Each tool call currently spawns the server process (~1s). A persistent session pool is the obvious optimisation.
