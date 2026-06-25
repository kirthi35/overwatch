# Overwatch

A local-first terminal AI trading assistant for the Indian stock market (NSE).
**Analyze → monitor → alert.** It is a scout and analyst, not a shooter.

> **It cannot place orders.** Overwatch only reads market data and notifies you.
> You execute every trade manually in Groww. Even a full compromise of this tool
> cannot move money (uses a read-only Groww token).

---

## Quick facts (for humans and agents)

| | |
|---|---|
| **Type** | Standalone Node.js CLI |
| **Framework** | Pi agent harness (`@earendil-works/pi-coding-agent`) |
| **LLM** | Anthropic Claude (default) |
| **Data source** | Groww MCP (`https://mcp.groww.in/mcp/`), read-only, ~31 tools |
| **Entry point** | `dist/index.js` (bin name: `overwatch`) |
| **Build** | `npm run build` (tsc → `dist/`) |
| **Seed workspace** | `npm run seed` (copies skills + monitor runtime → `~/.overwatch/`) |
| **Run** | `npm start` or `node dist/index.js` |
| **Tests** | `npm test` (monitor runtime, no network) |
| **Workspace** | `~/.overwatch/` (skills, theses, daemons, monitors, alerts) |
| **Order execution** | **None.** Read-only by design (decision D1). |
| **Node** | 20+ (developed on 25.x) |

---

## Objective

1. Analyze NSE equities using live technical + fundamental data from Groww.
2. Enforce your own trading doctrine as first-class guardrails (risk gates,
   position sizing), not generic playbooks.
3. Monitor watchlists/holdings and fire alerts (to `~/.overwatch/alerts.log`)
   when conditions are met — in-session by default, or via a background daemon
   that keeps watching after the CLI is closed.
4. Keep all data, sessions, keys, and theses **local**.

---

## Keys / credentials

On first run, Overwatch seeds keys from a local `.env` into the OS keychain,
then reads from the keychain on every later run (so `.env` is only needed once).

Copy `.env.example` → `.env` and fill:

| Key | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | LLM provider key (drives the agent) |
| `groww_api_key` | **Yes** | Groww **read-only** API token (market data, holdings) |
| `groww_api_secret` | Optional | Reserved for REST gap-fill (not used in V1) |

> Use a Groww token with **market data + holdings/positions scope only — no
> trade scope.** `.env` is gitignored. Keys live in the OS keychain after first run.

---

## How to run

```bash
# 1. install deps
npm install

# 2. set up credentials (one time)
cp .env.example .env          # then edit .env with your keys

# 3. build
npm run build

# 4. seed the workspace (one time; copies doctrine skills + monitor runtime
#    into ~/.overwatch/). Safe to re-run — never touches your data.
npm run seed

# 5. launch
npm start                     # or: node dist/index.js
```

You get a splash screen, a credentials check, a Groww MCP connection, then an
interactive agent prompt. Type a request in plain English (see below).

> **Why `npm run seed`?** The agent reads its trading doctrine from
> `~/.overwatch/skills/` and runs monitors from `~/.overwatch/daemons/`. Seeding
> copies the version-controlled `runtime/` assets there. Skip it and the doctrine
> features (risk gate, sizing, monitoring) have nothing to load.

---

## Features to try

Type these at the prompt once it launches:

| Feature | Try saying | What happens |
|---|---|---|
| **Live analysis** | `Analyze RELIANCE — is the setup valid right now?` | Pulls quote/depth/candles/fundamentals via Groww MCP, applies doctrine, gives a decisive call. |
| **Risk gate** | `I want to buy TATAMOTORS, run the risk gate.` | Loads `risk-gate.md`, runs all gates in order, stands down if any fails. |
| **Position sizing** | `How many shares of INFY for a ₹5000 risk budget?` | Loads `position-sizing.md`, computes share count from risk + ATR stop. |
| **Momentum framework** | `Is there a momentum breakout in HDFCBANK?` | Loads `momentum-raid.md`. |
| **Valuation framework** | `Give me the valuation case for ITC fundamentals.` | Loads `valuation-campaign.md` (never mixed with momentum). |
| **Monitor (in-session)** | `Monitor PARAS and alert me if it reclaims 1290 with a green candle.` | Arms an in-session watcher (`~/.overwatch/monitors/*.json`); polls during market hours, surfaces a fire back into the chat. |
| **Monitor (unattended)** | `Watch PARAS overnight — I'm closing the CLI.` | Also spawns a resilient background daemon that keeps watching and writes to `alerts.log` after the CLI exits. |
| **Manage monitors** | `monitorctl list` (in another terminal) | List / read logs / pause / resume / stop / delete every monitor (see below). |

Skills auto-load by keyword in your request (risk/size/momentum/valuation/monitor),
so you rarely need to name them.

---

## Monitoring (the alert engine)

