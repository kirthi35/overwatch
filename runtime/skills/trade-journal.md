---
name: trade-journal
description: >
  USE THIS SKILL on every trade CLOSE (stop, target, time-stop, or manual exit) to record
  the trade and, every 10 closed trades, report rolling expectancy and adherence. It is the
  feedback loop: without it there is no win rate, no expectancy, no proof the system makes
  money, and no way to see recurring adherence failures. Doctrine amendments must cite this
  data. Do NOT use it to decide a trade (that is the pipeline) — it only records and scores.
compatibility: Pi agent harness | reads theses/*.json + card | writes theses/journal.jsonl
triggers: [journal, log the trade, trade closed, expectancy, win rate, adherence, post-mortem, record the exit, close record]
---

# Trade Journal — the FEEDBACK loop

**Role:** You are the recorder and the scorekeeper. Every closed trade becomes one immutable
line. Every 10 closes, you report whether the system is actually making money and whether it
is following its own rules. A trade the journal never sees is a lesson lost.

## On every CLOSE — record the verdict via the `close_trade` tool
Call `close_trade` with the trade's `tradeId` (do NOT hand-write files). It sets the trade
CLOSED and records the audit verdict — **`thesis_verdict`** (RIGHT | WRONG | PARTIAL: did the
driver actually play out — you propose it from price + driver evidence, the operator confirms)
— while **adherence** ("rules followed?") is derived from the trade's own gates. This is the
feedback loop the weekly audit reads (`close_trade` fields: exit_price, exit_date, realized_R,
hold_days, thesis_verdict, one_line_lesson). The underlying record still holds these fields:
```
symbol, entry_date, exit_date, entry, stop_initial, stop_final, exit_price, shares,
planned_R (from the pre-trade card), realized_R, hold_days, mode (DIP|BREAKOUT),
regime_state_at_entry, gates_passed (list), gates_overridden (list — MUST be empty per
Standing Orders; non-empty = adherence failure), adherence_score (gates_passed ÷ gates_total),
one_line_lesson
```
`realized_R = (exit_price − entry) ÷ (entry − stop_initial)`. A non-empty `gates_overridden`
is an adherence failure and must be surfaced to the operator, not buried.

## Every 10 closed trades — report
- **Expectancy** = `(win% × avg_win_R) − (loss% × avg_loss_R)`.
- **Win rate**, **avg win R**, **avg loss R**, **avg adherence**.
- Doctrine amendments (post-close ratification per Standing Order 1) cite this data — not
  vibes.

## Backfill (already written to `theses/journal.jsonl`)
The audited Jul 1–3 trades are backfilled: one CLOSED record (a +6.6%, ~+1.0R,
HIGH-adherence exit) plus two OPEN positions awaiting close records. The graded case detail
lives in `theses/lessons/` (evidence: L-2026-07-02, L-2026-07-03). Doctrine stays
symbol-agnostic per Standing Order 11.

## Pipeline Position
Runs at the END of the lifecycle: `position-manager` closes the trade → **`trade-journal`**
records it → expectancy feeds the post-close doctrine-review session.

- **Read-only to the market.** This skill only writes the local journal; it never places
  orders. Close operator-facing output with the standing not-financial-advice line.
