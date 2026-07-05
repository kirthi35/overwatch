# Overwatch — Knowledge Base

**Product:** Overwatch — NSE AI trading assistant. Originally a local-first terminal
CLI; **this branch (`feat/web-app-monorepo`) turns it into a multi-tenant React +
Firebase web app** on an npm-workspaces monorepo, deployed on a Pi box.
**Branch:** `feat/web-app-monorepo` (was `feat/telegram-alert-delivery`)
**Last updated:** 2026-07-05 (**Part B** — the web-app pivot: monorepo, Fastify API,
monitor worker, React SPA, production deployment; **plus** the 2026-07-04→05 doctrine
audit remediation — see [`FIXLOG.md`](./FIXLOG.md): the `standing-orders` constitution,
lesson library, six new pipeline stages, symbol-agnostic sweep; and the **Trades** tab +
Settings surface — see [ADR 0004](./docs/adr/0004-trades-tab-and-trade-lifecycle-model.md).
Sections 1–15 describe the original single-user CLI, which now lives in `packages/cli`.)

Single source of truth for the codebase. Pairs with [`CONTEXT.md`](./CONTEXT.md)
(the glossary / ubiquitous language) and [`docs/adr/`](./docs/adr/) (why decisions
were made). Where this doc names doctrine terms (Raid, Campaign, gate, monitor,
fire, blind, operator, capacity), `CONTEXT.md` is authoritative.

> **Reading guide:** **Part A (§1–§15)** = the original CLI, unchanged, now
> `packages/cli`. **Part B (§16–§26)** = the multi-tenant web app added on this
> branch. Where they conflict (e.g. `~/.overwatch/` files vs Firestore; `process.env`
> creds vs per-user in-memory creds), **Part B is authoritative for the server/worker/
> web paths**; Part A remains authoritative for the CLI.

---

## Table of Contents

1. Business Overview & Doctrine
2. Technology Stack
3. Environment & Workspace Topology
4. Entry Point & Boot Sequence
5. The Doctrine Pipeline & Skills Layer
6. Tooling Layer (Groww MCP bridge, custom tools, auto-loader)
7. Monitoring Engine
8. Alerting & Delivery
9. Data Flow Diagrams
10. Key Data Types
11. Sessions
12. Secrets & Auth
13. File & Module Map
14. Directory Structure
15. Known Gaps & Divergences

**Part B — Multi-Tenant Web App (branch `feat/web-app-monorepo`)**

16. Web-App Pivot — What Changed & Why
17. Monorepo Layout (`packages/*`)
18. Multi-Tenant Architecture & Firestore Data Model
19. Core Library Changes (`@overwatch/core`)
20. Doctrine Shell-Awareness (bash-off on the server)
21. API Server (`@overwatch/server`) — Fastify + SSE + POST
22. Monitor Worker (`@overwatch/worker`)
23. Web App (`@overwatch/web`) — Vite + assistant-ui
24. Secrets & Environment (server/worker)
25. Production Deployment (Pi box + Netlify)
26. Known Gaps & Open Items (web app)

---

## 1. Business Overview & Doctrine

Overwatch analyzes NSE equities, monitors watchlists/holdings, and fires alerts —
under the **operator's own trading doctrine**, enforced as first-class guardrails.
It is a **scout and analyst, not a shooter**: it never places orders (decision D1),
uses a **read-only** Groww token, and the operator executes every trade manually in
Groww. Even a full compromise cannot move money.

The doctrine is a **six-stage intelligence pipeline** (see §5 and
[ADR 0001](./docs/adr/0001-doctrine-is-a-staged-pipeline.md)): map macro → scout a
stock → validate the story → estimate capacity → size the bet → gate the entry.
Each stage is a Markdown skill that consumes the previous stage's output. The LLM
is the *brain* (analysis, writing monitors); monitors are the *body* (cheap JS
gates, no LLM in the loop).

---

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20+ (dev on 25.x), TypeScript | `"type": "module"` — ESM |
| Agent harness | **Pi** — `@earendil-works/pi-coding-agent` + `@earendil-works/pi-agent-core` `^0.80.2` | Embedded via SDK (`main()` + `ExtensionFactory`). Also has legacy `@mariozechner/pi-agent-core` `^0.73.1` in deps. |
| Data source | **Groww MCP** `https://mcp.groww.in/mcp` | `@modelcontextprotocol/sdk` `^1.29.0`, StreamableHTTP + Bearer, read-only. ~31 tools registered dynamically. |
| Tool schemas | `@sinclair/typebox` `^0.34.49` | MCP JSON Schema wrapped via `Type.Unsafe`. |
| Secrets | `@napi-rs/keyring` `^1.3.0` | OS keychain (service `overwatch`). |
| CLI UX | `figlet`, `gradient-string`, `@inquirer/prompts` | Splash + first-run credential prompts. |
| Alerting | Telegram Bot API (`fetch`) | Optional, severity-gated. |
| Build | `tsc` → `dist/` | `npm run build`. Bin: `overwatch` → `dist/index.js`. |
| Tests | `node runtime/daemons/test-monitor-runtime.js` | 7 tests, no network. |

**Two module realms** (they cannot share code):
- **ESM/TS** (`src/*.ts` → `dist/`): the CLI + in-session extensions.
- **CJS** (`runtime/daemons/*.js`): standalone daemons seeded into `~/.overwatch/`.
This is why `src/telegram.ts` and `runtime/daemons/lib/telegram.js` are deliberate
twins (§8).

---

## 3. Environment & Workspace Topology

Two locations matter:

- **Repo** (`~/workspace/overwatch/`) — source of truth, version-controlled.
  `runtime/` holds assets that get *seeded* into the workspace.
- **Workspace** (`~/.overwatch/`) — runtime home. The agent `chdir`s here at
  startup and `PI_WORKSPACE_DIR` points at it. All file/bash ops are meant to be
  sandboxed here.

`npm run seed` (`scripts/seed.mjs`) copies `runtime/skills/**` (incl. `_shared/`)
and `runtime/daemons/**` into `~/.overwatch/`, and creates the working dirs. It is
**idempotent and non-destructive** — it overwrites doctrine/daemon source (those
live in git) but never touches operator data (`alerts.log`, `theses/`, `thesis/`,
`monitors/`, `logs/`).

**Credentials** (`.env` → keychain on first run):

| `.env` key | → process env | Required | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | Yes | LLM key |
| `groww_api_key` | `GROWW_API_TOKEN` | Yes | Groww read-only token |
| `groww_api_secret` | — | No | Reserved for REST gap-fill (unused) |
| `telegram_bot_token` | `TELEGRAM_BOT_TOKEN` | No | Walk-away alert delivery |
| `telegram_chat_id` | `TELEGRAM_CHAT_ID` | No | Alert destination |
| `telegram_min_severity` | `TELEGRAM_MIN_SEVERITY` | No | Push threshold (default `WARNING`) |

