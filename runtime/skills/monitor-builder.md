---
name: monitor-builder
description: >
  USE THIS SKILL to build an UNATTENDED background daemon that keeps monitoring after
  the CLI is closed (walk-away / overnight). Writes a thin daemon on the shared
  resilient runtime and delivers fires to Telegram.
triggers: [daemon, background monitor, unattended, overnight, walk away, walk-away, spawn, monitorctl, close the cli]
---

# Monitor Builder Playbook

## When to use this (escape hatch only)
For a NORMAL watch — a stop, an entry zone, a breakout heads-up — DO NOT write a
daemon. Call the `arm_monitor` tool (see `monitor-watch.md`); the single
always-on `overwatch-monitord` handles it and already survives the CLI closing.
Use THIS skill only when the thesis needs gate logic the generic schema can't
express (custom indicators, multi-leg conditions, non-standard data). When you
do, pass `mode:"daemon"` to `arm_monitor` for that symbol so the shared daemon
skips it (no double-polling).

## Purpose
Create background monitoring daemons that track conditions using Groww MCP and
fire alerts to `~/.overwatch/alerts.log` — even after the CLI is closed. Every
alert emitted via the shared runtime (`lib/monitor-runtime.js` → `emit`) is ALSO
delivered to the user's **Telegram bot** when configured (no extra code in the
daemon; the runtime handles it). Default push threshold is WARNING+CRITICAL.

## Hard rules (learned the hard way)
A monitor that goes silently blind is worse than no monitor: it gives false
confidence while a stop break sails past unseen. Every monitor MUST:

1. **Use the StreamableHTTP transport against `https://mcp.groww.in/mcp/`**
   (trailing slash). The legacy `SSEClientTransport` / `/sse` path is RETIRED
   and returns `terminated: other side closed`. NEVER use `SSEClientTransport`.
