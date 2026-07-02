# Doctrine is a staged pipeline, not a flat skill set

The trading doctrine is modelled as a six-stage intelligence pipeline —
`macro-to-india-mapper` → `theme-to-stock-scout` → `stock-thesis-validator` →
`valuation-cycle-analyzer` → `swing-horizon-sizer` → `entry-exit-gate` → live
management — where each stage consumes the previous stage's output. This
**supersedes** the flat skill set in idea.md §5 (`valuation-campaign`,
`position-sizing`, `risk-gate`, `momentum-raid`), which are now deprecated
redirects to their pipeline successors. `momentum-raid` is retired outright (entry
timing folds into `entry-exit-gate`).

## Why

The operator's real doctrine (delivered as the authored `valuation-cycle-analyzer`
and `swing-horizon-sizer` skills) is explicitly pipelined — every skill names its
upstream and downstream stage and refuses to do a neighbouring stage's job
("this skill decides IF and HOW BIG; the gate decides WHEN"). Separating capacity
(how high) from sizing (how big) from timing (when) is the doctrine, not an
implementation detail. A flat set of overlapping frameworks blurred those
boundaries and let a high-conviction read override the stop math or a failed gate.

## Consequences

- `valuation-campaign.md`, `position-sizing.md`, `risk-gate.md`, `momentum-raid.md`
  remain in the repo as one-paragraph **redirect stubs** (`superseded_by:` in
  frontmatter) so old prompts resolve; the auto-loader never injects them.
- Four stages ship as **stubs awaiting authored doctrine**
  (`macro-to-india-mapper`, `theme-to-stock-scout`, `stock-thesis-validator`, plus
  `_shared/multi-timeframe-protocol.md`); `entry-exit-gate` is reconstructed from
  documented gates. The agent must flag stubs rather than invent rules.
- The master system prompt's SKILL REGISTRY and the `transformContext` auto-loader
  route by pipeline stage. Adding the remaining authored skills needs no code
  change — routing is frontmatter-driven.
