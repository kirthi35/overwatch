---
name: monitor-watch
description: >
  USE THIS SKILL to watch an NSE symbol. Call the arm_monitor tool; the single
  always-on monitor daemon polls it every minute during market hours, survives
  the CLI closing, and surfaces a fire back into the chat (and to Telegram).
triggers: [monitor, watch, alert me, keep an eye, arm a monitor, poll, arm_monitor, disarm]
---

# Monitor Playbook (the one monitor)

## Purpose
The way to "watch" a stock. You arm a monitor by calling the **`arm_monitor`
tool**. A single always-on daemon (`overwatch-monitord`) polls every armed
monitor during market hours with cheap JS gates (no LLM in the loop) and writes
any fire to `~/.overwatch/alerts.log`, where the alert-bridge wakes you to
surface it. Telegram delivery (if configured) means fires reach the user even
with the CLI closed.

There is ONE monitor engine now — it runs whether the CLI is open or not. You do
NOT choose between "in-session" and "daemon"; `arm_monitor` starts the daemon on
demand. (For bespoke gates that don't fit the generic schema below, hand-write a
daemon per `monitor-builder.md` and pass `mode:"daemon"` so this one skips it.)

## How it works
- You call the **`arm_monitor` tool** (it writes+validates
  `~/.overwatch/monitors/<name>.json` and ensures the daemon is up — do NOT
  hand-write that file).
- The daemon picks it up on its next minute tick — NO restart needed. Deleting
  the file (`disarm_monitor`) drops it on the next tick.
- It polls every `poll_minutes` (default 1 — every minute), only during NSE
  hours (skips weekends), only after `time_gate_ist` if set.
- It uses one shared Groww MCP connection per tick.
- On a terminal gate it writes a CRITICAL/`fired` line and stops that monitor
  (one-shot). On the breakout heads-up it writes one WARNING and keeps watching.
- If data is unreachable it runs an escalating blind watchdog: WARNING at 3
  consecutive failures, CRITICAL at 10, re-pings after that — so the watch can't
  go silently dead.

## Arming (call the tool)
Call `arm_monitor` with these params (the tool writes+validates the JSON file —
don't hand-write it):
```json
{
  "name": "paras-scenario-a",
  "symbol": "PARAS",
  "search_query": "Paras Defence",
  "segment": "CASH",
  "poll_minutes": 1,
  "time_gate_ist": 935,
  "candle_interval": 15,
  "gates": {
    "stop_below": 1075,
    "zone": [1090, 1140],
    "require_green_candle": true,
    "max_sell_buy_ratio": 3.0,
    "breakout_above": 1310
  }
}
```
All gates are optional — include only what the thesis needs (at least one
required; `require_green_candle` needs `candle_interval`). Gate logic
(evaluated in priority order):
1. `stop_below` — LTP under it → CRITICAL, terminal (invalidation).
2. `zone`+`require_green_candle`+`max_sell_buy_ratio` — LTP in zone, last candle
   green (if required), book ratio under cap → CRITICAL, terminal (entry gate).
3. `breakout_above` — LTP over it → WARNING, non-terminal heads-up (fires once).

## Walk-away (CLI closed)
Automatic — the daemon survives the CLI. To actually SEE a fire while away,
configure Telegram (`.env` → `telegram_bot_token` + `telegram_chat_id`);
otherwise the fire only lands in `alerts.log` and the user won't see it until
they reopen the CLI. Default push threshold is WARNING+CRITICAL.

## Bespoke gates (escape hatch)
If the thesis needs logic the generic gates can't express, hand-write a daemon
per `monitor-builder.md` and pass `mode:"daemon"` to `arm_monitor` so the shared
daemon skips that symbol (no double-polling).

## Reading status is NOT a live price (DATA INTEGRITY)
The monitor JSON (`~/.overwatch/monitors/<name>.json`) is CONFIG plus a
`state` block the daemon writes. `state.lastLtp` / `state.lastPoll` is a PAST,
timestamped reading — NOT the current price. Reading this file is NOT a quote.
- To report a LIVE price, make a fresh `get_quotes_and_depth` (or equivalent)
  call THIS turn. If it fails, you are BLIND — say so; do not read the file and
  present its number as "now".
- If you cite `state.lastLtp`, label it `last polled <state.lastPoll>, STALE`.
- Do not claim a monitor is "live / polling now" from the file alone — confirm
  with `market_feed_status` (feed reachable AND monitord running).
- Never invent a tick-by-tick sequence across repeated "check" requests.

## Managing
`monitorctl list` shows armed monitors + the running daemon.
To stop watching, call the **`disarm_monitor`** tool with the monitor `name`
(or `rm ~/.overwatch/monitors/<name>.json`, or set `"disabled": true`).
