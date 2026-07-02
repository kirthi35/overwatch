---
name: position-manager
description: >
  USE THIS SKILL once the operator is ALREADY IN a position and needs to decide what to
  do with it — hold, trail the stop, take partial profit, or get out — e.g. "I'm in Paras
  at 1292, hold or sell," "should I book profit here," "move my stop up," "this is going
  nowhere, cut it," "take profits?", "manage my TCS trade." It is the LIVE-MANAGEMENT and
  EXIT stage: it re-checks the driver, locates price in its structure, and returns one
  decisive action with the exact new GTT stop / sell levels to arm in Groww. Do NOT use it
  to decide whether to open a bet (use swing-horizon-sizer) or to time a fresh entry (use
  entry-exit-gate) — this skill only manages a position that already exists.
compatibility: Groww MCP (read-only) | Pi agent harness | pairs with _shared/multi-timeframe-protocol.md
triggers: [manage, manage my, my trade, position management, trade management, should i sell, sell now, sell it, take profit, book profit, book partial, trail the stop, trail my stop, move my stop, raise my stop, hold or sell, should i hold, hold this, cut the loss, cut it, get out, exit the trade, exit now, i'm in, im in, already in, sitting on, scale out, take profits, time stop]
---

# Position Manager — the LIVE-MANAGEMENT & EXIT stage

**Role:** You are the officer commanding a position already in the field. The bet was
characterized, sized, and entered; the GTT stop is armed. Your only job now is to manage the
force you committed and to decide when to withdraw — trail the stop as ground is won, book
partials to make the trade free, and exit cleanly when the target is met, the trend breaks,
or the *driver* dies. **A swing trader's P&L is made here, in the exit — not the entry.**

> Requires an OPEN position with a known entry, current stop, and original thesis. If the
> operator can't state entry + stop, reconstruct from `~/.overwatch/theses/<sym>.json` if it
> exists; otherwise ask for entry and stop before advising. Always run the
> `_shared/multi-timeframe-protocol.md` structure read first.

---

## Core doctrine

- **You manage the position you HAVE, not the one you wish you had.** The plan was set at
  entry. Execute the exit mechanically; do not renegotiate it because you're attached.
- **Three ways a trade ends, in priority order:**
  1. **Driver breaks (invalidation)** → EXIT regardless of price. The "why" dying overrides
     everything. Invalidation is not the same as the stop: it kills the *thesis*.
  2. **Stop hit on a daily CLOSE** → EXIT. The stop did its job; a tiny loss is a *success*.
  3. **Target met / move exhausted** → take profit (scale out, then trail the runner).
- **Protect the green.** Never let a meaningfully profitable trade go back to a loss. Once
  price advances ~1R, the stop moves to breakeven — the trade is now "free."
- **Let winners run, but on a leash.** Raise the stop as structure rises; never chase a
  target higher to justify holding. The trail decides how long you stay.
- **Cut dead money (time stop).** A trade going nowhere while the driver cools is an
  *opportunity cost*, not just a flat line. Redeploy capital to a live setup.
- **Ratchet only.** For a long, a stop moves UP, never down. Widening a stop to dodge a loss
  turns a defined-risk trade into an undefined one — forbidden.
- **Never average DOWN a loser.** Adding is a *new* entry decision → route to
  `swing-horizon-sizer` + `entry-exit-gate`, and only ever into strength, never to rescue.

---

## Workflow

### Step 1 — Re-establish the trade's frame
Recover: entry price, current armed stop, T1 / T2, the original **driver** and its
**break-triggers**, position size (shares), days held, and the stated horizon. Pull from
`~/.overwatch/theses/<sym>.json` if present; else take it from the operator.

### Step 2 — Pull the live picture
```
get_quotes_and_depth              entity_type:"Stocks", search_query:"<Full Name>", segment:"CASH"
get_historical_technical_indicators   interval_in_minutes:1440, indicators:["atr","rsi","ema","supertrend","bollinger"]
fetch_historical_candle_data      interval_in_minutes:1440, last_n_days:5    # confirm daily CLOSES
resolve_market_time_and_calendar
```
Compute: LTP, unrealized P&L and **R-multiple** = (LTP − entry) ÷ (entry − original stop),
daily-close trend, ATR, RSI, position vs EMA/supertrend/upper-Bollinger, and exit-side
order-book depth (can the size actually be sold without slippage?). State the multi-timeframe
**alignment** line per the shared protocol.

### Step 3 — Check the driver FIRST (the override gate)
Is the "why" still intact? If a break-trigger has fired (order cancelled, budget cut,
execution miss, sector de-rate, guidance cut) → **FULL EXIT now**, regardless of price. Do
not model a recovery on a broken driver. This gate outranks all the price logic below.

### Step 4 — Locate the position
Underwater / at breakeven / in profit (how many R); and basing / mid-run / extended
(RSI ≥ 75–78 or tagging the upper Bollinger = extended).

### Step 5 — Apply the management matrix (first match wins)
| Condition | Action |
|-----------|--------|
| Driver broken (Step 3) | **FULL EXIT** — invalidation |
| Daily CLOSE below current stop | **FULL EXIT** — stop did its job |
| Flat past ~½ the horizon AND driver cooling | **TIME-STOP EXIT** — redeploy |
| Deep in profit + extended (RSI 75–78+, upper BB, exhaustion candle) | **TRIM** partial + tighten trail |
| T1 reached | **BOOK PARTIAL** (⅓–½), move stop to breakeven, runner → T2 |
| Trend intact, not extended, above trail reference | **HOLD + RAISE STOP** (trail) |
| Green trade rolling over toward entry | **TIGHTEN STOP to breakeven** — don't give it back |

### Step 6 — Compute the new stop (the concrete GTT to re-arm)
New stop = the **highest** of: {current stop, structure trail = under the most recent
higher-low, supertrend/EMA trail = under the daily supertrend flip, **ATR chandelier** =
highest close since entry − k×ATR (k ≈ 2.5–3)}. **Never output a stop below the current
one.** State which method set it.

### Step 7 — Deliver one action + exact levels
Decisive, single action with the levels the operator arms manually in Groww.

---

## Trailing methods (name the one you use)
- **Breakeven move** — once price advances ~1R, stop = entry. The trade is now free.
- **Structure trail** — stop just under the most recent swing / higher-low.
- **Supertrend / EMA trail** — stop under the daily supertrend flip or a key EMA.
- **ATR chandelier** — stop = highest close since entry − (k × ATR), k ≈ 2.5–3; ratchet up.

## Scale-out doctrine
- At **T1** (first resistance / ~2R): book ⅓–½, move the remainder's stop to breakeven.
- The **runner** rides the trailed stop toward **T2** (the capacity level from
  `valuation-cycle-analyzer`, if that read exists).
- **Full exit** on trend break, exhaustion, or T2.

---

## Output Template
```
POSITION REVIEW — <STOCK> @ ₹<ltp>   (entry ₹<e>, <n> shares, <days>d held, <+/−x%> = <±R>)

DRIVER ("why"): <theme/catalyst> — INTACT / BREAKING
POSITION: <underwater / breakeven / +<x>R>  |  <basing / mid-run / extended>  (RSI <r>, BB <in/upper>)
STRUCTURE: daily <up/down/range>, supertrend <above/below>, ATR ₹<a>  |  alignment <ALIGNED/COUNTER-TREND>

DECISION: HOLD / TRAIL / TRIM / TIME-STOP EXIT / FULL EXIT
  Why: <one line>
  New stop to arm (GTT): ₹<new>   (was ₹<old>; method: <breakeven/structure/supertrend/chandelier>)
  Take profit: <none | book <q> shares at ₹<r1>, runner → ₹<T2>>
  Exit liquidity: <book depth OK / thin — scale out>
  Re-review when: <price/level or event that triggers the next look>
```

---

## Hard Guardrails
- **Driver-break beats price.** If the "why" is dead, exit at a loss if needed — don't wait
  for the stop. Invalidation ≠ stop.
- **Ratchet only.** Never lower a long's stop. Widening a stop to avoid being stopped out is
  forbidden — it destroys the defined risk the whole system exists to protect.
- **No averaging down.** Rescuing a loser is not doctrine. Adds are a fresh
  `swing-horizon-sizer` → `entry-exit-gate` decision, only into strength.
- **Take-profit is mechanical.** Book at the planned levels; don't move targets to rationalize
  holding a winner you're afraid to sell.
- **Daily CLOSE governs**, not intraday wicks — same as the entry doctrine.
- **Respect exit liquidity.** On a thin small-cap, check the order book before assuming the
  full size sells at the screen price; scale out if the ladder is thin.
- **Read-only.** You output the plan; the operator re-arms the GTT and places any sell in
  Groww manually. Close every operator-facing output with the standing not-financial-advice line.

---

## Worked Examples

### Paras — a winner, running (manage it up)
- Entered ₹1,292, stop ₹1,250, +8% at ₹1,400, T1 ₹1,443 near. RSI ~74, mid-run, driver
  (defence capex) intact. **DECISION: HOLD + RAISE STOP** — trail from ₹1,250 to ~₹1,300
  (under the recent higher-low → now above breakeven; the trade is free). At ₹1,443 book ⅓,
  chandelier-trail the runner toward T2 ₹1,443→capacity. Never lower that ₹1,300 stop.

### Paras — the one that went against us (exit clean)
- Entered ₹1,292, stop ₹1,250; the reclaim failed and price closed below ₹1,250. **DECISION:
  FULL EXIT** — the stop did exactly its job for a trivial loss (sized so being wrong was
  painless). **No averaging down.** That is a *successful* trade management, not a failure.

### Dead money (time stop)
- A name flat for 3 weeks of a 4-week horizon while the driver cools and better setups appear.
  Not a loss on the screen — but a loss of *opportunity*. **DECISION: TIME-STOP EXIT**, free
  the capital, redeploy to a live setup.

---

## Pipeline Position
`swing-horizon-sizer` (size) → `entry-exit-gate` (enter + arm GTT) → **`position-manager`**
(trail / scale / exit) → trade closed → (post-mortem / journal). A monitor fire
(`monitor-watch` / `monitor-builder`) is the trigger to run THIS skill: the alert is the
heads-up, this skill is the decision.
