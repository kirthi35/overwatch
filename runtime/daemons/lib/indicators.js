// Overwatch — shared indicator fetch (P4.1, enforces the WARM-UP RULE).
//
// WHY THIS EXISTS: short-lookback indicator pulls produce garbage. A 3-week pull
// returned ADX 2.8 and MACD starting at 0.0 for PARAS; the same day produced four
// mutually contradictory MACD histogram readings (-4.33, -0.71, +0.31, -2.62) — the
// correct 3-month-basis value was -5.18. See _shared/multi-timeframe-protocol.md
// § WARM-UP RULE. MACD/ADX/RSI/ATR need >=6 months (>=120 daily candles) of warm-up
// REGARDLESS of the display window.
//
// This is the ONE function every daemon/script must use to fetch indicators. Do NOT
// call get_historical_technical_indicators directly with a shorter start_offset.

const MIN_WARMUP_OFFSET = '6M'; // never fetch indicators over a shorter window
const DAILY = 1440;

// Offsets shorter than the warm-up minimum, promoted to 6M automatically.
const TOO_SHORT = new Set(['1D', '1W', '2W', '3W', '1M', '2M', '3M', '4M', '5M']);

function warmupOffset(requested) {
  if (!requested) return MIN_WARMUP_OFFSET;
  return TOO_SHORT.has(String(requested).toUpperCase()) ? MIN_WARMUP_OFFSET : requested;
}

// fetchIndicators(call, { companyName, indicators, offset, detail })
//   call         : the timeout-wrapped MCP call helper (name, args) => parsedJSON
//   companyName  : full company name for Groww
//   indicators   : array, default the full array
//   offset       : desired start_offset; anything below 6M is promoted to 6M
//   detail       : 'latest' | 'series' (default 'latest')
// Returns { asOf, offsetUsed, latest, series } — `latest` is the last row.
async function fetchIndicators(call, opts) {
  const {
    companyName,
    indicators = ['rsi', 'macd', 'supertrend', 'ema', 'sma', 'adx', 'atr', 'bollinger'],
    offset = MIN_WARMUP_OFFSET,
    detail = 'latest',
  } = opts;
  const start_offset = warmupOffset(offset);
  const result = await call('get_historical_technical_indicators', {
    company_name: companyName,
    interval_in_minutes: DAILY,
    segment: 'CASH',
    indicators,
    start_offset,
    detail,
  });
  const rows = Array.isArray(result) ? result : (result.series || result.data || []);
  const latest = result.latest || (rows.length ? rows[rows.length - 1] : result);
  return { asOf: new Date().toISOString(), offsetUsed: start_offset, latest, series: rows };
}

module.exports = { fetchIndicators, warmupOffset, MIN_WARMUP_OFFSET, DAILY };
