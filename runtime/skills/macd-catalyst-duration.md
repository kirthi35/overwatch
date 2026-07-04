# MACD-Catalyst Duration Framework

> **STAGE:** Analytical overlay — applicable after thesis validation (Stage 3) and
> alongside swing-horizon sizing (Stage 5). Predicts HOW LONG a momentum run
> will last by combining catalyst classification + ADX trend strength + MACD
> histogram cross history.
>
> **DO NOT USE AS STANDALONE.** MACD alone is noise. This framework only works
> when combined with a verified fundamental catalyst.
>
> **HORIZON MATCH: this framework predicts multi-week run durations. It may only gate trades whose holding window is ≥ the lower bound of the predicted run. It must NOT be used to justify a ≤5-day trade (verified misuse: 2026-07-02).**

---

## THE CORE PROBLEM

Standard MACD analysis says "histogram crossed positive → buy." This gets
traders whipsawed: the cross lasts 3-5 days and reverses. The problem is that
MACD measures momentum WITHOUT context — it doesn't know WHY the price is
moving, or whether the trend is strong enough to sustain the cross.

## THE 3-FACTOR MODEL

```
DURATION = f(CATALYST TIER × ADX STRENGTH × HISTORICAL MACD PATTERN)
```

### FACTOR 1: CATALYST STRENGTH (Fundamental)

| Tier | Description | Examples | Duration Impact |
|------|-------------|----------|-----------------|
| **Tier 1 — Driving** | Structural change in earnings expectations | Earnings beat/miss, policy shift (PLI, FDI), sector re-rating | Long runs (20-30+ days) |
| **Tier 2 — Supporting** | Confirms existing thesis but doesn't independently drive | Order win, management change, product launch | Moderate runs (10-20 days), provides floor |
| **Tier 3 — Potential** | Not yet materialized | Media re-amplification, upcoming events, rumors | Short runs (3-8 days) or whipsaw |

**Rule:** If there is NO catalyst, STOP. MACD alone is noise. Don't use this
framework. A MACD cross without a fundamental reason is speculation.

### FACTOR 2: TREND STRENGTH (ADX)

ADX measures trend STRENGTH, not trend FRESHNESS. The table below applies ONLY when ADX is RISING or flat. If ADX is HIGH but DECLINING from a recent extreme (e.g., 63 falling from 72), the trend is MATURE — treat as late-stage: halve the predicted duration and flag reversal risk. Always report ADX level AND 5-day slope.

| ADX Range | Interpretation | Expected MACD Cross Duration |
|-----------|---------------|---------------------------|
| ADX < 20 | No trend — MACD oscillates randomly | 3-7 days max (whipsaw zone) |
| ADX 20-30 | Weak trend — fragile momentum | 7-15 days |
| ADX 30-40 | Strong trend — genuine momentum | 15-25 days |
| ADX > 40 | Institutional trend — multi-week run | 25-40 days |

**Rule:** ADX < 25 + MACD cross = high whipsaw risk. Require ADX > 30 for any
duration prediction beyond 2 weeks.

### FACTOR 3: HISTORICAL MACD PATTERN (Stock-Specific Calibration)

Every stock has a "MACD personality" — some naturally have long MACD runs,
others whipsaw constantly. You MUST calibrate per stock.

**Calibration protocol:**
1. Pull 2-3 years of daily MACD histogram series
2. Identify every zero-line cross (negative→positive and positive→negative)
3. For each positive period, measure:
   - Duration (days histogram stayed positive)
   - ADX at the time of cross
   - Price change during the positive period
   - What catalyst (if any) was present
4. Classify each cross:
   - **LONG RUN** (≥15 days): What conditions were present?
   - **WHIPSAW** (<8 days): What conditions were present?
5. Build the stock's profile:
   - Average positive-run duration
   - Long-run rate (% of crosses that became long runs)
   - Whipsaw rate (% of crosses that were whipsaws)
   - ADX threshold that separates long runs from whipsaws

MINIMUM SAMPLE: a per-stock MACD personality requires ≥10 zero-line crosses over ≥2 years. Below that, output 'INSUFFICIENT HISTORY — no duration prediction.' Whipsaw P&L math must include costs (brokerage + STT + slippage ≈ 0.3–0.5% round trip); a 0% gross whipsaw is a net loss.

**Rule:** The day counts DON'T generalize between stocks. A large-cap like
Reliance might have 45-day MACD runs as baseline; a small-cap might max out at
8 days. Calibrate per stock, then apply the framework.

---