Daemons (spawned in a bare shell) also accept `GROWW_MCP_TOKEN` / `GROWW_TOKEN`
and read Telegram config from `~/.overwatch/telegram.json` (chmod 600).

---

## 4. Entry Point & Boot Sequence

`src/index.ts` → `start()`:

```
showSplash()                       figlet "OVERWATCH" + gradient
  │
parseEnvFile(cwd/.env)             flat .env parse (no dep), BEFORE any chdir
  │
getOrSetCredential x2              keychain('overwatch', 'llmKey' | 'growwToken')
  │                                → seed from .env on first run, else prompt
  ├─ set process.env.ANTHROPIC_API_KEY, GROWW_API_TOKEN
  │
resolveOptionalCredential x2       keychain('overwatch','telegramBotToken'|'telegramChatId')
  │                                → env fallback, NO prompt (opt-in)
  ├─ if both present: set TELEGRAM_* env + write ~/.overwatch/telegram.json (600)
  │
process.chdir(~/.overwatch)        sandbox; PI_WORKSPACE_DIR set
  │
main([], { extensionFactories: [overwatchExtension] })      ← Pi SDK boots here
```

**`overwatchExtension`** (an `ExtensionFactory`) wires five things:
- `api.on("before_agent_start")` → `setupGrowwMCP(api)` (connect + register MCP
  tools) and returns `{ systemPrompt: MASTER_SYSTEM_PROMPT }`. **Fires once per
  query**, so the MCP connect is guarded by a module-level `mcpReady` flag.
- `setupAutoLoader(api)` — the `context` hook (§6).
- `registerCustomTools(api)` — `console_log_alert` (§8).
- `setupAlertBridge(api)` — `session_start` hook, surfaces fires (§7).
- `setupMonitorWatch(api)` — `session_start` hook, in-session watcher (§7).

**Master system prompt** (`MASTER_SYSTEM_PROMPT`, ~60 lines, hardcoded in
`index.ts`): identity (War General, scout not shooter), ACTIVE TOOLS, the **SKILL
REGISTRY = the doctrine pipeline** (§5), RULES OF ENGAGEMENT (the entry gates),
MONITORING two-mode instructions, MONITOR EVENTS handling, and ROUTING. It is a
lean dispatcher — heavy detail lives in the on-demand skills.

