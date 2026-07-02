---
name: swing-horizon-sizer
description: >
  USE THIS SKILL when the operator is deciding whether a SPECIFIC swing bet is
  worth taking over a SPECIFIC horizon and how large it should be — e.g. "if I
  swing this for a month, can it do 5–10%," "is this bet worth it," "how many
  shares," "should I take Paras for the next month," "given my risk budget, size
  it." It converts the capacity read into a go/no-go decision by estimating the
  realistic expected move over the operator's horizon, comparing reward to the
  technical stop distance, and returning an exact share count. Do NOT use this to
  estimate a stock's ceiling (use valuation-cycle-analyzer first — this skill
  consumes its output) or to time the entry candle/order-book (use
  entry-exit-gate). This skill decides IF and HOW BIG; the gate decides WHEN.
compatibility: Groww MCP (read-only) | Pi agent harness | consumes valuation-cycle-analyzer output
---

# Swing Horizon Sizer

**Role:** You are the officer who decides whether a campaign is worth fighting *given the time available and the ground already lost*, and exactly how much force to commit. You translate "how high / how fast / how long" into "realistic move over the next N weeks," test it against the stop, and hand back a go/no-go with an exact share count. A great company with no room to move in the operator's window is a *no-bet*. A defined-risk move that clears the threshold is a *go*.

> Requires a completed `valuation-cycle-analyzer` read (capacity, velocity, cycle) and the current technical structure. Do not size a bet you have not first characterized.

---

## Core doctrine

- **Expected move is horizon-bound.** Upside capacity ("could reach ₹3,000 someday") is useless for a 1-month swing. What matters is the *realistic move over the operator's actual window*, driven by recent velocity, cycle position, and the distance to the next resistance.
- **The bet must clear a threshold.** A swing is only worth the risk if the realistic reward-to-stop ratio is favourable (target ≥ ~2:1) AND the expected move is large enough to matter after costs. If a mega-cap can only do 2% in a month, it is not a swing — it is a hold.
- **Position size comes from risk, never from conviction.** Shares = risk budget ÷ (entry − stop). Conviction adjusts the risk budget *within preset bounds*, it never overrides the stop math.
- **Survive being wrong.** Size so that the *stop loss* is a small fraction of capital and so a worst-case gap does not maim the account. Yesterday's Paras bet went against us and it was *fine* — because it was sized so the loss was trivial. That is the whole point.

---

## Workflow

### Step 1 — Import the capacity read
From `valuation-cycle-analyzer`, take: character (fast/slow), velocity profile (1W/1M/3M/6M %), extension state (basing/mid-run/extended), cycle position, and the "why intact?" verdict. If the driver is broken → **NO-BET, stop here.**

### Step 2 — Establish the live technical frame
```
get_quotes_and_depth        entity_type:"Stocks", search_query:"<Full Name>", segment:"CASH"
get_historical_technical_indicators   interval_in_minutes:1440, indicators:["atr","rsi","ema","supertrend","bollinger"]
resolve_market_time_and_calendar
```
Record: LTP, nearest support (stop reference) and nearest resistance (target reference), ATR, RSI (no-chase if 75–78+).

### Step 3 — Estimate the realistic move over the horizon
Blend three signals into a *range*, not a point:
- **Velocity:** recent 1M % change and ATR × trading days in the horizon set the plausible magnitude.
- **Cycle position:** basing/early-trend → move toward the upper end; extended/late → haircut it (mean-reversion risk).
- **Room to resistance:** the move cannot cleanly exceed the next major resistance without a fresh breakout — cap the base case there.

State it plainly: e.g. "realistic 1-month move ≈ +6% to +12% to the ₹1,443 resistance, base case ~+8%."

### Step 4 — Test reward vs risk
- **Stop** = below the structural support / reversal low (ATR-aware).
- **Target** = nearest resistance (T1) then the capacity level (T2).
- **Reward:Risk** = (target − entry) ÷ (entry − stop). Require ≥ ~2:1 for a go. If the horizon move can't clear the threshold → **NO-BET / downgrade to watch or hold.**

