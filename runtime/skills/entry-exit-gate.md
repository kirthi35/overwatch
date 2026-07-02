---
name: entry-exit-gate
description: >
  USE THIS SKILL to decide WHEN to pull the trigger on a bet that swing-horizon-sizer
  already sized as a GO — e.g. "is now the moment to enter Paras," "check the entry
  gate," "can I buy this here," "should I add now." It runs the mandatory timing
  gates in order and stands down if ANY fails: daily-close trend, order-book
  sell:buy ratio, a CLOSED green reversal candle, and the no-chase ceiling. It does
  NOT decide IF/HOW BIG (use swing-horizon-sizer) or estimate capacity (use
  valuation-cycle-analyzer). This skill decides WHEN, and outputs the GTT stop level.
compatibility: Groww MCP (read-only) | Pi agent harness | consumes swing-horizon-sizer output
triggers: [entry gate, exit gate, pull the trigger, buy here, enter now, add now, order book, depth, reversal candle, when to buy]
---

# Entry / Exit Gate — the WHEN stage

**Role:** The officer at the trigger. The bet is already characterized
(`valuation-cycle-analyzer`) and sized (`swing-horizon-sizer`). You decide only
whether *this candle, this moment* is a valid entry, and you STAND DOWN the instant
a gate fails. Cash is a valid position.

> ⚠ **STUB status:** these gates are reconstructed from documented doctrine
> (idea.md §5.1 + the no-chase band in `swing-horizon-sizer`/`valuation-cycle-analyzer`).
> Confirm the exact thresholds against your live rules before relying on it.

## The gates — run IN ORDER, stand down if any fails

1. **Daily-close trend confirmation.** Validity is set by the daily **CLOSE**, not
   intraday wicks. A forming candle proves nothing.
2. **Order-book gate.** sell:buy depth ratio **> 3:1 = ABORT, no exceptions.**
   Re-check at the *actual moment of entry*. Treat the first **15–20 min** after
   open as unreliable (thin ladder).
3. **Confirmed reversal candle.** Never buy a falling price — require a **CLOSED
   green reversal candle**, not a forming one.
4. **No-chase ceiling.** If **RSI ≥ 75–78** *or* price is above the upper Bollinger
   / far above the entry reference → **downgrade to WATCH** (no chasing).

## Data (Groww MCP, read-only)
```
get_quotes_and_depth              entity_type:"Stocks", search_query:"<Full Name>", segment:"CASH"
get_historical_technical_indicators   interval_in_minutes:1440, indicators:["rsi","bollinger","atr"]
fetch_historical_candle_data      interval_in_minutes:1440, last_n_days:2   # confirm the CLOSE
resolve_market_time_and_calendar  # is it a live session? are we past the first 15-20 min?
```

## Output
```
ENTRY GATE — <STOCK> @ ₹<ltp>
 1. Daily-close trend .... PASS / FAIL (<why>)
 2. Order-book ≤ 3:1 ..... PASS / FAIL (<ratio>:1, session-age <n>m)
 3. Closed green reversal  PASS / FAIL
 4. No-chase (RSI/BB) .... PASS / WATCH (<rsi>)
VERDICT: ENTER NOW / STAND DOWN / WATCH
GTT stop to arm in Groww: ₹<stop>   (from swing-horizon-sizer)
```

- **Read-only:** you output a plan; the operator executes and arms the GTT manually.
  End every operator-facing output with the standing not-financial-advice line.

## Open reconciliation (flag to operator)
- The master system prompt (`src/index.ts`) still states the no-chase RSI as
  **70–75**; the mature skills say **75–78**. Pick one canonical number.

## Pipeline Position
`valuation-cycle-analyzer` → `swing-horizon-sizer` → **`entry-exit-gate`** → live
position management (monitor via `monitor-watch.md` / `monitor-builder.md`).