2. **Time-box every MCP call** so a hung connection can't freeze the loop.
3. **Never die on error** — always reschedule the next poll.
4. **Run a blind-watchdog** that writes escalating WARNING→CRITICAL alerts to
   `alerts.log` (the user watches that file, NOT the daemon's stdout).

All of this lives in `~/.overwatch/daemons/lib/monitor-runtime.js`. DO NOT
re-implement MCP plumbing in a daemon. Write thin config on top of the lib.

## Daemon Template
Save to `~/.overwatch/daemons/<name>.js`. Fill in `label`, `statePath`,
thresholds, `poll` (what data to fetch), and `evaluate` (the gates).

```javascript
const path = require('path');
const os = require('os');
const { createMonitor } = require('./lib/monitor-runtime.js');

const SEARCH = 'Company Name';   // Groww search_query
const LABEL  = 'TICKER';
const statePath = path.join(os.homedir(), '.overwatch', 'thesis', `${LABEL.toLowerCase()}.state.json`);

// --- thresholds (example: intraday reclaim/break watch) ---
const RECLAIM = 1290, ENTRY_HIGH = 1305, HARD_INVALID = 1240, MAX_SELL_BUY = 3.0;

const monitor = createMonitor({
  label: LABEL,
  statePath,
  // opts overrides DEFAULTS: POLL_MS, CALL_TIMEOUT_MS, BACKOFF_MS,
  // MAX_FAILS_WARN, MAX_FAILS_CRIT, REALERT_EVERY, TIME_GATE (IST HHMM), etc.
  opts: { TIME_GATE: 935 },

  // poll(client, helpers) -> data. helpers.call(name, args) is a timeout-wrapped
  // client.callTool that returns the parsed first-text-content JSON.
  poll: async (_client, { call }) => {
    const q = await call('get_quotes_and_depth',
      { search_query: SEARCH, segment: 'CASH', entity_type: 'Stocks' });
    const data = q.result.quotes_depth[0];
    const c = await call('fetch_historical_candle_data',
      { company_name: SEARCH, interval_in_minutes: 15, last_n_days: 1, segment: 'CASH' });
    const candles = c.result.candles;
    return { data, lastCandle: candles[candles.length - 1] };
  },

  // evaluate(data, helpers). helpers.alert(msg, severity) writes to alerts.log.
  // Return true (or call helpers.fire()) to stop the monitor (one-shot).
  evaluate: ({ data, lastCandle }, { alert, fire }) => {
    const ltp = data.ltp;
    const ratio = data.totalBuyQty > 0 ? data.totalSellQty / data.totalBuyQty : 99;
    const green = lastCandle && lastCandle.close > lastCandle.open;

    if (ltp < HARD_INVALID) {
      alert(`${LABEL} broke below ${HARD_INVALID} (LTP ${ltp}). Thesis dead. Stand down.`, 'WARNING');
      return fire();
    }
    if (ltp >= RECLAIM && ltp <= ENTRY_HIGH && green && ratio < MAX_SELL_BUY) {
      alert(`${LABEL} RECLAIM CONFIRMED — LTP ${ltp}, green candle, book ${ratio.toFixed(2)}:1. RUN THE LIVE GATE before any entry.`, 'CRITICAL');
      return fire();
    }
  },
});

monitor.start();
```

## The watchdog (why this fixes the blind-monitor bug)
`monitor-runtime.js` counts consecutive failed cycles and escalates:
- fail #`MAX_FAILS_WARN` (default 3) → **WARNING** "monitor BLIND … check the position manually in Groww."
- fail #`MAX_FAILS_CRIT` (default 10) → **CRITICAL** "still blind … watch this position yourself NOW."
- every `REALERT_EVERY` fails after that → another CRITICAL ping.
- first healthy cycle after being blind → **INFO** "RECOVERED."

The client cannot fix an unreachable Groww backend, but it will never again let
a dead feed look like a quiet market.

## Token & launch
The lib reads the token from `GROWW_API_TOKEN` / `GROWW_MCP_TOKEN` / `GROWW_TOKEN`.
Launch via `pm2 start ~/.overwatch/daemons/<name>.js --name ow-<name>` or
`GROWW_API_TOKEN=<tok> nohup node ~/.overwatch/daemons/<name>.js > <name>.out 2>&1 &`.

## Managing monitors (monitorctl)
One tool runs the whole fleet — `~/.overwatch/daemons/monitorctl.js` (zero-dep,
discovers monitors from `ps` + the filesystem, so it works on every daemon
including legacy ones with no pidfile). Use it instead of raw `ps`/`kill`:

```
node ~/.overwatch/daemons/monitorctl.js list            # all monitors + status
node ~/.overwatch/daemons/monitorctl.js logs <name> -f  # human-readable logs (follow)
node ~/.overwatch/daemons/monitorctl.js alerts          # global alert feed, prettified
node ~/.overwatch/daemons/monitorctl.js pause <name>    # SIGSTOP — freeze, no restart
node ~/.overwatch/daemons/monitorctl.js resume <name>   # SIGCONT
node ~/.overwatch/daemons/monitorctl.js stop <name>     # SIGTERM
node ~/.overwatch/daemons/monitorctl.js delete <name> -y  # stop + remove its files
```

`logs`/`alerts` translate the terse tick line
(`LTP 1232 | zone[..]:false | green15m:true | sell:buy 4.55:1`) into plain
language with IST times and severity icons. `pause` freezes a live process
without killing it — note a paused monitor is BLIND while frozen (it won't poll
or run the watchdog), so resume it before relying on it again. `delete` refuses
to touch shared infra (`monitor-runtime.js`, `thesis-monitor.js`, itself).

## Generic thesis monitor
For a standard daily-close thesis JSON (`~/.overwatch/theses/<sym>.json`), don't
write a new file — reuse `thesis-monitor.js`:
`THESIS=~/.overwatch/theses/<sym>.json node ~/.overwatch/daemons/thesis-monitor.js`
