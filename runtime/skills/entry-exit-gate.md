---
name: entry-exit-gate
description: >
  USE THIS SKILL to decide WHEN to pull the trigger on a bet that swing-horizon-sizer
  already sized as a GO — e.g. "is now the moment to enter this," "check the entry
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

## The gates — run IN ORDER, stand down if any fails

0. SIZER VERDICT GATE. A swing-horizon-sizer GO verdict from THIS session, at a price
   within 1% of the current LTP, is required before running gates 1–4. No verdict, or a
   NO-BET/WATCH verdict → STAND DOWN. Then RECOMPUTE R:R at the actual proposed entry
   price against the structural stop: if price drift has pushed R:R below 2:1, the GO
   is VOID → STAND DOWN. (Standing Orders 2, 3.)
   Also required: regime-gate must report GO this session; portfolio-risk must report
   BOOK CLEARS (budget, heat, correlation, event) this session.
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

OFFICIAL CLOSE RULE: 'Daily close' = the close field of the completed daily candle from fetch_historical_candle_data (interval 1440). The 15:30 LTP from get_quotes_and_depth is NOT the close — the NSE official close is the last-30-min VWAP, and a ₹10+ divergence between the two is on record (evidence: L-2026-07-02). Any gate keyed on the daily close evaluates only after the completed candle is fetchable.

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

## Entry modes — FORCED CHOICE, never blend (Standing Order 1 applies to this section)
Declare the mode BEFORE analysis. Blending modes produces the worst of both — no dip
captured, no real confirmation, full reversal risk (evidence: L-2026-07-02).

MODE A — DIP (buy structural support):
  - Resting limit order AT a pre-identified structural support (prior reversal low, base
    top, EMA/supertrend confluence) — identified while price is ABOVE it.
  - Hard stop below the structure, ≥1.5×ATR from entry (Standing Order 4).
  - Preconditions: structure layer (weekly) UP, driver intact, no event in window,
    regime-gate GO.
  - CONFIRMATION CANDLE IN DIP MODE — OPEN EMPIRICAL QUESTION: whether to additionally
    require a closed green daily candle is UNRESOLVED pending the operator's pullback-
    depth study. Until that study reports, dip mode REQUIRES the closed green daily
    candle (status quo). Do not remove this requirement; log the study as the deciding
    authority.

MODE B — BREAKOUT (buy confirmed strength):
  - Entry only after a daily CLOSE above the named resistance, and only if R:R ≥ 2:1
    still holds from the post-close price. If the close-then-gap makes R:R fail, the
    breakout is missed — a valid outcome, not a problem to engineer around.

FORBIDDEN: entering mid-range on a forming intraday candle (neither at support nor above
confirmed resistance). This is the documented anti-pattern (evidence: L-2026-07-02).

## Pipeline Position
`valuation-cycle-analyzer` → `swing-horizon-sizer` → **`entry-exit-gate`** → live
position management (monitor via `monitor-watch.md` / `monitor-builder.md`).
