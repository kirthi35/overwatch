---
name: momentum-campaign
description: >
  USE THIS SKILL to run a time-boxed momentum swing as a disciplined CAMPAIGN — a real
  restoration of the retired momentum-raid, rebuilt to obey the standing orders. It is NOT an
  ad-hoc "step outside the framework" mode (that is forbidden, Standing Order 2). It wraps the
  normal pipeline with campaign discipline: structural stop, book-sized position, a hard
  calendar exit set at entry, a pre-marked sell-into-strength ladder, and a re-entry protocol.
  Do NOT invoke it to justify chasing a stock that failed the gates.
compatibility: Groww MCP (read-only) | Pi agent harness | consumes the full pipeline
triggers: [momentum campaign, momentum swing, ride the trend, time-boxed swing, campaign]
---

# Momentum Campaign — the restored momentum mode (obeys the constitution)

**Role:** You run a momentum swing as a campaign with a start, a defined risk, a pre-planned
exit ladder, and an end date. Momentum is the reason for the trade, never a licence to skip a
gate. Everything here is subordinate to `_shared/standing-orders.md`.

## Campaign rules
- **Structural stop** per Standing Order 4 (≥1.5×ATR or a valid structural level). Never a
  noise-band stop tightened to pass R:R.
- **Size** per `portfolio-risk` (budget) → `swing-horizon-sizer` (shares). Never a picked
  share count.
- **Hard calendar exit** set AT entry (the deadline is part of the plan, on the card).
- **Sell-into-strength ladder** pre-marked at entry: T1 partial, T2 full.
- **Exit only on** a daily CLOSE below the stop or a driver-break (Standing Order 6). Intraday
  wicks and forming candles are not exits.
- **Re-entry** after a stop-out follows Standing Order 7: one written trigger, then a fresh
  `swing-horizon-sizer` → `entry-exit-gate` decision. No grudge, no chase.
- **Time-stop** if flat past half the window while the driver is cooling — redeploy the
  capital.

## Delivery-percentage confirmation (at entry)
Check entry-day delivery % on the signal candle vs its own 20-day average:
- delivery % ≥ 20-day average → accumulation confirmation.
- delivery % < 20-day average → flag "churn-driven move, halve size."

**If the data source (`daemons/lib/delivery.js`, P4.2) is not yet implemented, mark this
check "PENDING data source" — do not fake it (Standing Order 8).**

## Pipeline Position
`regime-gate` → `theme-to-stock-scout` → `stock-thesis-validator` →
`valuation-cycle-analyzer` → `portfolio-risk` → `swing-horizon-sizer` →
`pre-trade-commit` → `entry-exit-gate` → **`momentum-campaign`** (manage the campaign) →
`position-manager` → `trade-journal`.

- **Read-only.** Close operator-facing output with the standing not-financial-advice line.
