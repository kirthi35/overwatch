# Multi-Timeframe Read Protocol (shared)

Referenced by `stock-thesis-validator` and `theme-to-stock-scout`. Any skill that judges a
chart MUST read it top-down across these windows, never a single timeframe.

## Why (the principle)
A stock is in several trends **at the same time**. It can be in a 5-year uptrend, a 6-month
correction, and a 3-day bounce simultaneously. A level, a signal, or the word "trend" means
nothing until you say *on what timeframe*. Reading one window only is how you:
- misclassify a **cyclical** as a **structural-growth** stock (you cannot see a cycle in 3 months),
- buy a "boom" theme that is already 300% extended off its multi-year base (a 3M chart hides it),
- trade a 3-day bounce thinking it's the trend, straight into the higher-timeframe tide.

Always read **structure → setup → timing**, in that order. Context before the trade.

## The ladder (top-down)

| Layer | Windows | Candle | What it answers | Feeds |
|-------|---------|--------|-----------------|-------|
| **Structure** | 5Y, 1Y | weekly / monthly | Archetype (cyclical / structural / multi-year base / long decline); where in the long cycle; all-time-high proximity; major support & resistance; is a theme already extended | archetype gate, priced-in check |
| **Swing setup** | 6M, 3M | daily | The tradeable trend for a 10–15 day hold; the base; the breakout level; MA / supertrend structure; the entry zone and the **thesis-break line** | entry zone, thesis-break line |
| **Position** | 1M, 1W | daily (+ intraday via entry-exit-gate) | Extended or basing *right now*; RSI, distance from EMA / Bollinger; momentum into the setup | no-chase gate, timing |

## Groww calls
- **Structure (5Y / 1Y)**: `get_historical_technical_indicators` with a weekly or monthly interval
  if supported; otherwise `fetch_historical_candle_data` for weekly/monthly OHLCV, `start_offset`
  `5Y` / `1Y`. If only daily is available, pull daily over the long offset and read the macro trend
  from EMA / supertrend / 200-period MA.
- **Swing (6M / 3M) and Position (1M / 1W)**: `get_historical_technical_indicators`,
  `interval_in_minutes: 1440` (daily), `start_offset` `6M` / `3M` / `1M` / `1W`, full array
  `[rsi, macd, supertrend, ema, sma, adx, atr, bollinger]`. Use `detail: series` where you need the
  *shape* (slopes, where a base formed), `detail: latest` where you only need the current reading.

## The alignment rule (the payoff)
The highest-probability swing is when the **swing trend (daily) agrees with the structure
(weekly / monthly)**.
- **Aligned** — structure up + swing up + price basing → full-conviction setup, normal size.
- **Counter-trend** — structure down while the swing bounces → lower probability; smaller size,
  tighter stop, faster thesis-break. Tradeable, but never confuse it with the dominant trend.

Always state the alignment explicitly in output:
`structure [up / down / range] · swing [up / down] · position [extended / basing] → [ALIGNED / COUNTER-TREND]`
