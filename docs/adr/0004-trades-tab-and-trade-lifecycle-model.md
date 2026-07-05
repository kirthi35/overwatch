# ADR 0004 — Trades tab (read-and-correlate the existing symbol-keyed docs)

**Status:** Accepted (2026-07-05) · **Branch:** `feat/web-app-monorepo`
**Reviewed via:** `/plan-eng-review` + independent adversarial review (repo-verified)

## Context

The doctrine pipeline (see FIXLOG.md) produces a per-symbol trade lifecycle: thesis
(validator/valuation) → trade card (pre-trade-commit) → open position
(entry-exit-gate / position-manager) → closed record + expectancy/adherence
(trade-journal). None of it is visible in the web app.

**A first design (one trade doc with a `status` field) was rejected after an
independent review verified it against the repo.** The verified facts that killed it:

- `write_thesis` (`custom-tools.ts:198-230`) already writes **multiple symbol-keyed
  docs per trade**: `<sym>` (thesis), `<sym>-card` (`pre-trade-commit.md:21`),
  `<sym>-active-position` (tool example). The codebase is *already* multi-doc-per-symbol.
- `putThesis` = `set(merge:false)` / `writeFileSync` (`firestore-store.ts:48`,
  `file-store.ts:82`) — a full overwrite. A one-doc model with re-entry would overwrite
  and destroy the closed record.
- `SettingsTab.tsx:73` already writes `users/{uid}/settings/capital` from the browser.
- `MonitorsTab.tsx:79` already correlates theses to a symbol.
- The doctrine SINGLE-TRUTH RULE (`monitor-watch.md:69`) makes
  `theses/<symbol>.json` THE authoritative per-symbol record — i.e. one active trade per
  symbol at a time is an assumed invariant, and closed history lives in the journal.

Fusing thesis+trade onto one doc fought that grain and required rewriting ~10 skills +
a migration that was in neither PR. So we go **with** the grain instead.

## Decision — read-and-correlate

The Trades tab **reads the documents the skills already produce** and correlates them
by symbol into a lifecycle. No new doc model, no skill rewrite, no migration.

```
users/{uid}/theses/{id}          (existing; written by write_thesis)
  <sym>                  -> thesis root  (SINGLE-TRUTH record for the symbol)
  <sym>-card            -> trade card   (pre-trade-commit)
  <sym>-active-position -> open position (entry-exit-gate / position-manager)
users/{uid}/journal/{autoId}     (NEW collection; closed-trade records)
users/{uid}/settings/capital     (existing; SettingsTab already writes it)
```

### Lifecycle correlation (tolerant, per base symbol)
Group all theses docs by base symbol (strip `-card` / `-active-position` suffix; also
honor a `symbol` field when present, like MonitorsTab). Then:

```
in journal (open journal record for symbol)   -> CLOSED  (history)
has <sym>-active-position (or position fields) -> OPEN
has <sym>-card                                 -> CARDED
<sym> thesis only                              -> WATCHING
```

- **journal** is its own append-only collection (`users/{uid}/journal`), matching the
  jsonl semantics. Closed history survives re-entry (which overwrites
  `<sym>-active-position`). This is the ONLY genuinely-new persistence surface.
- **expectancy / adherence** = client-side aggregate over journal records.
- **capital** = reuse existing `settings/capital` (no new writer required for the tab).

## What we build (PR1)

**Producer side (core + server + CLI) — the one gap:**
- `JournalRecord` type + `OverwatchStore.appendJournal(record)` in `packages/core`.
  - FileStore: append one JSON line to `theses/journal.jsonl` (already the convention).
  - FirestoreStore: add a doc to `users/{uid}/journal` (autoId).
- `append_journal` custom tool (tool-based → works with `shellTools:false`). The
  `trade-journal` skill calls it to record a CLOSE on the server; on the CLI it still
  maps to the jsonl file. Store parity: same interface, representation per store (same
  seam as monitors/alerts).

**Reader side (web, `packages/web`, standalone) — the tab:**
- `TradesTab.tsx`: `useCollection('users/{uid}/theses')` + `useCollection('users/{uid}/journal','exit_date'|'ts','desc')`; correlate by symbol into 4 lifecycle columns; a detail drawer per trade (thesis + card + position + close + R math + gates_overridden). Expectancy/adherence panel from journal records.
- Nav wiring for the "Trades" tab (same place Monitors/Alerts register).

**Not new:** doc model, skills, migration, `settings/capital` writer, worker.

## Invariants / edge cases
- **One active trade per symbol** (doctrine assumes this). Pyramiding / concurrent
  same-symbol is explicitly out of scope; a re-entry overwrites `<sym>-active-position`
  and the prior close is already in the journal.
- **expectancy() MUST skip records with `realized_R == null`** (the PARAS/RUBICON
  backfill rows are OPEN, null R) or the panel renders NaN. **Mandatory test.**
- **0 closed trades → no div-by-zero.**
- **Correlation is string-suffix based** (`-card`, `-active-position`); tolerate a
  `symbol` field when the doc has one. Document the id convention so producers stay aligned.
- **uid isolation** already enforced by `firestore.rules` (owner-only); add a `journal`
  rule (owner-only) since it's a new collection.

## Tests (PR1)
- `appendJournal` — FileStore appends a valid jsonl line; FirestoreStore adds a doc (unit).
- `computeExpectancy(records)` — skips null R (regression), 0-closed → "—" not NaN,
  win/loss/avg-R math on a fixture (unit).
- correlation grouping — `<sym>` / `<sym>-card` / `<sym>-active-position` → correct
  lifecycle bucket; `symbol`-field fallback (unit).
- uid isolation on `journal` (firestore.rules test / E2E).

## NOT in scope
- One-doc trade model / status field (rejected above).
- Skill rewrites, doc migration, pyramiding, concurrent same-symbol.
- Settings capital-editor changes, sector-map editor, Doctrine/Lessons viewer → PR2.
- Order placement — **D1, forever.** The tab records manual fills/closes; it never trades.
- Worker changes — none.

## Firestore rules delta
Add owner-only rule for `users/{uid}/journal/{doc}` (mirror the existing per-user rules).
