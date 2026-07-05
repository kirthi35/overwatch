# FIXLOG — Consolidated Audit Remediation (OVERWATCH FIX SPEC, 2026-07-04)

Executed 2026-07-05 against the monorepo (`feat/web-app-monorepo`). The spec assumed the
old CLI layout (`~/.overwatch/`, `src/index.ts`); this repo is an npm-workspaces monorepo.
Path mapping used:

- Doctrine skills → `runtime/skills/**` (the canonical, version-controlled doctrine; seeded
  into the CLI `~/.overwatch/skills` by `scripts/seed.mjs` and into Firestore by
  `packages/server/src/scripts/seed-skills.ts`; read directly by the server). Editing here
  IS "the change in core" the operator asked for.
- Agent system prompt → `packages/core/src/doctrine.ts` (`buildMasterPrompt`), not `src/index.ts`.
- Shared monitor engine → `runtime/daemons/lib/monitor-runtime.js` (CJS) + the multi-tenant
  `packages/core/src/monitor-gates.ts` + `packages/worker`.
- Lesson library → repo-root `theses/lessons/**` (per the spec's pointer paths; version-controlled).

Much of the spec was already implemented by a prior session; this pass verified each task,
completed the gaps, and enforced Standing Order 11 (doctrine purity) across every skill.

Format: `[P<n>.<task>] <file> — DONE|SKIPPED(<reason>)`

## P0 — Constitution
[P0.1] runtime/skills/_shared/standing-orders.md — DONE (existed with Orders 1–10; added Order 11 DOCTRINE PURITY)
[P0.2a] packages/core/src/doctrine.ts — DONE (CONSTITUTION section already declares standing-orders as overriding law)
[P0.2b] packages/core/src/doctrine.ts — DONE (no-chase band already RSI 75–78; verified no 70–75 remains in packages/ or runtime/skills/)
[P0.3] runtime/skills/entry-exit-gate.md — SKIPPED(no Two-Tier / intraday-early-signal content present; superseded by the two-mode gate)

## P1 — Data integrity
[P1.1] runtime/skills/entry-exit-gate.md, position-manager.md — DONE (OFFICIAL CLOSE RULE present; incident narration replaced with lesson pointer per SO-11)
[P1.2] runtime/skills/_shared/multi-timeframe-protocol.md, runtime/daemons/lib/indicators.js — DONE (WARM-UP RULE present; indicators.js enforces 6M min offset)
[P1.3] runtime/skills/monitor-watch.md, monitor-builder.md — DONE (SINGLE-TRUTH RULE present in both)
[P1.4] runtime/daemons/lib/monitor-runtime.js — DONE (CROSS-WIRING GUARD: label from cfg.label closure; [LABEL-MISMATCH-BUG] tripwire when message lacks the firing label). Monorepo note: packages/worker/src/worker.ts stores `label` as a SEPARATE alert field sourced from the firing monitor's own hot entry (never string-interpolated from a shared var), so it is structurally cross-wire-safe; the includes()-tripwire is not applicable there because core gate messages are intentionally label-free.
[P1.5] runtime/skills/monitor-watch.md — DONE ("enforced by Standing Order 8 … applies to ALL price reporting" line present)

## P2 — Skill-file surgery
[P2.1] runtime/skills/entry-exit-gate.md — DONE (Gate 0 incl. regime + portfolio-risk pre-reqs; two-mode FORCED CHOICE; official-close rule; no Two-Tier; no STUB block to remove)
[P2.2] runtime/skills/swing-horizon-sizer.md — DONE (STOP FLOOR + SIZING DIRECTION guardrails; fictional ₹1,292 example absent; real-symbol worked examples removed/de-named; lesson pointer added)
[P2.3] runtime/skills/position-manager.md — DONE (fictional examples replaced with lesson pointer; GAP PLAN RULE; official-close rule)
[P2.4] runtime/skills/macd-catalyst-duration.md — DONE (ADX STRENGTH-not-FRESHNESS slope rule; case study set to "pending"; MINIMUM SAMPLE + cost rule; HORIZON MATCH; no "validated"/"predicts profitability" claims)
[P2.5] runtime/skills/monitor-watch.md — DONE (NO INSTANT-FIRE ZONES rule present)
[P2.6] runtime/skills/stock-thesis-validator.md — DONE (Guardrail 7 VALUATION-REFUTED CAP present)
[P2.7] runtime/skills/theme-to-stock-scout.md — DONE (Step 5 RELATIVE-STRENGTH RANK present)
[P2.8] theses/lessons/2026-07-02-paras-tier1-lesson.md — DONE (file was absent; created carrying the verbatim CORRECTED LESSON block; points to L-2026-07-02)
[P2.9] runtime/skills/** — DONE (doctrine-purity sweep: all of paras|rubicon|eternal|apollo|zomato removed from rules/guardrails/examples/descriptions; incidents replaced with `evidence: L-*` pointers; worked examples de-named to archetypes; "step outside the framework" reworded outside the constitution)
[P2.10] theses/lessons/L-2026-07-01.md, L-2026-07-02.md, L-2026-07-03.md — DONE (created verbatim)

## P3 — New skills
[P3.1] runtime/skills/portfolio-risk.md — DONE (capital record, per-trade budget, TOTAL HEAT CAP, CORRELATION CAP, EVENT CHECK; pipeline sets budget before the sizer, feeds Gate 0)
[P3.2] runtime/skills/trade-journal.md, theses/journal.jsonl — DONE (schema + every-10 expectancy; journal.jsonl backfilled: ETERNAL CLOSED + PARAS/RUBICON OPEN; named backfill list moved out of the skill body into the jsonl per SO-11)
[P3.3] runtime/skills/pre-trade-commit.md — DONE (immutable trade card, match rule, intra-session immutability)
[P3.4] runtime/skills/regime-gate.md — DONE (Stage 0; three checks; Gate 0 line "regime-gate must report GO" present in entry-exit-gate)
[P3.5] runtime/skills/momentum-campaign.md, momentum-raid.md — DONE (time-boxed campaign doctrine; delivery-% check flagged PENDING to delivery.js; momentum-raid redirect → momentum-campaign)
[P3.6] runtime/skills/macro-to-india-mapper.md — DONE (status line = intentionally-unauthored STUB; pipeline runs Stage-0 → scout until authored)

## P4 — Infrastructure
[P4.1] runtime/daemons/lib/indicators.js — DONE (single fetchIndicators() enforcing start_offset ≥ 6M, interval 1440, returns latest + as-of). Refactor of callers: SKIPPED(no daemon/script computes indicators — monitors use only get_quotes_and_depth + fetch_historical_candle_data; grep found no short-offset get_historical_technical_indicators calls to replace. Helper is provided for the analytical stages.)
[P4.2] runtime/daemons/lib/delivery.js — DONE (returns {status:"UNAVAILABLE"}; TODO(P4.2) documents the NSE-archive option; never fabricates)
[P4.3] FIXLOG.md — DONE (this file)

## Coherence changes (needed to make the spec's Gate 0 enforceable)
[core] packages/core/src/doctrine.ts — DONE (SKILL REGISTRY now lists the new mandatory stages: regime-gate Stage 0, portfolio-risk 5a, pre-trade-commit 5c, momentum-campaign, trade-journal; entry-exit-gate entry states its Gate 0 pre-reqs. ROUTING's stale deprecated `risk-gate.md` reference replaced with `entry-exit-gate.md` + Gate 0 pre-reqs. Without this the new stages are invisible to the model and Gate 0 cannot be satisfied.)

## Notes / known follow-ups
- Lesson-library seeding: `theses/lessons/**` is version-controlled and its `evidence: L-*`
  pointers resolve in the repo, but the seed pipeline (seed.mjs / seed-skills.ts) currently
  carries skills only — lessons are NOT yet copied into the CLI `~/.overwatch/theses` workspace
  or into Firestore. Follow-up if the model should be able to open a cited lesson at runtime.
- Acceptance check #2 (`grep "step outside the.*framework" skills/`) returns nothing: the
  constitutional prohibition in standing-orders Order 2 is line-wrapped ("step outside" /
  "the framework" on separate lines), so the line-based grep does not match it. The phrase is
  retained by design there as the forbidden-move rule; all other occurrences were reworded.
- Code-comment example names (e.g. PARAS in indicators.js / monitor-runtime.js rationale
  comments, and PARAS in knowledgebase.md) are outside `skills/` and are left as-is — SO-11
  governs doctrine skill bodies, not implementation comments or the KB.

## Acceptance checks — all PASS
1. no fictional ₹1,292 references in skills — PASS
2. "step outside the framework" only as the (line-wrapped) constitutional prohibition — PASS
3. no no-chase RSI 70–75 in packages/ or skills (canonical 75–78) — PASS
4. standing-orders.md has Orders 1–11; doctrine.ts references it as overriding — PASS
5. entry-exit-gate.md has Gate 0 + two-mode + official-close; no Two-Tier — PASS
6. macd has ADX slope rule; no Jul-2026 case study; no "validated" claim — PASS
7. monitor-watch has NO INSTANT-FIRE + SINGLE-TRUTH — PASS
8. portfolio-risk/trade-journal/pre-trade-commit/regime-gate/momentum-campaign + journal.jsonl (ETERNAL) + FIXLOG exist — PASS
9. 2026-07-02-paras-tier1-lesson.md has CORRECTED LESSON — PASS
10. no new analytical/indicator frameworks beyond those specified — PASS
11. no paras|rubicon|eternal|apollo|zomato in skills; L-2026-07-0{1,2,3}.md exist — PASS
