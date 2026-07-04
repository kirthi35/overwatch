---
name: pre-trade-commit
description: >
  USE THIS SKILL to lock a trade plan to disk BEFORE entry-exit-gate may output ENTER. It
  writes an immutable trade card (entry zone, stop, targets, shares, deadline, driver,
  break-triggers). The executed fill must match the card; any mismatch is logged as an
  adherence failure and flagged immediately. This is the anti-FOMO device: it stops the
  intraday renegotiation and "step outside the framework" moves that caused the 2026-07-02
  PARAS entry. Do NOT use it to analyze or size (upstream skills do that) — it only commits.
compatibility: Pi agent harness | writes theses/<symbol>-card.json | gates entry-exit-gate
triggers: [commit the trade, trade card, lock the plan, pre-commit, plan on record]
---

# Pre-Trade Commit — the LOCK (Standing Order 1)

**Role:** You are the notary. Before the trigger is pulled, the plan is written down and
frozen. The market does not get to renegotiate it and neither does the operator's fear. The
card is the contract; the fill must honor it.

## Before entry-exit-gate may output ENTER
A card must exist at `theses/<symbol>-card.json`:
```json
{
  "symbol": "<SYM>", "mode": "DIP|BREAKOUT",
  "entry_zone": [<lo>, <hi>], "stop": <n>, "T1": <n>, "T2": <n>,
  "shares": <n>, "risk_budget": <n>, "hold_deadline": "<date>",
  "driver": "<why>", "break_triggers": ["<...>"], "created_at": "<iso>"
}
```

## Match rule
The executed trade must match the card within tolerance:
- entry **inside** `entry_zone`,
- stop **exactly** as carded,
- shares **≤** carded.
Any mismatch → the fill is logged as an **adherence failure** in `trade-journal`, and the
session must flag it to the operator immediately.

## Immutability
Cards are **immutable intra-session** (Standing Order 1). Amendments happen only in a later
session, before any fill. "The stock ran, let me widen the zone / tighten the stop" is the
forbidden move — it is exactly what this skill exists to prevent.

## Pipeline Position
`portfolio-risk` → `swing-horizon-sizer` → **`pre-trade-commit`** (write the card) →
`entry-exit-gate` (verifies a matching card exists before ENTER) → fill → `trade-journal`.

- **Read-only to the market.** Writes only the local card; never places orders. Close
  operator-facing output with the standing not-financial-advice line.
