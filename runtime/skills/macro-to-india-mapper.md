---
name: macro-to-india-mapper
description: >
  USE THIS SKILL when the operator starts from the top down — a macro event, global
  news, a policy/commodity/rate move — and wants to know which Indian market THEME
  or sector it favours or hurts. E.g. "what does the defence budget hike mean for
  Indian stocks," "oil just spiked, what plays," "which sectors benefit from the
  rate cut." It maps a macro driver to candidate Indian themes, then hands off to
  theme-to-stock-scout. It does NOT pick a specific stock (use theme-to-stock-scout
  next) or judge one (stock-thesis-validator).
compatibility: Groww MCP (read-only) | Pi agent harness | web_search PENDING (operator supplies the macro read until a search tool exists — ADR 0003)
triggers: [macro, theme, sector, budget hike, union budget, policy, rate cut, which sectors, what plays, commodity, oil spike, rupee, fed, rbi]
---

# Macro → India Mapper — STAGE 1 of the pipeline

**Role:** The intelligence officer who reads the macro board and names the Indian themes
in play, before any single stock is considered. You convert a driver ("crude spiked,"
"RBI cut 50bps," "US 10Y ripping") into a ranked list of Indian sectors/baskets that gain
or lose, and hand the top themes to `theme-to-stock-scout`. You map cause → effect; the
scout finds the stock; the validator judges it.

## DATA INTEGRITY FIRST (Standing Order 8)
- **web_search is NOT wired** (evidence: ADR 0003). You cannot fetch live news. So the
  **operator states the macro event; you never assert that an event happened.** If the
  operator only gestures at a theme, ask for the specific driver + its magnitude + date.
  Never invent a rate decision, a print, a spike, or a headline.
- The transmission map below is **timeless doctrine** (cause→effect structure), not live
  data — you may apply it to an operator-stated event by reasoning. What you may NOT do is
  fabricate the event, its size, or any current price. Quote no number you didn't fetch
  from a tool this turn.
- When web_search lands, Step 1 becomes "verify the event + freshness via web_search";
  until then it is operator-supplied (PENDING, same posture as `delivery.js`).

## Workflow
### Step 1 — Pin the driver (operator-supplied)
Get from the operator: the exact macro event, its magnitude, and its date/horizon
(e.g. "RBI cut repo 50bps today," "Brent +8% this week to $92," "Budget raised defence
capex 13%"). No event stated → ask; do not proceed on a vibe.

### Step 2 — Classify the driver
Rates · currency (USD/INR, DXY, US 10Y) · commodity (crude, metals, gold) · fiscal/policy
(budget, PLI, FDI, duties/bans) · global demand (US/China cycle) · weather/monsoon.

### Step 3 — Apply the transmission map (who gains / loses MARGIN)
Run the ENFORCED checks first (the high-transmission links analysts forget), then the
general method for the rest. A driver usually helps one side of a chain and hurts the
other — always name BOTH sides.

### Step 4 — Rank + hand off
Rank candidate themes by (transmission strength × how clean the listed Indian exposure
is). Output the top 2–3 themes and hand each to `theme-to-stock-scout`. Sector labels MUST
use the same vocabulary as `theses/_sector-index-map.json` / `settings/sectorMap` so
`regime-gate` can resolve each theme's proxy index downstream.

## Enforced correlation checks (run every time the driver touches these)
| Driver | Positive (Indian) | Negative (Indian) | Also check |
|--------|-------------------|-------------------|-----------|
| **USD/INR weak (₹ down)** | IT services, Pharma exporters | Importers (oil, capital goods), heavy-USD-debt names | DXY, FII flow |
| **Crude oil spike** | Upstream oil producers | OMCs, aviation, paints, tyres, logistics, FMCG margins | INR pressure, CAD, inflation → rates |
| **US 10Y / DXY up** | (few) ₹-helped exporters | Rate-sensitives, high-P/E growth, FII-heavy names | FII outflow risk |
| **RBI rate CUT** | Banks/NBFC, auto, real estate, capex | (few) — lender margin lag | transmission lag; stance change vs one-off |
| **Budget / PLI / capex** | Capital goods, defence, infra, railways, the named PLI sector | fiscally crowded-out sectors | new money vs re-announced |
| **Metals up** | Metal producers | Metal consumers (autos, cap goods, white goods) | global vs domestic driver |
| **Monsoon / rural push** | FMCG, 2-wheelers, tractors, agri-inputs | (few) | forecast vs actual |

## General method (everything the table doesn't cover)
1. Decompose the driver into a value chain (upstream → midstream → downstream → buyers).
2. Find where MARGIN moves, not just revenue — the price-taker loses, the price-setter wins.
3. Name the listed Indian proxies for each affected link.
4. Cross-check second-order effects: currency, inflation → rates, input costs, FII flows.
5. Rank by transmission strength × exposure cleanliness. **"No clean India play" is a valid
   output** — a global driver with no good listed Indian expression is a pass, not a stretch.

## Output template
```
MACRO READ — <driver, operator-stated> (<magnitude>, <date>)   [source: operator — web_search PENDING]
CLASS: <rates | currency | commodity | fiscal | global-demand | weather>

TRANSMISSION
  Winners:   <theme> — <why margin improves>   → sector: <sectorMap key>
  Losers:    <theme> — <why margin compresses>
  2nd-order: <currency / rates / inflation / FII>

TOP THEMES (ranked)
  1. <theme> (transmission <hi/med>, exposure <clean/mixed>) → hand to theme-to-stock-scout
  2. ...
NEXT: run each theme through theme-to-stock-scout, then stock-thesis-validator; regime-gate gates any entry.
```

## Guardrails
- **No fabricated events or prices** (Standing Order 8). The operator supplies the driver.
- **Name both sides** of every chain — a driver that helps upstream usually hurts downstream.
- **Symbol-agnostic doctrine** (Standing Order 11) — this skill maps drivers → sectors,
  never a specific stock (that's the scout). Incident evidence lives in `theses/lessons/`.
- **Align sector labels to `settings/sectorMap`** so `regime-gate` can resolve the proxy index.
- **Read-only.** Close operator-facing output with the standing not-financial-advice line.

## Pipeline Position
**`macro-to-india-mapper`** (Stage 1) → `theme-to-stock-scout` (Stage 2) →
`stock-thesis-validator` → `valuation-cycle-analyzer` → `portfolio-risk` →
`swing-horizon-sizer` → `pre-trade-commit` → `entry-exit-gate`. Stage 0 `regime-gate`
runs before any new entry regardless.
