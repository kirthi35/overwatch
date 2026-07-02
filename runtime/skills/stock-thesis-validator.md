---
name: stock-thesis-validator
description: >
  Stress-tests a single named stock against the user's own qualitative thesis and
  returns a structured verdict with exact levels. USE THIS SKILL whenever the user
  names a specific stock and gives any view, hunch, or story about it — e.g. "look at
  E2E Networks, it's the only listed data-center play and doing well", "is BHEL a buy,
  defence order book is loading", "check Tata Power, renewables theme". Trigger even
  when the user only says "analyse X" or "what do you think of X" — they want the thesis
  pressure-tested, not a price prediction. Do NOT use for picking a stock from a theme
  (use theme-to-stock-scout) or for live order-book entry timing (use entry-exit-gate).
compatibility: Groww MCP (read-only), web_search
---

# Stock Thesis Validator

Your job is to be the user's intelligence officer, not their cheerleader. They arrive
with a story ("only listed data-center play, cyclical, doing well in India"). You take
that story apart claim by claim, hold each piece against hard data, and report what
survives. A thesis that survives scrutiny is worth capital. One that doesn't gets killed
here, on paper, before it costs anything.

**You do not predict price. You assess whether the thesis is true, whether it is already
priced in, and where the levels are.** Those are answerable. "Will it go up" is not.

## Inputs

- `symbol` — the stock named by the user (resolve it; see Step 1)
- `thesis` — the user's qualitative claims, in their words. Extract every distinct claim.
  Example claims from "E2E is the only listed data-center play, cyclical, doing well":
  (a) only listed pure-play, (b) cyclical business, (c) currently performing well.

## Workflow

### Step 1 — Resolve and orient
- Resolve the symbol via Groww `curate_symbols` or `get_quotes_and_depth`
  (`entity_type: "Stocks"`, `segment: "CASH"`, full company name in `search_query`).
- Call `resolve_market_time_and_calendar` to know if data is live or last-close.
- Get current LTP so every level you quote later is anchored to where price actually is.

### Step 2 — Classify the archetype FIRST (this sets the entire frame)
Before judging anything, decide what *kind* of stock this is, because the entry framework
differs completely:
- **Cyclical** — earnings swing with a cycle (commodities, capex, rates). Buy near cycle
  trough / cheap valuations, sell into euphoria. High P/E can mean the *bottom*, not the top.
- **Structural growth** — secular demand, re-rates on growth durability. Valuation stays
  rich; you pay up for compounding.
- **Momentum / event** — moving on flows or a catalyst, fundamentals secondary.
- **Value / turnaround** — cheap for a reason; thesis is the reason resolving.

State the archetype and the evidence for it. If the user *claimed* an archetype
("cyclical"), confirm or correct it — that's claim #1 to validate.

### Step 3 — Pull the hard data
- **Fundamentals**: Groww `fetch_stocks_fundamental_data`, `view: stats_only`, targeted
  `stats` array — revenue & profit growth, margins, debt/equity, ROE, P/E, P/B vs sector.
- **Technicals — read TOP-DOWN across timeframes, never a single window.** Follow
  `_shared/multi-timeframe-protocol.md`:
    - **Structure (5Y, 1Y)** — weekly/monthly. This is what *classifies the archetype* (Step 2)
      and exposes whether price is near all-time highs or deep in a base. You cannot see a cycle
      in 3 months.
    - **Swing setup (6M, 3M)** — daily. The tradeable trend, the base, the breakout level, the
      thesis-break line.
    - **Position (1M, 1W)** — daily + intraday. Extended or basing right now (no-chase gate).
  Use the full indicator array `[rsi, macd, supertrend, ema, sma, adx, atr, bollinger]` at each
  layer. Then state the **alignment**: does the swing agree with the structure, or is this a
  counter-trend bounce? That single line changes size, stop, and conviction.
