---
name: theme-to-stock-scout
description: >
  Takes a sector or thematic thesis from the user and surfaces the best listed way to play
  it — mapping the value chain, finding the purest exposure, and ranking candidates on
  fundamentals, valuation, and chart position. USE THIS SKILL whenever the user expresses a
  theme, trend, or macro tailwind and wants a stock out of it — e.g. "ethanol manufacturing
  is booming in India, find me the best stock", "defence indigenisation is a multi-year
  story", "data-center capex is exploding, who benefits", "rural recovery play". Trigger on
  any "X is booming / X is the next big thing / who plays X" phrasing, even without the word
  "stock". Do NOT use when the user already named a specific stock (use
  stock-thesis-validator) or for an event/news shock (use macro-to-india-mapper).
compatibility: Groww MCP (read-only), web_search
---

# Theme-to-Stock Scout

The user hands you a tailwind ("ethanol is booming"). Your job is to find *where the profit
actually accrues* in that tailwind, identify which listed companies are genuinely levered to
it, and rank them — then deliver one best risk-adjusted pick with the alternates and the
catch. The skill that wins here is resisting the obvious name and asking "who actually makes
the money, and is it already in the price?"

**The single most important question this skill answers: is the theme already priced in?**
A booming theme is usually a crowded theme. The best fundamental play can be the worst entry.

## Inputs
- `theme` — the user's thematic thesis, in their words.

## Workflow

### Step 1 — Decompose the value chain
A theme is never one business. Break it into the chain and locate the **profit pool** — the
link that captures margin, not just revenue. Upstream / midstream / downstream / picks-and-
shovels (equipment, EPC) / buyers. Money rarely accrues evenly across the chain.

### Step 2 — Separate pure-plays from passengers
For each link, list the listed names and grade exposure:
- **Pure-play** — the theme is the core business (theme moves → stock moves).
- **Diversified** — theme is one segment; a 5%-of-revenue exposure won't re-rate the stock.
- **Proxy** — benefits indirectly (e.g. a buyer, a financier, a logistics arm).
A "theme stock" with trivial exposure is a trap — name it and drop it.

### Step 3 — Build the candidate set
`web_search` for the listed players per link (Screener.in, Trendlyne, company filings).
Resolve each via Groww `curate_symbols`. Aim for 4–8 real candidates across the chain.

### Step 4 — Screen each candidate
- **Exposure purity** — how much of the business is actually the theme (Step 2 grade).
- **Fundamentals** — Groww `fetch_stocks_fundamental_data` (`view: stats_only`): revenue/
  profit growth, margins, debt, ROE, and *capacity additions* (themes are won by whoever is
  adding capacity into the demand).
- **Valuation** — P/E and P/B vs own history and vs sector. Flag if already at a rich
  percentile — that's the "priced-in" tell.
- **Chart position (multi-timeframe)** — per `_shared/multi-timeframe-protocol.md`. The
  **priced-in check lives on the long windows**: pull 5Y/1Y (weekly/monthly) to see if the
  candidate is already vertical and far off its base — a 3M chart will hide a stock that has
  already tripled on the theme. Then 6M/3M (daily) for the base/setup and 1M/1W for whether
  it's extended right now (RSI 75–78 = crowded entry).

### Step 5 — Rank and pick
Score on a simple frame: **exposure × fundamentals × (valuation headroom) × entry quality.**
The winner is the best *risk-adjusted* play, not the one that's run the most. Name:
- **The pick** + why it wins the chain.
- **2 alternates** (e.g. a cheaper-but-lower-quality option, a safer diversified proxy).
- **The one to avoid** and why (often the crowded favourite).

### Step 6 — The catch (mandatory)
Before delivering, force the priced-in check:
- Has the theme been in headlines for months? Are the pure-plays already at peak valuations?
- If yes → the move may be *late*. Say so. Offer the lower-risk expressions (a diversified
  proxy basing quietly often beats the euphoric pure-play).
Then hand the pick to `stock-thesis-validator` for a full single-name workup, and to
`entry-exit-gate` for the trigger.

## Output template
```
THEME: [user's words]
VALUE CHAIN → PROFIT POOL
  upstream:   [names] — [margin? yes/no]
  midstream:  [names] — ...
  downstream: [names] — ...
  picks & shovels: [names]
  ► Profit accrues at: [the link], because [reason]

SHORTLIST
  [Stock] | exposure: [pure/diversified] | growth: [..] | valn: [cheap/rich] | chart: [base/extended]
  ...

THE PICK: [stock] — [why it wins, 2 lines]
ALTERNATES: [stock] ([why]), [stock] ([why])
AVOID: [stock] — [why]

THE CATCH (priced-in check): [is the theme late? what's already in the price?]
NEXT: run [pick] through stock-thesis-validator, then entry-exit-gate.
```

## Guardrails (enforced)
1. Always map the chain before naming a stock — never jump to the obvious ticker.
2. Grade exposure purity explicitly; kill low-exposure "theme stocks."
3. Run the priced-in check every time. A hot theme with rich valuations = late, say it.
4. Capacity additions matter as much as current numbers — themes reward who's building.
5. No price predictions. Deliver a ranked thesis, not a guarantee.
6. The pick is a *starting candidate*, not a buy order — it must still pass the validator
   and the entry gate before any capital moves.

---

### Worked illustration — "Ethanol manufacturing is booming in India, find the best stock"
- **Chain**: feedstock (sugarcane / surplus grain) → distillery capacity (sugar mills with
  distilleries; dedicated grain-based ethanol producers) → blending demand (oil marketing
  companies as buyers under the EBP / E20 programme) → equipment/EPC (distillery builders).
- **Profit pool**: typically the players with *dedicated, growing distillery capacity* and
  feedstock flexibility — not every sugar mill, and not the OMC buyers (who are price-takers
  on the policy). So the obvious "sugar stock" is often *not* the cleanest play.
- **Exposure grading**: a diversified sugar major where ethanol is 15% of revenue ≠ a
  pure grain-based ethanol producer. Grade and rank accordingly.
- **The catch**: ethanol/EBP has been a known policy story for years — check whether the
  pure-plays are already at peak valuations (priced-in), in which case a quietly-basing
  capacity-adder beats the euphoric favourite.
- **Handoff**: top candidate → stock-thesis-validator for the full workup.