> ✅ No-chase RSI is **75–78** everywhere — `buildMasterPrompt` (RULES OF ENGAGEMENT),
> the skills, and `idea.md` (reconciled 2026-07-05; was open thread #1, now closed).

---

## 5. The Doctrine Pipeline & Skills Layer

Skills are Markdown playbooks in `~/.overwatch/skills/` (source in
`runtime/skills/`), loaded on demand by the auto-loader (§6). The doctrine is a
staged pipeline — see `CONTEXT.md` § "The doctrine pipeline" and ADR 0001.

| Stage | Skill | Role | Status |
|---|---|---|---|
| — | `_shared/standing-orders.md` | **CONSTITUTION** — 11 standing orders; outrank every skill; loaded every session | ✅ authored |
| 0 | `regime-gate` | is NEW momentum risk allowed today (Nifty/sector trend + extension) | ✅ authored |
| 1 | `macro-to-india-mapper` | macro/global event → Indian theme (operator-supplied; web_search PENDING) | ✅ authored |
| 2 | `theme-to-stock-scout` | theme → candidate stock(s) + relative-strength rank | ✅ authored |
| 3 | `stock-thesis-validator` | is the driver true + break-triggers + valuation-refuted cap | ✅ authored |
| 4 | `valuation-cycle-analyzer` | HOW HIGH / HOW FAST / HOW LONG (capacity, never a target) | ✅ authored |
| 5a | `portfolio-risk` | BOOK layer: capital, per-trade budget, total heat, correlation, event blackout | ✅ authored |
| 5b | `swing-horizon-sizer` | is the bet worth it over the horizon + share count; **NO-BET** valid | ✅ authored |
| 5c | `pre-trade-commit` | lock an immutable trade card before ENTER | ✅ authored |
| 6 | `entry-exit-gate` | WHEN: Gate 0 (sizer GO + regime GO + book clears) → daily-close, order-book ≤ 3:1, closed green reversal, no-chase (RSI 75–78), two-mode (DIP/BREAKOUT) | ✅ authored |
| — | `_shared/multi-timeframe-protocol.md` | structure read the analytical stages run first (warm-up ≥6M rule) | ✅ authored |
| ops | `momentum-campaign` | time-boxed momentum swing as a disciplined campaign | ✅ authored |
| ops | `position-manager` | manage an OPEN position — trail / scale / exit | ✅ authored |
| ops | `trade-journal` | on every CLOSE record the trade; every 10, expectancy + adherence | ✅ authored |
| ops | `monitor-watch` | watch a symbol while the CLI is open | ✅ |
| ops | `monitor-builder` | spawn an unattended daemon | ✅ |

> **Post-audit hardening (2026-07-04→05, see [`FIXLOG.md`](./FIXLOG.md)):** the six
> stages above `regime-gate`, `portfolio-risk`, `pre-trade-commit`, `momentum-campaign`,
> `trade-journal`, and the `standing-orders` constitution were added; all skills were
> swept symbol-agnostic (no stock names in rules) with incident evidence moved to the
> **lesson library** `theses/lessons/L-*.md` (cited by doctrine as `evidence: L-<date>`).

**Deprecated redirects** (kept so old prompts resolve; `superseded_by:` in
frontmatter; the auto-loader never injects them):
`valuation-campaign` → `valuation-cycle-analyzer` ·
`position-sizing` → `swing-horizon-sizer` ·
`risk-gate` → `entry-exit-gate` ·
`momentum-raid` → **restored as `momentum-campaign`** (disciplined, time-boxed, obeys the standing orders).

**Sizing formula** (canonical, from `swing-horizon-sizer`): `Shares =
Risk_Budget ÷ (Entry − Stop)`, round **down**. The risk budget now comes from
`portfolio-risk` (capital × risk_pct_per_trade), never an ad-hoc number; conviction
nudges it within preset bounds and never overrides the stop math (Standing Orders 4, 5).
Notional cap 25% of capital. Equities only (no F&O lots).

---

## 6. Tooling Layer

### 6.1 Groww MCP bridge — `src/mcp-bridge.ts`
Lazy MCP client to `https://mcp.groww.in/mcp`, StreamableHTTP + `Authorization:
Bearer <token>`.
- **`setupGrowwMCP(api)`** — connects once per process (`mcpReady` guard),
  `listTools()`, and for each tool `api.registerTool({ name, parameters:
  Type.Unsafe(inputSchema), execute })`. Registers **all ~31 tools dynamically**.
- **`onerror`** swallows benign SSE notification-stream churn (Groww idle-drops the
  optional server→client stream); `reconnectionOptions.maxRetries: 0` stops an
  infinite reconnect loop. Real errors (401, refused) still surface.
- **`callGroww(name, args)`** + **`growwReady()`** are exported so the in-session
  watcher reuses the chat's live connection instead of re-dialing MCP.
- Token resolved from `process.env.GROWW_API_TOKEN`, else keychain
  (`overwatch`/`growwToken`).

**Tools actually exercised by code:** only `get_quotes_and_depth` and
`fetch_historical_candle_data` (the monitors). The analytical skills additionally
call `get_historical_technical_indicators`, `fetch_stocks_fundamental_data`
(with `view`/`stats`), and `resolve_market_time_and_calendar` — these rely on the
live server exposing them (unverified in code; open thread, §15).

> REST (idea.md §4.2) is **gap-driven only** — no REST tool is built.

### 6.2 `console_log_alert` — `src/custom-tools.ts`
The one custom tool the LLM/daemons call to notify the operator. Appends
`[ISO] [severity] message` to `~/.overwatch/alerts.log`, mirrors to Telegram
(`notifyTelegram`, no-op if unconfigured), and echoes to console. Params:
`message`, `severity` (`INFO`|`WARNING`|`CRITICAL`).

### 6.3 Auto-loader — `src/auto-loader.ts` (the "it just knows" effect)
The `context` hook (Pi's `transformContext`) that injects the right skill text
before each LLM turn. **Data-driven routing** — no hardcoded keyword→file table:

```
last user message ─▶ scoreSkills(prompt)
  for each *.md in ~/.overwatch/skills (excl. _shared):
    skip if frontmatter has `superseded_by`  (deprecated redirect)
    triggerHit = any `triggers:` phrase is a substring of the prompt   (+3)
    nameHit    = any name/filename token ∈ prompt tokens               (+2)
    descHits   = # salient `description:` tokens in prompt (only if no triggers)
    inject if triggerHit || nameHit || descHits ≥ 2
  sort by score, take top MAX_SKILLS=3
  if an injected skill references _shared/multi-timeframe-protocol → inject it too
─▶ splice a {role:"system"} message with the skill bodies before the user message
```

Adding a new skill needs **no code change** — routing reads its frontmatter
(`triggers`, `name`, `description`). Verified routing (9 prompts): "how high can X
go" → `valuation-cycle-analyzer`; "how many shares… risk budget" →
`swing-horizon-sizer`; "check the entry gate" / "run the risk gate" →
`entry-exit-gate`; "which defence stock" → `theme-to-stock-scout`; "watch X, alert
me" → `monitor-watch`; "watch overnight, closing the CLI" → `monitor-watch` +
`monitor-builder`.

---

## 7. Monitoring Engine

Monitoring is **hybrid** — one gate logic, two delivery modes. Neither runs an LLM
in the loop.

| | In-session watcher | Unattended daemon |
|---|---|---|
| File | `src/monitor-watch.ts` | `runtime/daemons/lib/monitor-runtime.js` (+ thin daemon) |
| Runs | while the CLI is open | survives the CLI closing (opt-in) |
| Arm | `~/.overwatch/monitors/<name>.json` | a spawned Node process (pm2/nohup) |
| MCP | reuses chat connection (`callGroww`) | own StreamableHTTP client |
| Selects | monitors **without** `"mode":"daemon"` | its own thesis/config |

### 7.1 In-session watcher — `setupMonitorWatch`
`session_start` hook starts a `setInterval` every `TICK_MS = 60_000`. Each tick
(non-overlapping; skips until `growwReady()`), for every `monitors/*.json`:
- skip if `disabled`, `mode==="daemon"`, or `state.fired` (one-shot).
- respect per-monitor `poll_minutes` (default 5), `marketOpen` (09:15–15:30 IST,
  skip Sat/Sun), and `time_gate_ist`.
- fetch `get_quotes_and_depth` (LTP, `totalSellQty/totalBuyQty` ratio) and, if
  `candle_interval` set, `fetch_historical_candle_data` (last candle green?). Each
  call hard-capped at `CALL_TIMEOUT_MS = 20_000`.
- **`evaluateGates(m, ltp, ratio, green)`** (exported, priority order):
  1. `stop_below` → LTP < it → **CRITICAL, terminal** (invalidation).
  2. `zone:[lo,hi]` + `require_green_candle` + `max_sell_buy_ratio` all satisfied →
     **CRITICAL, terminal** (entry gate met).
  3. `breakout_above` → LTP > it → **WARNING, non-terminal** (fires once).
- **Blind guard:** 3 consecutive fetch failures (`MAX_FAILS_WARN`) → one `WARNING`
  "watcher BLIND"; a recovery logs `INFO` "RECOVERED".

### 7.2 Daemon runtime — `monitor-runtime.js` (`createMonitor(cfg)`)
The one place daemons talk to Groww. Resilient by construction:
- StreamableHTTP against `https://mcp.groww.in/mcp/` (**trailing slash** — `/mcp`
  307-redirects here; note the bridge in §6.1 uses no slash).
- every MCP call `withTimeout`; `tick()` **never throws** — always reschedules
  (`POLL_MS = 60_000`, `BACKOFF_MS = 15_000` after a fail).
- **Escalating watchdog** (pure `fail()`/`recover()`, unit-tested): fail #3 →
  `WARNING` BLIND; fail #10 → `CRITICAL`; every +10 → `CRITICAL` re-ping; first
  healthy cycle after blindness → `INFO` RECOVERED.
- one-shot: `evaluate()` returning true / calling `fire()` sets `state.fired`.
- `cfg.poll` fetches data, `cfg.evaluate` runs the gates — a daemon is thin config
  on top. State persisted to `cfg.statePath`. All IO injectable for tests.

`thesis-monitor.js` is the generic daemon: `THESIS=<path> node thesis-monitor.js`.
It polls today's daily candle all day but only **acts in the close window
(15:15–15:30 IST)** — Rule 4, daily CLOSE decides validity. Gates:
invalidation > setup_A > setup_B (from the thesis JSON, §10). State →
`~/.overwatch/thesis/.state_<symbol>.json`.

### 7.3 monitorctl — `runtime/daemons/monitorctl.js`
Zero-dep fleet manager; discovers monitors from `ps` + the filesystem. Commands:
`list · logs <name> [-n N] [-f] [--raw] · alerts [-n N] [-f] · pause · resume ·
stop · delete <name> -y`. **Mode-aware:** for in-session monitors `pause/stop`
sets the `disabled` flag in the arm file; for daemons it sends `SIGSTOP`/`SIGCONT`/
`SIGTERM`. `logs`/`alerts` translate terse tick lines into plain language with IST
times + severity icons. `delete` refuses to touch shared infra.

---

## 8. Alerting & Delivery

**Every alert producer** — the daemon `emit()`, the in-session watcher `emit()`,
and `console_log_alert` — writes to `~/.overwatch/alerts.log` **and** funnels
through `notifyTelegram()`. So a fire reaches the same sinks regardless of origin.

**Alert line format** (all three variants parse via the alert-bridge regex
`^\[([^\]]+)\]\s+\[(\w+)\]\s+(.*)$`):
- daemon: `[ISO] [SEV] [LABEL] message`
- in-session: `[ISO] [SEV] SYMBOL message`
- console_log_alert: `[ISO] [SEV] message`

**Telegram sink** — `src/telegram.ts` (ESM) + `runtime/daemons/lib/telegram.js`
(CJS twin). Config resolution: env `TELEGRAM_BOT_TOKEN`/`_CHAT_ID`/`_MIN_SEVERITY`
first, then `~/.overwatch/telegram.json`. Severity rank `INFO 0 / WARNING 1 /
CRITICAL 2`; **default push threshold `WARNING`** (skips INFO noise). Delivery is
**fire-and-forget** — a 10s abort timeout, never throws, a Telegram outage never
blocks or crashes a monitor (the alert is still in `alerts.log`). Unconfigured =
silent no-op. Icons: 🔴 CRITICAL / 🟠 WARNING / 🔵 INFO. Discord is not built.

**Alert-bridge** — `src/alert-bridge.ts` (`session_start` hook). Closes the gap
that Pi's chat agent is turn-based and can't see a background fire. It tails
`alerts.log` (from the current end, so it only reacts to this session's events,
`POLL_MS = 4_000`) **and** watches `~/.overwatch/thesis/*.json` state files for
`fired: false → true` flips. On a **CRITICAL** log line or a fired flip it calls
`api.sendMessage({ customType: "overwatch-monitor", … }, { deliverAs: "followUp",
triggerTurn: true })` — waking the agent to **surface + summarize** the fire (one-
line read, then offer the live gate; it does NOT auto-run the gate or pull data).
`DEDUP_WINDOW_MS = 10_000` collapses a CRITICAL line + its fired flip by label.

---

## 9. Data Flow Diagrams

**A — Analysis request:**
```
operator prompt
  │
context hook (auto-loader) ─ injects matching skill(s) + _shared as a system msg
  │
LLM turn ─ calls Groww MCP tools (quotes/depth, candles, indicators, fundamentals)
  │
decisive read (per the injected stage's doctrine) → PASS/STAND-DOWN/NO-BET/GTT stop
```

**B — Monitor fire surfaces in chat (in-session):**
```
watcher tick ─ JS gate met (terminal)
  │
emit() ─┬─▶ alerts.log  (CRITICAL line)
        └─▶ notifyTelegram()  (→ phone, if configured & ≥ threshold)
             │
alert-bridge tail sees the CRITICAL line
  │
api.sendMessage(followUp, triggerTurn) ─▶ agent surfaces it + one-line read
```

**C — Unattended fire (CLI closed):**
```
daemon tick ─ evaluate() fires  OR  watchdog goes BLIND
  │
emit() ─┬─▶ alerts.log        (durable record; monitorctl reads it)
        └─▶ notifyTelegram()  (the ONLY live channel when the CLI is closed)
```

---

## 10. Key Data Types

**Thesis** (`~/.overwatch/theses/<sym>.json`) — the analysis unit:
```jsonc
{ "symbol": "E2E", "name": "E2E Networks Ltd", "exchange": "NSE",
  "framework": "momentum-raid", "created": "2026-06-24",
  "spot_at_creation": 418.2, "atr14": 24.46,
  "triggers": {
    "setup_A_pullback_buy": { "condition": "...", "zone_low": 400, "zone_high": 410,
      "entry": 410, "stop": 373, "risk_per_share": 37, "target": 485, "rr": 2.0 },
    "setup_B_breakout": { "condition": "daily CLOSE above 450", "entry": 450, "stop": 410, "note": "..." },
    "invalidation": { "condition": "daily CLOSE below 369", "action": "STAND DOWN — ..." } } }
```

**Monitor arm file** (`~/.overwatch/monitors/<name>.json`) — in-session watch:
```jsonc
{ "name": "paras-scenario-a", "symbol": "PARAS", "search_query": "Paras Defence",
  "segment": "CASH", "mode": "in-session", "poll_minutes": 5, "time_gate_ist": 935,
  "candle_interval": 15,
  "gates": { "stop_below": 1075, "zone": [1090,1140], "require_green_candle": true,
             "max_sell_buy_ratio": 3.0, "breakout_above": 1310 },
  "state": { "fired": false, "fails": 0, "blindAlerted": false, "breakoutAlerted": false,
             "lastPoll": 0, "lastLtp": 0, "lastRatio": 0, "lastGreen": false } }
```
All gates optional. `mode: "daemon"` makes the in-session watcher **skip** it.

**Daemon state** (`~/.overwatch/thesis/.state_<sym>.json` or `<label>.state.json`):
`{ fired, consecutiveFails, blindLevel, lastAlertedFail, lastError, confirmedAt }`.

**Telegram config** (`~/.overwatch/telegram.json`, chmod 600):
`{ botToken, chatId, minSeverity }`.

---

## 11. Sessions

Provided by Pi's `SessionManager` (JSONL tree sessions in
`~/.overwatch/sessions/`): local, no cloud, no expiry; supports `/fork` (branch a
thesis without re-fetching) and `/tree`. idea.md §11 also specifies `overwatch -r`
(resume) / `-c` (continue).

> ⚠ **Verify:** `index.ts:268` calls `main([], …)` with an **empty argv**, so CLI
> flags like `-r`/`-c` may not be forwarded to Pi as documented (open thread, §15).

---

## 12. Secrets & Auth

- **OS keychain** via `@napi-rs/keyring`, service `overwatch`, accounts `llmKey`,
  `growwToken`, `telegramBotToken`, `telegramChatId`.
- **First run:** required creds (`llmKey`, `growwToken`) seed from `.env` if
  present, else prompt (`@inquirer/prompts`, secret input); then persist to
  keychain. Optional Telegram creds seed from `.env`/env with **no prompt** (opt-in).
- **Telegram** also written to `~/.overwatch/telegram.json` (chmod 600) so daemons
  in a bare shell can deliver.
- **Read-only guarantee (D1):** grep confirms **no order/trade-placement code
  anywhere** in `src/`, `runtime/`, `scripts/`. The Groww token must be
  market-data/holdings scope only.

---

## 13. File & Module Map

```
src/
  index.ts          entry: splash → keychain creds → chdir → boot Pi + wire 5 extensions;
                    holds MASTER_SYSTEM_PROMPT (pipeline registry + rules of engagement)
  mcp-bridge.ts     Groww MCP client; registers ~31 tools; exports callGroww()/growwReady()
  auto-loader.ts    context hook; frontmatter-driven skill routing; exports scoreSkills()
  custom-tools.ts   console_log_alert → alerts.log + Telegram
  monitor-watch.ts  in-session watcher (session_start); exports evaluateGates()
  alert-bridge.ts   tails alerts.log + thesis state → wakes agent to surface fires
  telegram.ts       ESM Telegram sink (twin of the CJS daemon lib)
scripts/
  seed.mjs          copies runtime/ → ~/.overwatch (incl. skills/_shared)
runtime/            (CJS realm — seeded into ~/.overwatch)
  daemons/lib/monitor-runtime.js   resilient runtime + watchdog (createMonitor)
  daemons/lib/telegram.js          CJS Telegram sink twin
  daemons/thesis-monitor.js        generic daily-close daemon
  daemons/monitorctl.js            fleet manager
  daemons/{test-monitor-runtime,telegram-test}.js
  skills/*.md                      the doctrine pipeline (§5) + monitor playbooks
  skills/_shared/multi-timeframe-protocol.md
test-mcp.ts         ⚠ stale scratch probe (uses retired SSEClientTransport + fake token)
CONTEXT.md          glossary / ubiquitous language
docs/adr/000{1..4}-*.md   architecture decisions (0004 = Trades tab data model)
```

---

## 14. Directory Structure (`~/.overwatch/`)

```
~/.overwatch/
├── skills/          doctrine pipeline + monitor playbooks (+ _shared/)
├── theses/          thesis/card/position JSON + journal.jsonl + lessons/  ← input + evidence
│   ├── <sym>.json / <sym>-card.json / <sym>-active-position.json
│   ├── journal.jsonl      closed-trade log (trade-journal skill)
│   ├── _capital.json / _sector-index-map.json   (portfolio-risk / regime-gate)
│   └── lessons/L-*.md     graded case evidence doctrine cites (evidence: L-<date>)
├── thesis/          daemon STATE files (.state_<sym>.json)   ← runtime state
├── monitors/        in-session arm files (<name>.json)
├── daemons/         seeded runtime + generated per-thesis daemons
├── logs/            monitorctl-managed daemon stdout
├── alerts.log       the durable alert feed (all producers)
├── telegram.json    chmod-600 Telegram config
└── sessions/        Pi JSONL tree sessions
```

> **Naming trap:** `theses/` (config) vs `thesis/` (daemon state) are different
> directories. The alert-bridge watches **only `thesis/`** for fired flips (§15).

---

## 15. Known Gaps & Divergences

**Open doctrine threads — mostly RESOLVED in the 2026-07-04→05 audit remediation (see [`FIXLOG.md`](./FIXLOG.md)):**
1. **No-chase RSI:** ✅ RESOLVED — canonical **75–78** across code (`buildMasterPrompt`) and
   all skills; `idea.md` updated to match.
2. **`web_search`:** ✅ RESOLVED (deferred) — no search tool, operator-supplied; the four
   skills that referenced it degrade gracefully and mark it PENDING (Standing Order 8) —
   [ADR 0003](./docs/adr/0003-mature-doctrine-assumes-web-search.md).
3. **Stub skills:** ✅ RESOLVED — `theme-to-stock-scout`, `stock-thesis-validator`,
   `_shared/multi-timeframe-protocol`, and `macro-to-india-mapper` are all authored;
   `entry-exit-gate` is no longer a "functional stub" (Gate 0 + two-mode).
4. **`momentum-raid`:** ✅ RESOLVED — restored as `momentum-campaign` (disciplined,
   time-boxed, obeys the standing orders).
5. **`entry-exit-gate` thresholds:** ✅ RESOLVED — RSI 75–78, 3:1 order-book abort, and the
   first-15–20-min distrust window confirmed; Gate 0 + two-mode entry added.
6. **Daily-drawdown gate is advisory** in V1 (no holdings tool wired; Groww P&L
   fields unconfirmed) — **still open** — [ADR 0002](./docs/adr/0002-drawdown-gate-is-advisory.md).

**Code-level notes worth knowing:**
- **Alert-bridge coverage:** its state-file path watches only `~/.overwatch/thesis/`
  (daemon state). In-session fires surface via the **CRITICAL-log-line** path, not
  the state-file path (in-session state lives in `monitors/*.json`). Both fire the
  same `wake()`, so surfacing works — but the two paths are asymmetric by design.
- **MCP URL:** the bridge uses `…/mcp` (no slash); the daemon runtime uses `…/mcp/`
  (trailing slash, to skip the 307). Intentional — don't "fix" one to match.
- **MCP tool surface:** only 2 of ~31 tools are exercised in code
  (`get_quotes_and_depth`, `fetch_historical_candle_data`). The analytical skills
  assume `get_historical_technical_indicators`, `fetch_stocks_fundamental_data`,
  `resolve_market_time_and_calendar` exist on the live server — introspect to
  confirm names/shapes (idea.md `[CONFIRM]`).
- **`main([])`:** empty argv — verify `-r`/`-c`/fork CLI flags reach Pi (§11).
- **`test-mcp.ts`:** stale — uses the retired `SSEClientTransport` and a fake token;
  the regression test (`test-monitor-runtime.js`) enforces "never `SSEClientTransport`".

---

# PART B — Multi-Tenant Web App (branch `feat/web-app-monorepo`)

## 16. Web-App Pivot — What Changed & Why

The CLI (Part A) is a **single-operator, local-first** app: one Groww token, one LLM
key, state in `~/.overwatch/` files, credentials in `process.env` + OS keychain,
conversation history in Pi JSONL keyed by workspace path with **no user identity**.

This branch keeps the **doctrine untouched** but wraps it as a **multi-tenant web
product**: many isolated users log in (Firebase Auth), chat over a browser UI, arm
monitors, and get fires surfaced back into the originating conversation — with
per-user data isolation in Firestore. The **one hard invariant is preserved: D1 —
never places orders** (Groww read-only everywhere).

**Locked decisions** (see the plan + `overwatch-webapp-pivot` memory):
1. Multi-tenant, full per-user isolation.
2. **BYOK** — each user brings their own Groww read-only token + LLM key, stored
   **encrypted per-user** (AES-256-GCM). *In dev today this is bypassed — see §24.*
3. Backend on the existing Pi box (designed to lift to Cloud Run: storage in
   Firestore, secrets behind an interface).
4. Skills **view-only** in v1 (global doctrine, seeded from `runtime/skills/`).
5. Doctrine refactored into a **transport-agnostic library** (`@overwatch/core`) that
   the CLI, server, and worker all consume.
6. **npm-workspaces monorepo**; API = **Fastify + SSE (server→client) + POST (commands)**,
   long-lived Node process (NOT Cloud Functions).
7. Frontend = **Vite React SPA + assistant-ui**, host-agnostic static bundle.
   **Firebase = Auth + Firestore ONLY (not Hosting).** SPA deploys to **Netlify**.

The blocker the refactor solved: the CLI flowed credentials through **`process.env`**
(process-global — two users would clobber each other). Part B makes credentials
**per-session/per-tick, in-memory only** (`AuthStorage.inMemory()` + a fresh
`ModelRegistry` per session; a `GrowwMcpBridge` instance per user).

---

## 17. Monorepo Layout (`packages/*`)

Root is an npm-workspaces monorepo. Shared types live in `core`.

| Package | Name | Role |
|---|---|---|
| `packages/core` | `@overwatch/core` | Doctrine as a **library**, transport-agnostic: `makeOverwatchExtension(UserContext)`, `GrowwMcpBridge` (per-user token), `OverwatchStore` interface, custom tools, skill auto-loader, gate/watchdog (`evaluateGates`/`fail`/`recover`), `FileStore`, prompt builder. No HTTP, no Firestore dependency. |
| `packages/cli` | `@overwatch/cli` | The original terminal app (Part A), now consuming `core` + `FileStore` (single-user, local files). Kept working as regression safety. |
| `packages/server` | `@overwatch/server` | Fastify + SSE + POST API; `SessionPool`; `FirestoreStore`; per-user creds; message persistence; alert routing. |
| `packages/worker` | `@overwatch/worker` | Multi-tenant monitor poller (replaces the single `overwatch-monitord`). |
| `packages/web` | `@overwatch/web` | React (Vite) SPA + assistant-ui. Standalone (no `@overwatch/*` deps) — talks to the API over HTTP + Firestore over the JS SDK. |

Root `package.json` scripts: `build` (core + cli), **`build:backends`** (core + server +
worker), `dev` (build backends then `concurrently` server + worker + web).

---

## 18. Multi-Tenant Architecture & Firestore Data Model

```
React SPA (Netlify, over-watch.in)
  │  Firebase Auth (Google/email) → ID token on every backend call
  ├─ HTTPS: GET SSE stream + POST commands ───────▶ @overwatch/server (Pi box, Apache→:8787)
  │                                                   • SessionPool (warm AgentSession per uid:cid)
  ├─ Firestore onSnapshot (realtime lists) ◀────────  • per-session AuthStorage+Registry+GrowwMcpBridge
  │                                                   • alert-router (Firestore→sendCustomMessage)
  ▼
Firestore  users/{uid}/…  (per-user isolation)  ◀──── @overwatch/worker (poller)
  skills/ (global, read-only)                          • onSnapshot config sync + hot cache
                                                        • per-user Groww token; writes fires/state
```

Two backend processes, both consuming `@overwatch/core` + storing in Firestore.
Firestore is the durable store **and** the cross-process signal bus (onSnapshot) — no
Redis/PubSub in v1.

**Firestore layout** (per-user isolation via `users/{uid}/**`; field shapes reuse the
CLI's so doctrine logic is untouched):

```
users/{uid}
  profile, settings/{capital,sectorMap,prefs}
  secrets/creds        (AES-256-GCM encrypted; NOT client-readable; server-only)
  conversations/{cid}  { title, model:{provider,id}, createdAt, updatedAt, source? }
    messages/{seq}     { seq, role, content, msg (verbatim Pi message), ts }
  monitors/{name}      { …arm config…, conversationId, gates:{…}, state:{…} }
  theses/{id}          thesis / trade-card / active-position JSON (<sym> / <sym>-card / <sym>-active-position)
  trades/{tradeId}     the AUDIT SPINE (ADR 0005): status + thesis/card/position/gates/close(+verdict); monitors + alerts link by tradeId; journal = trades where status==CLOSED
  journal/{autoId}     LEGACY closed-trade log (superseded by trades/)
  alerts/{autoId}      { ts, severity, message, monitorName?, conversationId?, tradeId?, terminal?, surfaced? }
skills/{name}          (GLOBAL, read-only) — powers the Settings viewer
```

**Security rules** (`firestore.rules`): owner-only `users/{uid}/**`; `secrets/**`
default-deny (written only by the server via Admin SDK, never client-readable); `skills`
read-only. Verified two-user isolation.

**Message storage decision (important):** every message is stored — user, assistant,
**and toolResult** — with the **verbatim Pi `msg`** object (like the JSONL), so a
conversation resumes with **full model context including tool results**. The UI filters
to show only what's useful. On resume, `SessionManager.inMemory()` + `appendMessage`
replays each stored `msg` verbatim (mirrors Pi's own save/load: linear parent chain +
`buildSessionContext`), so the LLM gets full history. See §21.

---

## 19. Core Library Changes (`@overwatch/core`)

The doctrine's four modules were made **mode-agnostic** and parameterized by a
`UserContext`:

```ts
interface UserContext {
  uid; conversationId?; growwToken;                 // decrypted, in-memory only
  llm: { provider:'claude'|'glm', anthropicKey?, ollama?:{apiKey,baseUrl,models,modelId} };
  telegram?; store: OverwatchStore; skillsDir; onMonitorArmed?;
}
makeOverwatchExtension(u, { alertBridge?, shellTools? }): ExtensionFactory
```

- **`mcp-bridge.ts`** → `class GrowwMcpBridge` constructed with `u.growwToken`; former
  module singletons are now instance fields. One MCP socket per warm session.
- **`custom-tools.ts`** → `console_log_alert` / `arm_monitor` / `disarm_monitor` /
  `write_thesis` all route to `u.store`. **Added `list_monitors`** (§20). Daemon-spawn
  deleted (the worker owns polling; the CLI wires `u.onMonitorArmed`).
- **`OverwatchStore`** interface (the seam): `putMonitor/getMonitor/listMonitors/
  deleteMonitor/putMonitorState`, `appendAlert/watchAlerts`, `putThesis/getThesis`.
  Two impls: `FileStore` (`core`, CLI) and `FirestoreStore` (`server`, uid-scoped).
- **`monitor-gates.ts`** — `evaluateGates` + `fail`/`recover` watchdog + `marketOpen`/
  `istClock`, ported from the CJS daemon so the worker and CLI share one implementation.
- **`telegram.ts`** — takes config as a param instead of reading env/files.

---

## 20. Doctrine Shell-Awareness (bash-off on the server)

The CLI runs with built-in shell tools (`bash/read/write/edit`) and local
`~/.overwatch/` files + a local `monitord`. The **multi-tenant server disables shell
tools** (`noTools:'builtin'` + `excludeTools`) and stores everything in Firestore.

The master prompt was therefore made **environment-aware**:

- `MASTER_SYSTEM_PROMPT` → **`buildMasterPrompt({ shellTools })`**. `MASTER_SYSTEM_PROMPT`
  is retained as `buildMasterPrompt({ shellTools: true })` (byte-identical CLI prompt).
- `OverwatchExtensionOptions.shellTools` (default `true`). The **server passes
  `shellTools: false`** (`session-builder.ts`), which swaps the ACTIVE TOOLS + MONITORING
  sections + DATA-INTEGRITY rules 3 & 5 to drop `bash`/`~/.overwatch`/`monitord`/
  `alerts.log`, state "you have NO shell access", and point reads to `list_monitors`.
- **New tool `list_monitors`** (`custom-tools.ts`): reads `u.store.listMonitors()` and
  returns each monitor's gates + last-polled state, with STALE labels (rule 3), so the
  model inspects monitors **without shelling out** (`cat monitors/*.json`).

**Why:** resumed/imported CLI conversations trained the model to call `bash` (to probe
MCP or read monitor JSON). On the shell-less server those calls returned
`"Tool bash not found"` in chat. This change stops the model reaching for tools that
don't exist server-side.

---

## 21. API Server (`@overwatch/server`) — Fastify + SSE + POST

**One in-process `AgentSession` per active conversation** (not a subprocess per
conversation) — cleaner secret injection, higher session density, one fewer serialization
hop for streaming.

Key modules (`packages/server/src/`):

- **`firebase.ts`** — Admin SDK init. `OVERWATCH_FIREBASE_KEY` = **absolute path** to the
  service-account JSON (or `GOOGLE_APPLICATION_CREDENTIALS`). `getDb()` sets
  `ignoreUndefinedProperties`. `verifyIdToken()` → uid.
- **`session-builder.ts`** — `buildUserSession(u, opts)`: per-session `AuthStorage.inMemory()`
  + fresh `ModelRegistry` (registers the GLM/`ollama-cloud` provider when the user has
  Ollama creds). `noTools:'builtin'` + `excludeTools` (shell off). `pickModel` honours a
  desired model, then GLM, then an `ANTHROPIC_DEFAULT_ORDER` (avoids defaulting to an EOL
  model). **Seeds prior messages** verbatim (`appendMessage(msg)`) so resume has full
  context incl. tool results. Passes `shellTools:false` to the doctrine (§20).
- **`pool.ts`** — `SessionPool` keyed `uid:cid`: lazy build, LRU + idle dispose, one
  `subscribe()` fanned out to all SSE sinks. `build` = `buildUserContext` → `loadSeed`
  (all stored messages, seq order) → `buildUserSession` → `attachPersistence` →
  `attachAlertRouter`.
- **`persistence.ts`** — on `agent_end`, flushes new session messages to
  `conversations/{cid}/messages` (`seq` zero-padded, `role`, `content` text, **`msg`
  verbatim**, `ts`); LLM-generates a title on the first turn. Mirrors Pi's JSONL append.
- **`alert-router.ts`** — `onSnapshot` on this conversation's CRITICAL alerts →
  `session.sendCustomMessage({ customType:'overwatch-monitor' }, { triggerTurn:true })` →
  the agent surfaces + one-line-summarizes the fire in-chat; marks `surfaced:true`.
- **`title.ts`** — `generateTitle` (a cheap `noDoctrine` session).
- **`firestore-store.ts`**, **`secrets-store.ts`**, **`crypto.ts`** (AES-256-GCM,
  key from `OVERWATCH_SECRET_KEY`), **`user-context.ts`** (`buildUserContext` — loads
  encrypted creds, or dev `.env` creds — §24), **`env.ts`** (`loadDotenv`,
  `devCredsFromEnv`, `DEV_CREDS_ENABLED`).
- **`main.ts`** — boots it; `PORT` (default 8787), binds `0.0.0.0`. **`OVERWATCH_CORS_ORIGIN`
  is parsed as a comma-separated allowlist** → `string[]` for `@fastify/cors`; unset →
  reflect any origin (dev).

**Routes** (all authed via `Authorization: Bearer <Firebase ID token>` → uid):
`GET /health`, `POST /secrets`, `GET /models`, `POST /conversations`,
`DELETE /conversations/:cid` (recursiveDelete), `POST /conversations/:cid/{prompt,steer,
abort,model}`, `GET /conversations/:cid/stream` (**SSE**). CORS: methods GET/POST/DELETE/
OPTIONS, headers Authorization/Content-Type.

> **SSE + CORS gotcha:** the stream handler `reply.hijack()`s, which bypasses
> `@fastify/cors`, so it sets `Access-Control-Allow-Origin` (reflected origin) + `Vary`
> manually on the raw response. The SPA reads the stream via **`fetch`** (not native
> `EventSource`) so it can send the bearer header.

`scripts/`: `seed-skills.ts`, `deploy-rules.ts`, `import-cli-sessions.ts` (imports past
`~/.pi/agent/sessions/**.jsonl` into a user's Firestore conversation list, full `msg`
per entry, LLM-titled, idempotent).

---

## 22. Monitor Worker (`@overwatch/worker`)

Replaces the single `overwatch-monitord`. **Hybrid design** to avoid Firestore churn
(a monitor polls ~375×/day):

- **Config sync via `onSnapshot`** on `collectionGroup('monitors')` — Firestore *pushes*
  a doc only when it changes (armed/disarmed/edited); the initial snapshot rehydrates all
  armed monitors on startup (crash recovery for free).
- **Hot state = worker-local cache**, mutated every tick (free/fast).
- **60s tick**, NSE hours only (reuses `marketOpen`/`istClock`), all against the cache.
  Per **uid**: decrypt that user's Groww token, open ONE MCP client, fetch
  `get_quotes_and_depth` (+ candles if a green-candle gate is set), run **`evaluateGates`**
  verbatim, mutate state via the `fail`/`recover` watchdog.
- **Firestore writes only on transitions**: fire (alert doc first, then `state.fired`),
  blind escalation (WARN/CRIT), RECOVERED, breakout heads-up (once), plus a **throttled
  state heartbeat (~2–3 min)** for the Monitors-tab "last polled / STALE" label.
- **Per-user token** (BYOK) — no symbol dedup across users; a dead token blinds only its
  owner. Telegram delivery per user, severity-gated.

`main.ts` logs `"[worker] up. Tick 60s during NSE hours; config via onSnapshot; per-user token."`

---

## 23. Web App (`@overwatch/web`) — Vite + assistant-ui

Vite 6 + React 19 + Tailwind v4 + `@assistant-ui/react`. **Standalone** (only public npm
deps; no `@overwatch/*`), so Netlify builds it directly.

- **Chat**: `useLocalRuntime` + a custom `ChatModelAdapter` — `run()` does
  `POST /conversations/:cid/prompt` then reads `GET …/stream` (SSE via fetch reader),
  yielding accumulated text + `tool-call` parts as `message_update`s arrive; `abortSignal`
  → `POST …/abort`. On open, rehydrates messages from Firestore (filtering user/assistant/
  custom, cleaning monitor-event text). Markdown via react-markdown + remark-gfm. Copy
  button (`ActionBarPrimitive.Copy`). Monitor fires render inline so the user can reply.
- **Trades tab** (`TradesTab`): correlates the symbol-keyed theses docs (`<sym>` / `-card`
  / `-active-position`) + the `journal` collection into a 4-stage lifecycle
  (Watching / Carded / Open / Closed) with a client-side expectancy/adherence panel.
  Read-only (D1). See [ADR 0004](./docs/adr/0004-trades-tab-and-trade-lifecycle-model.md).
- **Firestore onSnapshot** drives the conversation list, Monitors, Alerts, and Trades tabs
  (live whether or not a session is warm).
- **Settings**: capital-book editor (`settings/capital`), sector→index map editor
  (`settings/sectorMap`, for regime-gate), and a read-only **Doctrine viewer** grouping
  Constitution / Skills / Shared protocols / Lessons (published by `seed-skills`).
- **Config**: `src/firebase.ts` holds the **public** Firebase client config (safe to
  commit). `src/lib/api.ts` — `API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'`.
  **`VITE_API_URL` is inlined at build time** → must be set to the HTTPS API domain, else
  the bundle calls localhost.
- Theme: blue accent, light/dark (`index.css` Tailwind v4 tokens).

**Netlify** (`netlify.toml` + `public/_redirects`): base `packages/web`, publish `dist`,
Node 22, SPA fallback `/* → /index.html 200`, and `VITE_API_URL` baked for git-connected
builds. Drag-drop deploys use the locally-built `dist` (same `VITE_API_URL`) + the
`_redirects` file.

---

## 24. Secrets & Environment (server/worker)

- **Per-user secrets**: `users/{uid}/secrets/creds` — AES-256-GCM envelope
  (`crypto.ts`), master key `OVERWATCH_SECRET_KEY`, written only by the server callable,
  never client-readable, decrypted in-memory per session/tick.
- **Firebase Admin key**: `OVERWATCH_FIREBASE_KEY` = absolute path to the service-account
  JSON (full-project admin — never committed; `chmod 600` on the box).

Server/worker env (repo-root `.env`, auto-loaded by `loadDotenv`):

| Var | Purpose |
|---|---|
| `OVERWATCH_FIREBASE_KEY` | abs path to Firebase Admin service-account JSON |
| `OVERWATCH_SECRET_KEY` | AES master key for per-user secrets |
| `OVERWATCH_CORS_ORIGIN` | comma-separated frontend origin allowlist |
| `PORT` | server port (default 8787) |
| `OVERWATCH_DEV_CREDS_FROM_ENV` | `1` = single-operator dev fallback (see below) |
| `groww_api_key`, `ANTHROPIC_API_KEY`, `OLLAMA_API_KEY`, `OVERWATCH_LLM`, `overwatch_glm_model` | dev creds/model (same keys the CLI uses) |

> ⚠ **DEV single-operator mode:** when `OVERWATCH_DEV_CREDS_FROM_ENV=1` **and** a user has
> no stored creds, `buildUserContext` falls back to `devCredsFromEnv(.env)` — so **every
> logged-in user shares the `.env` Groww token + LLM key**. This is *not* real multi-tenant
> isolation. For that, deploy the BYOK key-entry UI (parked in v1) and set the flag to `0`.

---

## 25. Production Deployment (Pi box + Netlify)

**Box:** `151.185.47.45`, Ubuntu 24.04, 4 cores / 7 GB, root. Code at **`/opt/overwatch`**.

- **Node 22** (via NodeSource). *Required*: the bundled `undici@8.5.0` (under
  `@earendil-works/pi-coding-agent`) calls `worker_threads.markAsUncloneable`, added in
  Node **22.10** — Node 20 crashes with `TypeError: webidl.util.markAsUncloneable is not a
  function`.
- **pm2** runs `overwatch-server` (:8787) + `overwatch-worker` from
  `ecosystem.config.cjs`; `pm2 save` + systemd startup (survives reboot).
- **Apache** reverse proxy: vhost `api.over-watch.in` → `http://127.0.0.1:8787`, **SSE-safe**
  (`ProxyPass … flushpackets=on`, `ProxyTimeout 3600`, `no-gzip` for `text/event-stream`).
  Modules: `proxy proxy_http headers ssl rewrite`.
- **TLS**: certbot `--apache` on `api.over-watch.in` (Let's Encrypt, auto HTTP→HTTPS
  redirect, auto-renew).
- **ufw**: allow 22/80/443; **8787 NOT exposed** — only Apache reaches the server via
  localhost.
- **Secrets on box**: `/opt/overwatch/secrets/serviceAccount.json` + `/opt/overwatch/.env`,
  both `chmod 600`. `OVERWATCH_FIREBASE_KEY` rewritten to the box path.

**DNS:** `api.over-watch.in` → A → `151.185.47.45` (box). Apex `over-watch.in` + `www` →
Netlify (frontend).

**Frontend:** built locally with `VITE_API_URL=https://api.over-watch.in` (baked; verified
0 localhost refs) → `packages/web/dist` → deployed to Netlify (drag-drop or git). After
deploy: add the Netlify domain(s) to **Firebase → Auth → Authorized domains**.

**Verified end-to-end:** HTTPS `/health` = ok; HTTP→HTTPS 301; cert valid; `/models` via
Apache with a real Firebase token = 200 (29 models incl GLM); CORS allows `over-watch.in`,
rejects unknown origins.

---

## 26. Known Gaps & Open Items (web app)

- **Shared dev creds** — `OVERWATCH_DEV_CREDS_FROM_ENV=1` means all users share the
  `.env` creds; true multi-tenant needs the BYOK onboarding UI + flag `0` (§24).
- **Trades tab / journal** — the CLOSED column reads `users/{uid}/journal`, empty per-user
  until `append_journal` records a close server-side; the Settings Doctrine viewer's new
  Constitution/Shared/Lessons groups need a `seed-skills` re-run to populate. The
  `theses/journal.jsonl` backfill is CLI/repo-only, not seeded to Firestore.
- **`web_search` deferred** — no search tool; the four skills that reference it degrade to
  operator-supplied input (ADR 0003).
- **Netlify custom domain** — `over-watch.in` cert provisioning was pending (TLS mismatch
  at first load); `www` not yet resolving. Finish the Netlify custom-domain step.
- **Stale-bundle trap** — the "No LLM key found" message is shown on **any** `/models`
  failure (misleading); the common cause is a `dist` built without `VITE_API_URL` (calls
  `localhost`). Rebuild with the prod URL + hard-refresh.
- **SSE route CORS** reflects the request origin (the hijacked response isn't run through
  the `@fastify/cors` allowlist). Functional; tighten to the allowlist if needed.
- **Scaling ceiling** — one box (RAM-bound warm sessions + a worker holding every user's
  token, synchronized NSE-hours load). Firestore storage keeps the Cloud Run lift a
  transport change; LRU + staggered polling mitigate.
- **Bundle size** — web JS is ~1 MB (269 KB gzip); no code-splitting yet.
- **Phase 7 hardening** (partially done): pm2 boot-persist ✅, firewall ✅, secrets 600 ✅;
  remaining — delete the dev `.env`/`DEV_CREDS_FROM_ENV` path for real multi-tenant, rules
  re-audit, per-session crash handlers.
