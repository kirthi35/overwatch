---
name: macro-to-india-mapper
description: >
  USE THIS SKILL when the operator starts from the top down — a macro event, global
  news, a policy/commodity/rate move — and wants to know which Indian market THEME
  or sector it favours or hurts. E.g. "what does the defence budget hike mean for
  Indian stocks," "oil just spiked, what plays," "which sectors benefit from the
  rate cut." It maps a macro driver to candidate Indian themes. It does NOT pick a
  specific stock (use theme-to-stock-scout next).
compatibility: Groww MCP (read-only) | Pi agent harness | web_search (V2 — see gap note)
triggers: [macro, theme, sector, budget hike, union budget, policy, rate cut, which sectors, what plays, commodity]
---

# Macro → India Mapper — STAGE 1 of the pipeline

**Role:** The intelligence officer who reads the macro board and names the Indian
themes in play, before any single stock is considered.

> ⏳ **STUB — awaiting the operator's authored doctrine.** The role, pipeline
> position, and likely inputs are known from downstream skills; the actual mapping
> logic, theme taxonomy, and scoring are NOT yet defined. Do not invent them.

## To be authored
- [ ] The macro→theme mapping method (how a driver becomes a ranked theme list).
- [ ] The theme taxonomy the operator uses (sectors/baskets and their tickers).
- [ ] Sourcing for the macro read — **needs `web_search`, which idea.md §2 defers
      to V2.** Confirm whether web search is now in scope or the operator supplies
      the macro read manually. (See `docs/adr/0003-mature-doctrine-assumes-web-search.md`.)
- [ ] Output template + hand-off shape consumed by `theme-to-stock-scout`.

## Pipeline Position
**`macro-to-india-mapper`** → `theme-to-stock-scout` → `stock-thesis-validator` →
`valuation-cycle-analyzer` → `swing-horizon-sizer` → `entry-exit-gate`.
