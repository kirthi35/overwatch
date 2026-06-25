# Monitor Watch Playbook (in-session, lightweight)

## Purpose
The DEFAULT way to "watch" a stock while the Overwatch CLI is open. You arm a
monitor by writing one JSON file; an in-process watcher polls it during market
hours with cheap JS gates (no daemon, no LLM in the loop) and writes any fire to
`~/.overwatch/alerts.log`, where the alert-bridge wakes you to surface it.

Use this instead of writing+spawning a daemon UNLESS the user will close the CLI
/ leave the position overnight — then ALSO use `monitor-builder.md` (see below).

## How it works
- You write `~/.overwatch/monitors/<name>.json` (see schema).
- The watcher (built into the app) picks it up on its next minute tick — NO
  restart needed.
- It polls every `poll_minutes` (default 5), only during NSE hours (skips
  weekends), only after `time_gate_ist` if set.
- It uses the chat's own Groww MCP connection — you don't re-implement anything.
- On a terminal gate it writes a CRITICAL/`fired` line and stops (one-shot). On
  the breakout heads-up it writes one WARNING and keeps watching.
- If data is unreachable for 3 cycles it writes a BLIND warning (so the watch
  can't go silently dead).

## Arming schema
```json
{
  "name": "paras-scenario-a",
  "symbol": "PARAS",
  "search_query": "Paras Defence",
  "segment": "CASH",
  "mode": "in-session",
  "poll_minutes": 5,
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
All gates are optional — include only what the thesis needs. Gate logic
(evaluated in priority order):
1. `stop_below` — LTP under it → CRITICAL, terminal (invalidation).
2. `zone`+`require_green_candle`+`max_sell_buy_ratio` — LTP in zone, last candle
   green (if required), book ratio under cap → CRITICAL, terminal (entry gate).
3. `breakout_above` — LTP over it → WARNING, non-terminal heads-up (fires once).

## Modes
- `"mode": "in-session"` (default) — the watcher owns it.
- `"mode": "daemon"` — the watcher SKIPS it; a spawned daemon owns it. Set this
  when you also start a daemon (unattended mode) so the symbol isn't polled
  twice.

## Unattended (walk-away) monitoring
If the user will CLOSE the CLI, the in-session watcher stops with it. For that
case ALSO follow `monitor-builder.md` to write + spawn a standalone daemon, and
set `"mode": "daemon"` in the armed file. (Durable webhook delivery — Telegram/
Discord — is the piece that makes closed-CLI alerts actionable; not built yet.)

## Managing
`monitorctl list` shows armed in-session monitors alongside running daemons.
To stop watching, delete the file: `rm ~/.overwatch/monitors/<name>.json`
(or set `"disabled": true`).
