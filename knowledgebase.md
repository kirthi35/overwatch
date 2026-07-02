# Overwatch — Knowledge Base

**Product:** Overwatch — local-first terminal AI trading assistant (NSE)
**Branch:** `feat/telegram-alert-delivery`
**Last updated:** 2026-07-01 (initial KB — written after reconciling the doctrine
skills into the staged pipeline; documents the codebase as-built and flags open threads)

Single source of truth for the codebase. Pairs with [`CONTEXT.md`](./CONTEXT.md)
(the glossary / ubiquitous language) and [`docs/adr/`](./docs/adr/) (why decisions
were made). Where this doc names doctrine terms (Raid, Campaign, gate, monitor,
fire, blind, operator, capacity), `CONTEXT.md` is authoritative.

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

> ⚠ The RULES OF ENGAGEMENT still state the no-chase RSI as **70–75**; the mature
> skills say **75–78** (open thread #1, §15).

---

## 5. The Doctrine Pipeline & Skills Layer

Skills are Markdown playbooks in `~/.overwatch/skills/` (source in
`runtime/skills/`), loaded on demand by the auto-loader (§6). The doctrine is a
staged pipeline — see `CONTEXT.md` § "The doctrine pipeline" and ADR 0001.

| Stage | Skill | Role | Status |
|---|---|---|---|
| 1 | `macro-to-india-mapper` | macro/global event → Indian theme | ⏳ stub (needs authored doctrine) |
| 2 | `theme-to-stock-scout` | theme → candidate stock(s) | ⏳ stub |
| 3 | `stock-thesis-validator` | is the driver ("why") true + break-triggers | ⏳ stub |
| 4 | `valuation-cycle-analyzer` | HOW HIGH / HOW FAST / HOW LONG (capacity, never a target) | ✅ authored (verbatim) |
| 5 | `swing-horizon-sizer` | is the bet worth it over the horizon + share count; **NO-BET** valid | ✅ authored (verbatim) |
| 6 | `entry-exit-gate` | WHEN: daily-close, order-book ≤ 3:1, closed green reversal, no-chase | ⚙ functional stub (from idea.md gates) |
| — | `_shared/multi-timeframe-protocol.md` | structure read the analytical stages run first | ⏳ stub |
| ops | `monitor-watch` | watch a symbol while the CLI is open | ✅ |
| ops | `monitor-builder` | spawn an unattended daemon | ✅ |

**Deprecated redirects** (kept so old prompts resolve; `superseded_by:` in
frontmatter; the auto-loader never injects them):
`valuation-campaign` → `valuation-cycle-analyzer` ·
`position-sizing` → `swing-horizon-sizer` ·
`risk-gate` → `entry-exit-gate` ·
`momentum-raid` → retired (entry timing folds into `entry-exit-gate`; restorable).

**Sizing formula** (canonical, from `swing-horizon-sizer`): `Shares =
Risk_Budget ÷ (Entry − Stop)`, round **down**. Risk budget = operator-named ₹, else
`account_capital × 1%`; conviction nudges it within preset bounds and never
overrides the stop math. Notional cap 25% of capital. Equities only (no F&O lots).

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
docs/adr/000{1,2,3}-*.md   architecture decisions
```

---

## 14. Directory Structure (`~/.overwatch/`)

```
~/.overwatch/
├── skills/          doctrine pipeline + monitor playbooks (+ _shared/)
├── theses/          thesis CONFIG JSON (<sym>.json)          ← input
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

**Open doctrine threads (flagged during reconcile, none block the build):**
1. **No-chase RSI:** master prompt says `70–75`; mature skills say `75–78`. Pick a
   canonical number (safety-relevant — not changed unilaterally).
2. **`web_search`:** `valuation-cycle-analyzer` (step 5) and the `macro`/`validator`
   stubs need it, but idea.md defers it to V2. Decide: pull into scope or operator
   supplies news manually — [ADR 0003](./docs/adr/0003-mature-doctrine-assumes-web-search.md).
3. **Four stub skills** await authored doctrine: `macro-to-india-mapper`,
   `theme-to-stock-scout`, `stock-thesis-validator`, `_shared/multi-timeframe-protocol`.
   The agent must flag stubs, not invent rules.
4. **`momentum-raid` retired** — confirm, or restore as a distinct momentum mode.
5. **`entry-exit-gate`** thresholds are reconstructed from idea.md — confirm the
   RSI number, the 3:1 order-book abort, and the first-15–20-min distrust window.
6. **Daily-drawdown gate is advisory** in V1 (no holdings tool wired; Groww P&L
   fields unconfirmed) — [ADR 0002](./docs/adr/0002-drawdown-gate-is-advisory.md).

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
