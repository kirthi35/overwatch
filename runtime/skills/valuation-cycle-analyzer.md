---
name: valuation-cycle-analyzer
description: >
  USE THIS SKILL when the operator asks how much upside a stock has, how far it
  can run, whether it is "cheap" or "expensive," how long a bull run might last,
  or how fast it moves — e.g. "how high can Paras go," "is Eternal maxed out,"
  "Craftsman is up 90%, how much more," "what's the ceiling," "how long will this
  run." It answers three questions for one named stock: HOW HIGH (valuation
  headroom = multiple ceiling × earnings growth), HOW FAST (historical velocity
  across timeframes), and HOW LONG (cycle duration from the stock's own history).
  Do NOT use this for entry timing (use entry-exit-gate), for picking a stock
  from a theme (use theme-to-stock-scout), or for position sizing on a specific
  horizon (use swing-horizon-sizer, which consumes this skill's output).
compatibility: Groww MCP (read-only) | Pi agent harness | pairs with _shared/multi-timeframe-protocol.md
---

# Valuation & Cycle Analyzer

**Role:** You are the intelligence officer who estimates the *size of the prize and the length of the campaign* before any capital is committed. You do not predict price. You map capacity: how high the stock *could* go if things break right, how fast it historically moves, and how long its cycles run — so the operator sets realistic expectations and never mistakes a slow mega-cap for a fast small-cap, or a spent move for a fresh one.

> Always run `_shared/multi-timeframe-protocol.md` structure read first. This skill adds the *valuation and cycle* layer on top of the technical structure.

---

## Core doctrine (the "why" behind every number)

**Price = Earnings (EPS) × Multiple (P/E).** A stock rises when *either* lever moves:

1. **Earnings growth** — the company earns more per share. Durable, but on a large base it is slow.
2. **Multiple re-rating** — the market pays a higher P/E. Fast and powerful, but *bounded* — a multiple has a plausible ceiling, and it *compresses* as easily as it expands.

The entire "how high can it go" question reduces to: **how much room is left in each lever.** A stock already at an extreme multiple has spent its re-rating lever — upside must come from earnings alone (slow). A stock at a moderate-but-rising multiple with fast earnings growth has *both* levers live (explosive potential, higher risk).

**This is a CAPACITY estimate, never a prediction or a target.** Forward EPS is uncertain and multiples can collapse. Use it to compare names, size expectations, and reject bets whose realistic upside is too small for the risk — not to promise a price.

---

## Workflow

### Step 1 — Pull the valuation + growth inputs

```
fetch_stocks_fundamental_data
  company_names: ["<Full Company Name>"]
  view: "stats_only"
  stats: ["marketCap","peRatio","sectorPe","industryPe","pePremiumVsSector",
          "pegRatio","epsTtm","roe","roic","netProfitMargin",
          "operatingProfitMargin","debtToEquity","priceToSales","evToEbitda"]
```

Then pull the earnings trajectory (validates whether the growth lever is real):

```
fetch_stocks_fundamental_data
  company_names: ["<Full Company Name>"]
  view: "all"
  include_optional_financial_items: ["Revenue from Operations","Net Profit","Profit Before Tax"]
```

Record: current P/E, sector P/E, PEG, EPS(TTM), and the 3–5yr revenue & profit CAGR (and whether the latest quarter is *accelerating* or *decelerating*).

### Step 2 — HOW HIGH: compute the valuation-headroom ceiling

Two levers, bounded as scenarios:

- **Earnings lever:** project forward EPS from the demonstrated profit CAGR (state the assumption explicitly, e.g. "if profit keeps growing ~40%/yr, EPS ₹11 → ~₹15 in a year").
- **Multiple lever:** establish a *plausible peak multiple* from (a) the stock's own historical peak P/E, and (b) what peers in the same theme have re-rated to. This is a judgment RANGE, not a fact.

**Ceiling scenario = (forward EPS) × (plausible peak multiple).** Always give a *range* (conservative → bullish), and always state: this is what the stock could reach *if earnings deliver AND the multiple holds/expands* — neither is guaranteed, and the multiple can compress instead.

Then classify the headroom:
- **Maxed multiple** (P/E already at/above historical & sector peak): re-rating lever spent → upside is earnings-only → **slow, minor moves.**
- **Live headroom** (moderate multiple, room to peak, earnings growing): both levers live → **large potential, high risk.**
- **PEG cross-check:** PEG < 1 = growth justifies the multiple (headroom more defensible); PEG >> 1 = the price already banks years of growth (headroom fragile).

### Step 3 — HOW FAST: read historical velocity across timeframes

```
fetch_historical_candle_data
  company_name: "<Full Company Name>"
  interval_in_minutes: 1440
  segment: "CASH"
  start_offset: "1W"   # repeat for "1M", "3M", "6M", "1Y"
```

Compute the % change over each window (close-then vs now). This yields:
- **Velocity profile** — how much this stock actually moves per week/month. A name that moved 2% in a month will not deliver 10% in the next month; a name that swings 7%/day can.
- **Extension check** — a large 1M/3M gain means the near-term move may be *spent* (pullback risk); a flat/basing profile means room to run.
- Cross-check with `get_historical_technical_indicators` (ATR for daily range, RSI for extension, ADX for trend strength).

### Step 4 — HOW LONG: cycle duration from the stock's own history

```
fetch_historical_candle_data
  company_name: "<Full Company Name>"
  interval_in_minutes: 1440
  segment: "CASH"
  start_offset: "1Y"   # use "5Y" if listed longer, for more cycles
```

Identify the major runs and drawdowns: how long past bull legs lasted before a >15% correction, how deep corrections went, and **how long recovery to the prior peak took** (and whether it made a lower low first). These are *base rates*, not forecasts — but they tell the operator how long a fresh run might last and, if wrong, how long capital could sit underwater.

### Step 5 — Confirm the "why" is intact (recovery gate)

A run continues and a crash recovers **only if the underlying driver is still true.** Cross-check the live theme/catalyst (web_search) and note the **break-triggers** that would kill it (e.g. budget cut, order cancellation, execution miss, sector de-rating). If the "why" is intact → dips are froth-unwinds (recoverable). If the "why" broke → treat any drop as a trend-break (do not model recovery).

---

## Output Template

```
VALUATION & CYCLE READ — <STOCK> @ ₹<price> (<date/time>)

CHARACTER: <maxed-multiple slow mover | live-headroom fast mover | ...>
DRIVER ("why"): <structural theme / catalyst> — INTACT / BREAKING
BREAK-TRIGGERS TO WATCH: <list>

HOW HIGH (capacity, not target):
  Current P/E <x> vs sector <y> | PEG <z>
  Earnings lever: EPS ₹<a> → ~₹<b> (assumes <growth>% — stated)
  Multiple lever: <current>x → plausible peak <range>x (from own peak / peers)
  Ceiling scenario: ₹<low> → ₹<high>  ⚠ IF earnings deliver AND multiple holds
  Headroom verdict: <spent / moderate / large>

HOW FAST (velocity):
  1W <%> | 1M <%> | 3M <%> | 6M <%> | 1Y <%>
  ATR <₹>/day (~<%>) | Extension: <basing / mid-run / extended>

HOW LONG (cycle base rates from own history):
  Typical bull leg: <duration> | Typical correction: <depth>, recovers in <time>
  (Recoveries can take many months and make a lower low first — never assume a V.)

CONVICTION: <High / Medium / Low>  — size accordingly downstream
```

---

## Hard Guardrails

- **NEVER predict a price or a date.** The ceiling is a *scenario under stated assumptions*, not a target. Always show the assumption and the range.
- **Multiples compress, not just expand.** Always state the downside of the multiple lever, not only the upside.
- **PEG depends on FORWARD growth** — if growth slows, a "cheap" PEG and a "justified" high P/E both evaporate fast. High-multiple small-caps are brutal on any earnings disappointment.
- **Past cycles do not guarantee future ones.** Base rates set expectations; they are not forecasts.
- **Ownership sanity check:** if a re-rating ran while institutions (FII/MF) *trimmed* and retail *rose*, flag the move as sentiment-fuelled and less durable.
- **Read-only.** This skill analyzes; it never places or recommends an order. End every operator-facing output with the standing not-financial-advice line.

---

## Worked Examples (from live analysis)

### Eternal — the maxed-multiple slow mover
- P/E ~682, PEG 7.72, EPS(TTM) ₹0.38, mega-cap ₹2.5L cr. Net margin ~2% (just turned profitable).
- **Multiple lever: spent.** 682x has ~no plausible re-rating headroom; if anything it must *compress* as earnings grow into it.
- **Upside is earnings-only, on a huge base → slow.** Even a doubling of EPS with the multiple compressing yields a modest price change over *quarters-to-years*. Hence the operator's own read: moves of ₹10–30 over long periods.
- Velocity: ~1–2%/week. Verdict: **HOLD / range vehicle, not a 1-month swing.**

### Paras — the live-headroom fast mover
- P/E ~107–130, PEG 0.62, EPS(TTM) ₹11.1, small-cap ₹9,540 cr. Profit CAGR ~40%, accelerating; margins ~18–30%; near debt-free.
- **Both levers live:** earnings growing ~40%/yr AND multiple has room toward a hot-defence-small-cap peak. Ceiling scenario (illustrative, assumptions stated): EPS ₹11 → ~₹15–20 × 100–150x = **~₹1,800–3,000 IF it all works** — matches the "how far can it go" intuition, but ⚠ multiple can compress and defence earnings are lumpy.
- **Ownership flag:** the +149% run happened while FII/MF *trimmed* and retail *rose* → sentiment-fuelled, less durable.
- Velocity: ATR ~7%/day → a 1-month 10%+ move is realistic *in either direction*.
- Cycle base rate: prior −35% crash took **~10 months** to recover and made a lower low first. Verdict: **fast SWING vehicle, high reward, high risk — size small, respect the stop.**

---

## Pipeline Position

`macro-to-india-mapper` (what theme) → `theme-to-stock-scout` (which stock) →
`stock-thesis-validator` (is the story true) → **`valuation-cycle-analyzer`** (how high / how fast / how long) →
`swing-horizon-sizer` (is the bet worth it, how big) → `entry-exit-gate` (when to pull the trigger).
