---
name: risk-gate
description: >
  DEPRECATED — the mandatory pre-entry gate sequence now lives in entry-exit-gate
  (timing gates) with sizing/reward tests in swing-horizon-sizer and thesis
  alignment in stock-thesis-validator. Kept only as a redirect. Do NOT apply this
  file's logic.
superseded_by: entry-exit-gate
---

# Risk Gate — DEPRECATED (redirect)

The old flat "risk gate" split across the pipeline:

- **Thesis alignment** → `stock-thesis-validator.md` (is the story true).
- **Reward-vs-risk + ATR stop + share count** → `swing-horizon-sizer.md`.
- **Timing gates** (daily-close trend, order-book ≤ 3:1, closed green reversal
  candle, no-chase) → **`entry-exit-gate.md`**.
- **Daily-drawdown** → advisory (the agent confirms with the operator; V1 does not
  track account P&L — see `docs/adr/0002-drawdown-gate-is-advisory.md`).

**→ Read `entry-exit-gate.md` for the go/stand-down decision.** See `CONTEXT.md`
§ "The doctrine pipeline".
