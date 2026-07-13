// Per-turn intent classifier: market (trading doctrine + Groww) vs general (Composio).
// Keyword-first — zero latency, deterministic, testable. Mirrors the scoring approach
// in auto-loader.ts scoreSkills(). Ties/unknowns default to MARKET: Overwatch is a
// trading assistant first, and a market classification never spins up a Composio session
// needlessly, whereas the reverse would drag the trading persona off its rails.

export type Intent = 'market' | 'general';

// Market/trading vocabulary. Word-boundary matched, case-insensitive.
const MARKET_TERMS = [
  'stock', 'stocks', 'share', 'shares', 'equity', 'equities', 'ticker',
  'nifty', 'sensex', 'banknifty', 'nse', 'bse', 'sebi', 'ipo',
  'market', 'markets', 'index', 'intraday', 'swing', 'trade', 'trading', 'trader',
  'buy', 'sell', 'entry', 'exit', 'stop', 'stoploss', 'target', 'breakout', 'breakdown',
  'portfolio', 'holding', 'holdings', 'position', 'positions', 'pnl',
  'rsi', 'macd', 'atr', 'bollinger', 'supertrend', 'ema', 'sma', 'vwap', 'adx', 'candle',
  'ltp', 'quote', 'depth', 'volume', 'valuation', 'fundamentals', 'earnings',
  'monitor', 'watchlist', 'alert', 'gate', 'regime', 'groww',
  'option', 'options', 'futures', 'fno', 'strike', 'expiry', 'margin',
];

// General-assistant / connected-app vocabulary.
const GENERAL_TERMS = [
  'email', 'emails', 'gmail', 'inbox', 'mail', 'draft', 'reply', 'send',
  'calendar', 'event', 'meeting', 'schedule', 'invite', 'reminder',
  'slack', 'message', 'channel', 'dm',
  'github', 'repo', 'repository', 'issue', 'issues', 'pull', 'pr', 'commit',
  'notion', 'doc', 'docs', 'page', 'database', 'sheet', 'spreadsheet',
  'calendar', 'contact', 'contacts', 'file', 'upload', 'download',
  'code', 'script', 'python', 'compute', 'calculate', 'run', 'execute', 'plot', 'chart',
  'weather', 'news', 'search', 'summarize', 'translate',
];

function countHits(text: string, terms: string[]): number {
  let n = 0;
  for (const t of terms) {
    // word-boundary match; escape not needed (all terms are [a-z]+)
    if (new RegExp(`\\b${t}\\b`, 'i').test(text)) n++;
  }
  return n;
}

/**
 * Classify a raw user prompt. Pure + synchronous (keyword scoring).
 * MARKET wins ties and empties (trading-first default).
 */
export function classifyIntent(prompt: string): Intent {
  const text = String(prompt || '');
  if (!text.trim()) return 'market';
  const market = countHits(text, MARKET_TERMS);
  const general = countHits(text, GENERAL_TERMS);
  return general > market ? 'general' : 'market';
}
