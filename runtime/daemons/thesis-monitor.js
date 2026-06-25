// Overwatch thesis monitor — generic, driven by a thesis JSON.
// Usage: THESIS=~/.overwatch/theses/e2e.json GROWW_API_TOKEN=<tok> node thesis-monitor.js
//
// Resilient by construction: all MCP plumbing, timeouts, and the blind-watchdog
// live in lib/monitor-runtime.js. This file is just thesis-specific gates.
// Honours Rule 4: only the daily CLOSE decides validity, so triggers are
// evaluated in the close window (15:15-15:30 IST), but the candle is polled all
// day so the watchdog can warn you MCP is down hours before close.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createMonitor } = require('./lib/monitor-runtime.js');

const thesisPath = (process.env.THESIS || '').replace('~', os.homedir());
if (!thesisPath) { console.error('Set THESIS=path/to/thesis.json'); process.exit(1); }
const thesis = JSON.parse(fs.readFileSync(thesisPath, 'utf8'));
const statePath = path.join(os.homedir(), '.overwatch', 'thesis', `.state_${thesis.symbol}.json`);

function istNum() {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000);
  return t.getUTCHours() * 100 + t.getUTCMinutes();
}
const inCloseWindow = () => { const n = istNum(); return n >= 1515 && n <= 1530; };
const num = (re, s) => { const m = (s || '').match(re); return m ? parseFloat(m[1]) : null; };

const monitor = createMonitor({
  label: thesis.symbol,
  symbol: thesis.symbol,
  statePath,
  opts: { POLL_MS: 60000 },

  // Poll: today's daily candle (only acted on in the close window).
  poll: async (_client, { call }) => {
    const res = await call('fetch_historical_candle_data', {
      company_name: thesis.name, segment: 'CASH', interval_in_minutes: 1440, last_n_days: 2,
    });
    const candles = res.result.candles;
    return { today: candles[candles.length - 1], inClose: inCloseWindow() };
  },

  // Evaluate: invalidation > setup A > setup B. Acts only at the daily close.
  evaluate: ({ today, inClose }, { alert, fire }) => {
    if (!inClose || !today) return;
    const c = today.close;
    const green = today.close >= today.open;
    const T = thesis.triggers;

    const invLvl = T.invalidation && num(/below (\d+\.?\d*)/i, T.invalidation.condition);
    if (invLvl && c < invLvl) {
      alert(`INVALIDATION — daily close ${c} below ${invLvl}. ${T.invalidation.action}`, 'CRITICAL');
      return fire();
    }
    const a = T.setup_A_pullback_buy || T.setup_A_range_support_buy;
    if (a && green && c >= a.zone_low && c <= a.zone_high) {
      alert(`SETUP A — green close ${c} in [${a.zone_low}-${a.zone_high}]. Entry ~${a.entry}, GTT stop ${a.stop}, target ${a.target} (R:R ${a.rr}). Re-check depth before arming.`, 'WARNING');
      return fire();
    }
    const b = T.setup_B_breakout;
    const bLvl = b && num(/above (\d+\.?\d*)/i, b.condition);
    if (bLvl && c > bLvl) {
      alert(`SETUP B — daily close ${c} above ${bLvl}. Breakout. Entry ~${b.entry}, stop ${b.stop}. ${b.note || ''}`, 'WARNING');
      return fire();
    }
  },
});

monitor.start();