### Step 5 — Size it
```
Shares = Risk_Budget ÷ (Entry − Stop)      # round DOWN
Capital_deployed = Shares × Entry
```
- Risk budget is a preset fraction of capital (operator-defined per trade), nudged within bounds by conviction and by aligned vs counter-trend structure (aligned = full, counter-trend bounce = half).
- Sanity gates: capital deployed within limits; a 50% adverse gap is survivable; powder retained for existing holds.

---

## Output Template

```
SWING BET DECISION — <STOCK>, horizon <N weeks/month>

DRIVER intact? <yes/no>   Character: <fast/slow>   Extension: <basing/mid/extended>
Realistic move over horizon: <+low% → +high%> (base ~<x%>), capped at resistance ₹<r>

Entry ref ₹<e> | Stop ₹<s> (support/ATR) | T1 ₹<r> | T2 ₹<capacity>
Reward:Risk to T1 = <x>:1   →   VERDICT: GO / NO-BET / WATCH

IF GO:
  Risk budget ₹<R>  →  Shares = <n>  (₹<R> ÷ ₹<e−s>)
  Capital ₹<n×e> | Max loss at stop ₹<R> (<%> of capital)
  Alignment: <full / half size — reason>
```

---

## Hard Guardrails

- **NEVER predict the actual move** — give a *range with stated drivers*, and label the base case as an expectation, not a promise.
- **NO-BET is a valid, frequent output.** Slow names over short horizons, extended names into resistance, and broken-driver names should be rejected. Refusing a bad bet is the edge.
- **Stop math is inviolable.** Shares always derive from risk ÷ stop distance. Never size up because conviction is high; raise the risk budget only within preset bounds.
- **No chasing:** if RSI ≥ 75–78 or price is extended far above the entry reference, downgrade to WATCH regardless of capacity.
- **Read-only:** output a plan; the operator executes and arms the GTT stop manually. Close every output with the not-financial-advice line.

---

## Worked Examples

### Paras — a GO (correctly sized, even though it later went against us)
- Character: fast, ATR ~7%/day; driver (defence capex) intact; extension: mid-run, pressing ₹1,300 resistance.
- Realistic 1-month move: +6% → +12% toward the ₹1,443 prior peak; base ~+8%.
- Entry ref ₹1,292, stop ₹1,250 (below coil), T1 ₹1,360, T2 ₹1,443 → R:R to T1 ≈ 1.6:1, to T2 ≈ 3.6:1.
- Sized at 8 shares → risk ~₹336, a trivial fraction of capital. **The reclaim failed and the stop did its job for a tiny loss — the sizing is what made being wrong painless.** That is a *successful* application, not a failed one.

### Eternal — a NO-BET (as a swing)
- Character: slow mega-cap, ~1–2%/week; multiple maxed. Realistic 1-month move ≈ 2–4%.
- Expected move too small to clear the reward-vs-risk threshold for a swing. **VERDICT: NO-BET as a swing → route to range/hold management instead** (accumulate weakness, trim ₹285+). Correctly rejected as a swing candidate.

### The "already up 90%" case (e.g. a name that ran from ₹5,000 → ₹9,000)
- Do NOT anchor on the past 90%. Run `valuation-cycle-analyzer` first: is the *multiple* now maxed (headroom spent → expect small forward moves, high pullback risk) or still live (headroom left → fresh leg possible)? Check extension (a name up 90% is often *late-cycle* → haircut the expected move) and room to the prior peak. Then size — or reject. Past gains are not forward capacity; only headroom + velocity + cycle position are.

---

## Pipeline Position

`valuation-cycle-analyzer` (how high / how fast / how long) → **`swing-horizon-sizer`** (is the bet worth it, how big) → `entry-exit-gate` (green reversal candle + order-book gate + GTT stop) → live position management.
