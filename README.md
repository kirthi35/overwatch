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
| **Run** | `npm start` or `node dist/index.js` |
| **Workspace** | `~/.overwatch/` (skills, theses, daemons, alerts) |
| **Order execution** | **None.** Read-only by design (decision D1). |
| **Node** | 20+ (developed on 25.x) |

---

## Objective

1. Analyze NSE equities using live technical + fundamental data from Groww.
2. Enforce your own trading doctrine as first-class guardrails (risk gates,
   position sizing), not generic playbooks.
3. Monitor watchlists/holdings with background daemons and fire alerts
   (to `~/.overwatch/alerts.log`) when conditions are met — even after the CLI
   is closed.
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

# 4. launch
npm start                     # or: node dist/index.js
```

You get a splash screen, a credentials check, a Groww MCP connection, then an
interactive agent prompt. Type a request in plain English (see below).

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
| **Background monitor** | `Monitor PARAS and alert me if it reclaims 1290 with a green candle.` | Builds + spawns a resilient daemon that watches and writes to `alerts.log`. |
| **Read alerts** | `tail -f ~/.overwatch/alerts.log` (in another terminal) | Live feed of daemon alerts. |

Skills auto-load by keyword in your request (risk/size/momentum/valuation/monitor),
so you rarely need to name them.

---

## Background monitors (the alert engine)

Monitors are standalone Node daemons in `~/.overwatch/daemons/` built on a shared
resilient runtime so they **never silently go blind**:

- Live Groww transport (StreamableHTTP `/mcp/`), per-call timeouts, auto-reschedule.
- Escalating blind-watchdog → `alerts.log`: **WARNING** after 3 failed cycles,
  **CRITICAL** after 10, periodic re-pings, **RECOVERED** when the feed heals.

Run the generic daily-close monitor against a thesis file:

```bash
THESIS=~/.overwatch/theses/e2e.json GROWW_API_TOKEN=<token> \
  node ~/.overwatch/daemons/thesis-monitor.js
```

Test the runtime (no network needed):

```bash
node runtime/daemons/test-monitor-runtime.js     # 7 tests
```

---

## Project structure

```
src/
  index.ts            # entry: splash, keychain creds, doctrine prompt, boots Pi
  mcp-bridge.ts       # Groww MCP (StreamableHTTP + Bearer) → Pi tools
  auto-loader.ts      # keyword → doctrine skill injection
  custom-tools.ts     # console_log_alert → alerts.log
runtime/              # assets deployed to ~/.overwatch (CommonJS realm)
  daemons/lib/monitor-runtime.js   # resilient monitor runtime + watchdog
  daemons/thesis-monitor.js        # generic daily-close monitor
  daemons/test-monitor-runtime.js  # regression tests
  skills/monitor-builder.md        # how the agent generates monitors
~/.overwatch/         # runtime workspace (created on first run)
  skills/   theses/   daemons/   alerts.log
```

---

## Notes for AI agents

- **Hard constraint:** no order execution anywhere. Do not add trade/order APIs.
  Groww access is read-only.
- **Workspace:** the agent `chdir`s to `~/.overwatch/` at startup; daemons,
  theses, skills, and `alerts.log` live there. `runtime/` is the version-controlled
  source of those daemon/skill assets (not yet auto-seeded — copy manually if needed).
- **Doctrine skills** are Markdown in `~/.overwatch/skills/`, injected by
  `src/auto-loader.ts` on keyword match. Edit doctrine there, not in code.
- **Monitors:** always build on `runtime/daemons/lib/monitor-runtime.js`. Never
  use `SSEClientTransport` (Groww retired the SSE endpoint). The regression test
  enforces this.
- **Verify changes:** `npm run build` (typecheck) and
  `node runtime/daemons/test-monitor-runtime.js` (monitor tests).
