---
name: regime-gate
description: >
  STAGE 0 — USE THIS SKILL before macro-to-india-mapper and before ANY new entry. It reads
  the market regime (Nifty trend, sector trend, index extension) and returns REGIME GO or
  REGIME NO-GO. NO-GO blocks new momentum entries (existing positions are unaffected —
  position-manager runs normally). It exists because all four 2026-07-01→03 trades were
  stretched-momentum bought into a consolidating tape with no regime check. Do NOT use it to
  pick a stock (theme-to-stock-scout) or judge one (stock-thesis-validator).
compatibility: Groww MCP (read-only) | Pi agent harness | Stage 0 of the pipeline
triggers: [regime, market regime, risk on, risk off, is the market ok, nifty trend, breadth, tape]
---

# Regime Gate — STAGE 0 (the tape before the trade)

**Role:** You are the officer who reads the battlefield weather before any raid is planned.
A great setup in a hostile tape is still a loss. You do not pick stocks; you decide whether
NEW momentum risk is allowed at all today.

## The three checks (Groww MCP)
1. **Nifty trend.** Nifty 50 (segment INDEX) daily CLOSE > its 50-day SMA, AND the 50-SMA is
   higher than it was 10 sessions ago (rising).
2. **Sector trend.** The candidate's sector proxy index (operator-maintained mapping in
   `theses/_sector-index-map.json`; if unmapped, use Nifty 500) passes the SAME test as (1).
3. **Extension sanity.** Nifty RSI(14) daily < 75.

(All indicators computed per the warm-up rule — ≥6M of candles — in
`_shared/multi-timeframe-protocol.md`.)

## Output
```
REGIME GATE — <date>
  Nifty: close ₹<c> vs 50SMA ₹<s> (<above/below>), 50SMA slope <rising/falling> → PASS/FAIL
  Sector <index>: <same> → PASS/FAIL
  Nifty RSI(14): <r> (<75) → PASS/FAIL
  VERDICT: REGIME GO / REGIME NO-GO
```
- **REGIME GO** = all three pass.
- **REGIME NO-GO** = any fail → **no NEW momentum entries.** Existing positions are managed
  by `position-manager` unaffected.

## Pipeline Position
**`regime-gate`** (Stage 0) → `theme-to-stock-scout` → `stock-thesis-validator` →
`valuation-cycle-analyzer` → `portfolio-risk` → `swing-horizon-sizer` →
`pre-trade-commit` → `entry-exit-gate`.

- **Read-only.** Close operator-facing output with the standing not-financial-advice line.
