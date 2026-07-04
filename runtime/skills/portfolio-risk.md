---
name: portfolio-risk
description: >
  USE THIS SKILL before sizing or entering ANY trade. It owns the book: total capital,
  per-trade risk budget, total open risk (heat), correlation/sector concentration, and the
  event-blackout check. It converts "how much do I risk" from a guess into a number derived
  from capital. swing-horizon-sizer reads its risk budget; entry-exit-gate Gate 0 requires
  its PASS. Repurposes the retired flat risk-gate into a real book-level layer. Do NOT use it
  to size a single trade's shares (that is swing-horizon-sizer, which consumes this) or to
  time entry (entry-exit-gate).
compatibility: Groww MCP (read-only) | Pi agent harness | feeds swing-horizon-sizer + entry-exit-gate Gate 0
triggers: [portfolio, risk budget, how much capital, total risk, heat, exposure, concentration, position size budget, can i afford, book risk]
---

# Portfolio Risk — the BOOK layer (Standing Order 5, 10)

**Role:** You are the risk officer for the whole book, not one trade. No single trade may be
sized or entered until this layer has set the risk budget and confirmed the book can carry
the new risk. Capital and risk % come FIRST; shares are derived downstream. Never accept a
share count and back-compute the risk (Standing Order 5).

## Capital record (ask once, persist)
On first run, ask the operator ONCE for total trading capital. Persist to
`theses/_capital.json`:
```json
{ "capital": <number>, "risk_pct_per_trade": <number>, "max_open_risk_pct": <number>, "asof": "<date>" }
```
Defaults if the operator gives none: `risk_pct_per_trade = 1.0`, `max_open_risk_pct = 5.0`.
Update these values ONLY on explicit operator instruction (Standing Order 1 applies to
threshold changes made mid-trade).

## The checks (run all; any FAIL → NO-BET)

1. **Per-trade risk budget** = `capital × risk_pct_per_trade`. This is the ONLY risk number
   swing-horizon-sizer may use. The sizer reads it from here; it never invents one.

2. **TOTAL HEAT CAP.** Sum of `(entry − stop) × shares` across ALL open positions (read the
   open positions from `theses/*.json`) must be ≤ `capital × max_open_risk_pct`. A new trade
   that would breach the cap is a **NO-BET regardless of quality**.

3. **CORRELATION CAP.** Maximum **1 open position per theme/sector** (e.g. defence small-caps)
   unless the operator explicitly declares them one combined campaign — in which case their
   COMBINED risk counts as one slot and must fit inside one per-trade budget. (Verified
   exposure: PARAS held + APOLLO buy-monitor armed = same defence-smallcap factor, 2026-07-03.)

4. **EVENT CHECK (Standing Order 10).** Before any GO, confirm no scheduled results / board
   meeting inside the intended hold window. A gap through a stop is not a stop. If an event
   falls in-window → NO-BET (or shorten the window to exit before it).

## Output
```
PORTFOLIO RISK — <date>
  Capital ₹<c> | risk/trade <p>% → budget ₹<b> | max open risk <m>% → cap ₹<cap>
  Open positions: <sym: risk ₹.. > ... | Current heat ₹<h> (<h/cap %>)
  New trade risk ₹<r> → post-trade heat ₹<h+r> (<%>)   HEAT: PASS/FAIL
  Correlation (theme <t>): <n> open in theme → PASS/FAIL
  Event check: <none in window / EVENT <date> → NO-BET>
  VERDICT: BOOK CLEARS (budget ₹<b>) / NO-BET (<reason>)
```

## Pipeline Position
`valuation-cycle-analyzer` → **`portfolio-risk`** (budget + heat + correlation + event) →
`swing-horizon-sizer` (shares from the budget) → `entry-exit-gate` Gate 0 (requires this PASS).

- **Read-only.** You output the book math; the operator executes in Groww. Close every
  operator-facing output with the standing not-financial-advice line.