## THE DECISION TREE

```
Step 1: IS THERE A REAL CATALYST?
├── NO → STOP. Don't use this framework. MACD alone is noise.
├── YES → Classify:
│   ├── Tier 1 (earnings, policy, structural) → proceed
│   ├── Tier 2 (order win, sector tailwind) → proceed with caution
│   └── Tier 3 (hype, rumor) → STOP. High whipsaw risk.

Step 2: WHAT'S THE ADX?
├── ADX < 20 → Whipsaw zone. Expected run: 3-7 days.
├── ADX 20-30 → Weak trend. Expected: 7-15 days.
├── ADX 30-40 → Strong trend. Expected: 15-25 days.
├── ADX > 40 → Institutional trend. Expected: 25-40 days.

Step 3: WHAT'S THE MACD HISTOGRAM DOING?
├── Positive AND expanding → RUN IN PROGRESS
│   → Estimate remaining days = historical avg − days since cross
├── Just crossing zero → EARLY STAGE
│   → Will it sustain or whipsaw? Check ADX + catalyst tier.
├── Negative but approaching zero → PENDING
│   → Market hasn't accepted catalyst yet. Wait for cross.
├── Negative and expanding → NO RUN
│   → Catalyst rejected. Don't apply this framework.

Step 4: CALIBRATE AGAINST HISTORY
├── Look up the stock's MACD personality profile
├── Compare current ADX vs historical ADX at long-run crosses
├── Compare current ADX vs historical ADX at whipsaw crosses
├── If current ADX > historical long-run ADX → higher confidence in long run
├── If current ADX < historical whipsaw ADX → expect whipsaw

Step 5: COMBINE FOR PREDICTION
┌──────────────────────────────────────────────────────────────────────┐
│  CATALYST TIER  ×  ADX STRENGTH  ×  HISTORICAL PATTERN  =  DURATION  │
│                                                                       │
│  Tier 1 + ADX>40 + history of 25-30d crosses  →  25-30 days          │
│  Tier 1 + ADX 30 + history of 15-20d crosses  →  15-20 days          │
│  Tier 2 + ADX>40 + history of 25-30d crosses  →  15-20 days          │
│  Tier 2 + ADX 30 + history of 15-20d crosses  →  8-12 days           │
│  Tier 1 + ADX<25 + any history               →  5-8 days (whipsaw)  │
│  Any tier + ADX<20 + any history              →  3-7 days (whipsaw) │
└──────────────────────────────────────────────────────────────────────┘
```

---

## WHERE IT WORKS ✅

| Scenario | Why |
|----------|-----|
| Earnings-driven momentum | Quarterly results are the most common, most reliable catalyst |
| Policy/government catalyst | Structural shifts create sustained trends (defence, infra, PLI) |
| Sector rotation | When a sector moves, individual MACD crosses are more reliable |
| Mid/large-cap with liquidity | MACD needs real volume; liquid stocks have less noise |

## WHERE IT BREAKS ❌

| Scenario | Why |
|----------|-----|
| No catalyst, pure technical move | MACD cross on no news = speculation, not acceptance |
| Low-volume / illiquid stocks | MACD from thin/manipulated price is noise |
| Market-wide crashes | All stocks fall together; stock-specific MACD is irrelevant |
| Trading range / consolidation | MACD crosses back and forth every few days with no meaning |
| One-off event, no follow-through | Single news item, cross runs 3-5 days, then dies |

---

## INTEGRATION WITH DOCTRINE PIPELINE

This framework sits as an overlay across multiple stages:

```
STAGE 3 (thesis-validator) → identifies the catalyst → classifies its tier
STAGE 4 (valuation-cycle) → "how high" includes "how long" via this framework
STAGE 5 (swing-horizon-sizer) → uses predicted duration to size the holding period
STAGE 6 (entry-exit-gate) → MACD cross confirmation is a Tier 1 entry signal

OUTPUT: "Expected momentum run: X-Y days" → feeds directly into holding-period decision
```

## CALIBRATION TOOL

Automated calibration: `~/.overwatch/tools/macd-calibrator.js`

```bash
node ~/.overwatch/tools/macd-calibrator.js "E2E Networks" "Eternal" "BSE"
```

Pulls 3Y daily MACD + ADX + RSI, identifies all histogram crosses, measures
durations, records ADX at each cross, outputs the MACD personality profile
with current assessment and duration prediction.

## CASE STUDY

CASE STUDY: pending — to be re-run per the calibration protocol (≥2 years, warm-up rule) via the calibrator tool.