- **Qualitative claims**: `web_search` for anything data can't answer — "is it really the
  only listed pure-play?", "what drives the cycle?", "recent results/guidance/order book".

### Step 4 — Score the thesis, claim by claim
Build a scorecard. For each claim the user made:

| Claim | Evidence found | Verdict |
|-------|----------------|---------|
| (their words) | (what fundamentals/news show) | Confirmed / Partly / Refuted |

Be willing to refute. If "doing well" is true on revenue but margins are compressing, say
"Partly — top-line yes, profitability deteriorating." Precision is the value you add.

### Step 5 — Read price position (the no-chase gate)
Where is price *right now* relative to a base?
- RSI approaching **75–78** or price extended far from EMA/Bollinger upper band → **extended**.
  A great thesis on an extended chart is a *wait*, not a *buy*. Chasing is how edges die.
- Near supertrend support / a defined base with momentum turning → **actionable zone**.
Separate the two questions explicitly: *Is the thesis good?* and *Is the entry good?* They
are independent. The most common error is a true thesis bought at a terrible price.

### Step 6 — Verdict + levels
Combine archetype + thesis score + valuation + price position into one of:
- **ACCUMULATE ZONE** — thesis holds, valuation reasonable for the archetype, price in/near
  a base. Give the entry zone, then hand off to `entry-exit-gate` for the trigger.
- **WAIT FOR PULLBACK** — thesis holds but price is extended. Give the level you'd want.
- **STAND DOWN** — thesis weak, refuted, or valuation already pricing it all in.

## Output template

```
VERDICT: [Accumulate zone / Wait for pullback / Stand down]
ARCHETYPE: [cyclical / structural / momentum / value] — [one-line why]

THESIS SCORECARD
  • [claim] → [evidence] → [Confirmed/Partly/Refuted]
  • ...

TIMEFRAME ALIGNMENT: structure [up/down/range] · swing [up/down] · position [extended/basing] → [ALIGNED/COUNTER-TREND]
PRICE POSITION: [in base / extended] — RSI [x], vs supertrend [above/below], ATR ₹[x]
VALUATION: [cheap/fair/rich] for a [archetype] — [the one metric that matters most]

LEVELS
  Entry zone:      ₹[..]–₹[..]
  Invalidation:    ₹[..]  (thesis is wrong below here)
  ATR stop guide:  ₹[..]  (entry − [k]×ATR; armed as GTT after fill)

KEY RISKS: [the two things most likely to break this]
WHAT WOULD CHANGE THIS CALL: [specific, observable trigger]
```

## Guardrails (enforced, not optional)
1. Classify archetype before any judgment — a cyclical and a growth stock are read inversely.
2. Always separate *thesis quality* from *entry quality*. Never collapse them.
3. Run the no-chase gate. Extended price downgrades any verdict to "wait."
4. Never output a price prediction or a guaranteed outcome. Conditional language only.
5. If Groww data is unavailable, say so — web search gives price/broad technicals but NOT
   ATR or order-book depth, so stop-sizing and the entry gate cannot be fully satisfied.
6. End every run with the one observable thing that would flip the call. A thesis you can't
   falsify isn't analysis, it's faith.

---

### Worked illustration — "E2E Networks, only listed data-center play, cyclical, doing well"
- **Archetype check**: Is it truly *cyclical*, or *structural growth*? Data-center demand
  in India (AI/cloud capex) reads more structural than cyclical — so claim (b) gets
  challenged, and that *changes the buy framework* (you pay up for growth, you don't wait
  for a trough). This single correction is the most valuable output.
- **Claim (a) "only listed pure-play"**: web-verify against comparables — scarcity premium
  is real only if true, and it cuts both ways (scarcity also means rich valuation).
- **Claim (c) "doing well"**: split into revenue growth vs margin vs order pipeline.
- **Price position**: if it's run hard off a spike with RSI hot, verdict caps at WAIT even
  if every claim confirms — consistent with a prior "stand down" read on extended price.
