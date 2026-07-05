# ADR 0005 — Auditable trade lifecycle & weekly review

**Status:** Proposed (2026-07-05) · **Branch:** `feat/web-app-monorepo`
**Revises:** ADR 0004 (the "correlate trades by symbol" decision — see D1)

## Context

The operator wants to **audit the whole system weekly**: for each trade, see the
conversation that spawned it, the **thesis (the why)**, the plan, whether the **gates were
followed or overridden**, the **monitors and alerts** around it, the outcome, and a
**verdict** — *was the thesis right?* and *were the rules followed?*

Today the Trades tab (ADR 0004) can't support that:
- It correlates trades **by symbol**, so it can't disambiguate re-entries or reliably link
  the *right* conversation/monitors/alerts to a specific trade.
- The **thesis "why" is lost by close** — it lives on the Watching doc; the Open/Closed
  record doesn't carry it.
- There is **no verdict** — no "thesis right?" / "rules followed?" captured at close.
- Nothing links **conversation ↔ trade ↔ monitors ↔ alerts**.

A trade log without the thesis and a judgment is just a P&L list. This ADR makes the
**trade the audit spine** and everything else hang off it.

## The three questions the audit must answer

```
1. Was the THESIS right?      did the reason we entered actually play out?
2. Were the RULES followed?   adherence — gates passed vs overridden?
3. Is the DOCTRINE profitable? expectancy WHEN adherent (rules followed)?
```

They are distinct. A loss because the thesis was wrong is variance; a loss because we
**overrode our own gates** is a discipline failure, not a doctrine failure. PARAS/RUBICON
(see `theses/lessons/`) are the canonical case: both were rule-breaks, so their losses
must NOT be counted against the doctrine — only against adherence.

## Decisions

### D1 — A trade gets a stable **trade id**; it is the audit spine (revises ADR 0004)
ADR 0004 correlated by symbol (minimal, but too loose for audit). Instead: when a trade is
first committed (Carded), it is minted a **`tradeId`**. The card, the position, the close
record, the monitors armed for it, and the alerts it fires all **carry that `tradeId`**.
The Watching-stage thesis may exist before a `tradeId` (pure research); it acquires one
when it is carded. Re-entry (Standing Order 7) = a **new `tradeId`** that references the
prior. Symbol and conversation become attributes of the trade, not the join key.

*Why:* only a stable id can answer "show me THIS trade's conversation, monitors, alerts,
and outcome" — especially across re-entries and symbol reuse over months.

### D2 — Carry the thesis "why" all the way to the close
The thesis (driver, key claims, break-triggers, archetype) rides with the trade from
Watching → Carded → Open → Closed. At close you can still read *why we entered*, next to
*what happened*.

### D3 — Capture a **verdict** at close (two judgments + a lesson)
When the operator says "I closed it," the record gains:
- **`thesis_verdict`**: did the driver play out? `RIGHT | WRONG | PARTIAL` (+ one line why).
- **`adherent`**: were the rules followed? Derived — `true` iff `gates_overridden` is empty.
- **`one_line_lesson`**: the takeaway.
Plus the existing `realized_R`, `hold_days`, exit.

### D4 — Link conversation ↔ trade (auto)
Tools run inside a conversation, so stamp the originating **`conversationId`** on the trade
when it's created (monitors and alerts already carry it). From a trade you can open the
chat that produced it; from a chat you can list the trades it produced. No manual linking.

### D5 — The weekly review surface
A **week-filtered audit view** (the Trades tab gains an "Audit / by week" mode; a dedicated
Review tab can come later if needed). For the selected week:
- **Per trade, one audit card:** `WHY → PLAN → FOLLOWED? → THESIS RIGHT? → R`, with
  jump-links to its conversation, its monitors, and its alerts.
- **Aggregate scorecard:** **expectancy when adherent vs when not**, adherence trend,
  win/loss, and a breakdown of override types.

### D6 — The lesson loop closes the audit
A rule-break trade (non-empty `gates_overridden`) **auto-drafts a lesson stub**; the
operator ratifies it in a post-close session (Standing Order 1) and it lands in
`theses/lessons/` as `L-<date>-<slug>`, which doctrine then cites. The weekly review is
where amendments get proposed — citing the journal data, never vibes (per `trade-journal`).

## What each stage shows (the clean card, replacing raw JSON)

```
<SYMBOL> — <STATUS>            (<±R> if closed)
  WHY:        <thesis one-liner — the driver>
  PLAN:       entry <..> · stop <..> · target <..> · <n> sh
  GATES:      followed ✓   |   OVERRIDDEN ✗ <which>   (adherence)
  [OPEN]      live P&L <..>, monitor <name>
  [CLOSED]    exit <..> · thesis <RIGHT/WRONG/PARTIAL> · <lesson>
  LINKS:      conversation · monitors · alerts        (jump to each)
  ▸ raw docs  (collapsed; developer detail only)
```

## Weekly review — the payoff

```
WEEK of <date>
  Trades: N   ·   Closed: M   ·   Adherent: X/M
  Expectancy (adherent):    +<a>R      ← the "is the doctrine right?" number
  Expectancy (rule-breaks): −<b>R      ← the "is my discipline right?" number
  Recurring overrides: <type ×k>  → candidate lessons

  Per trade → audit card (above) + conversation/monitors/alerts links
```
The operator reviews the chat + trades + monitors + alerts for the week in one place, and
ratifies any lessons. That is the whole-system audit.

## Phasing
- **Phase 1 (foundation):** `tradeId` spine + link conversation/monitors/alerts + carry the
  thesis + capture close verdict (`thesis_verdict`, `adherent`, lesson) + the clean
  per-trade audit card (replaces raw-JSON dump). Fix the Open-vs-Carded mis-bucketing
  (decide from the data — shares held + live P&L = Open — not the doc name).
- **Phase 2 (review):** week filter + aggregate scorecard split by adherence + jump-links.
- **Phase 3 (loop):** auto-drafted lesson stubs from rule-breaks → ratify → `theses/lessons/`.

## Open decisions for operator review
1. **Trade identity (D1)** — adopt the `tradeId` spine (revises ADR 0004's symbol
   correlation)? Recommended — audit needs it. *This is the foundational call.*
2. **Verdict authorship (D3)** — the AI proposes `thesis_verdict` at close from price +
   driver evidence, operator confirms? (vs operator states it outright.) Recommended: AI
   proposes, operator confirms.
3. **Review home (D5)** — week-filter on the Trades tab first, dedicated Review tab later?
   Recommended: filter first, don't add a tab until it's earning its place.
4. **Backfill** — do the three audited trades (ETERNAL/PARAS/RUBICON) get full audit records
   (with verdicts from the lessons), or only new trades from here? Recommended: backfill the
   three so the first weekly review has real content.

## Non-goals
Order placement (D1 read-only, forever). Auto-judging the thesis without operator confirm.
Cross-user audit (per-user only). Real browser/scraping.