Monitoring is **hybrid** — same gates, same alert format, two delivery modes:

| | In-session (default) | Unattended daemon (opt-in) |
|---|---|---|
| Runs | while the CLI is open | survives the CLI closing |
| Process | none (in-app timer) | standalone Node daemon |
| Cost | ~0 (JS gates, no LLM in loop) | ~0 (same) |
| Use when | you're at the terminal | you'll walk away / overnight |

Both evaluate gates in plain JS (`stop_below` / `zone`+green+book / `breakout_above`),
write fires to `~/.overwatch/alerts.log`, and the in-app **alert-bridge** wakes the
agent to surface a fire back into your chat. Monitors **never silently go blind** —
after 3 failed data cycles they write a `WARNING`; the daemon escalates to
`CRITICAL` and re-pings, and logs `RECOVERED` when the feed heals.

How they fit together:

```
arm file ─▶ in-session watcher (JS gate, every ~5m) ─┐
                                                      ├─▶ alerts.log ─▶ alert-bridge ─▶ agent surfaces in chat
spawned daemon (unattended, opt-in) ──────────────────┘
```

### monitorctl — manage every monitor

```bash
node ~/.overwatch/daemons/monitorctl.js list            # all monitors + status (both modes)
node ~/.overwatch/daemons/monitorctl.js logs <name> -f  # human-readable logs (follow)
node ~/.overwatch/daemons/monitorctl.js alerts          # global alert feed, prettified
node ~/.overwatch/daemons/monitorctl.js pause <name>    # in-session: disable · daemon: SIGSTOP
node ~/.overwatch/daemons/monitorctl.js resume <name>
node ~/.overwatch/daemons/monitorctl.js stop <name>
node ~/.overwatch/daemons/monitorctl.js delete <name> -y
```

### Run a daemon directly

The generic daily-close monitor against a thesis file:

```bash
THESIS=~/.overwatch/theses/e2e.json GROWW_API_TOKEN=<token> \
  node ~/.overwatch/daemons/thesis-monitor.js
```

Test the runtime (no network needed):

```bash
npm test     # = node runtime/daemons/test-monitor-runtime.js (7 tests)
```

> **Note:** unattended daemons currently write only to the local `alerts.log`.
> Webhook delivery (Telegram/Discord) — so a fire reaches you while the CLI is
> closed — is specced (`idea.md` §6) but **not yet built**.

---

## Project structure

```
src/
  index.ts            # entry: splash, keychain creds, doctrine prompt, boots Pi
  mcp-bridge.ts       # Groww MCP (StreamableHTTP + Bearer) → Pi tools; callGroww()
  auto-loader.ts      # keyword → doctrine skill injection
  custom-tools.ts     # console_log_alert → alerts.log
  monitor-watch.ts    # in-session watcher: polls armed monitors, JS gates → alerts.log
  alert-bridge.ts     # watches alerts.log; wakes the agent to surface a fire in chat
scripts/
  seed.mjs            # npm run seed → copies runtime/ assets into ~/.overwatch
runtime/              # version-controlled assets seeded to ~/.overwatch (CommonJS realm)
  daemons/lib/monitor-runtime.js   # resilient daemon runtime + watchdog
  daemons/thesis-monitor.js        # generic daily-close monitor
  daemons/monitorctl.js            # manage monitors (list/logs/pause/stop/delete)
  daemons/test-monitor-runtime.js  # regression tests
  skills/*.md                      # doctrine: risk-gate, position-sizing, momentum-raid,
                                   #   valuation-campaign, monitor-builder, monitor-watch
~/.overwatch/         # runtime workspace (created on first run, populated by `npm run seed`)
  skills/  theses/  thesis/  daemons/  monitors/  logs/  alerts.log
```

---

## Notes for AI agents

- **Hard constraint:** no order execution anywhere. Do not add trade/order APIs.
  Groww access is read-only.
- **Workspace:** the agent `chdir`s to `~/.overwatch/` at startup; daemons,
  theses, skills, monitors, and `alerts.log` live there. `runtime/` is the
  version-controlled source — run `npm run seed` to copy it into the workspace
  (edit doctrine in `runtime/skills/` and re-seed, so changes are committed).
- **Doctrine skills** are Markdown in `~/.overwatch/skills/`, injected by
  `src/auto-loader.ts` on keyword match.
- **Monitoring:** in-session is the default — the agent arms a JSON file in
  `~/.overwatch/monitors/` (see `monitor-watch.md`); `src/monitor-watch.ts` polls
  it. Spawn a daemon (on `runtime/daemons/lib/monitor-runtime.js`) only for
  unattended/overnight watching, and set `"mode":"daemon"` in the armed file so
  the in-session watcher skips it. Never use `SSEClientTransport` (Groww retired
  the SSE endpoint); the regression test enforces this.
- **Verify changes:** `npm run build` (typecheck) and `npm test` (monitor tests).
