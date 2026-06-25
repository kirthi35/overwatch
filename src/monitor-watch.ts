import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { callGroww, growwReady } from './mcp-bridge.js';

// Overwatch — In-Session Monitor Watcher.
//
// WHY: the standalone daemon (monitor-runtime.js) is the right tool for
// UNATTENDED, walk-away monitoring (survives the CLI closing). But for the
// common case — "watch this while I'm in the session" — spawning an OS process
// + managing its PID is overkill. This is the lightweight default: an
// in-process timer that polls armed monitors, evaluates their gates in plain JS
// (NO LLM in the hot loop — idea.md §6), and writes any fire to alerts.log.
//
// COMPOSITION: it does NOT surface anything itself. It writes alerts.log + the
// monitor's state, exactly like the daemon does. The alert-bridge (the other
// extension) watches alerts.log and wakes the LLM to surface+summarize on a
// CRITICAL/fired event. So one surfacing path serves both the in-session
// watcher and the unattended daemon. The LLM is woken only on a real fire.
//
// ARMING: the agent writes a JSON file to ~/.overwatch/monitors/<name>.json
// (see monitor-watch.md). This watcher picks it up on the next tick — no
// restart needed. Set "mode":"daemon" on a monitor to have the watcher SKIP it
// (it's handled by a spawned daemon instead).

const OW = path.join(os.homedir(), '.overwatch');
const MON_DIR = path.join(OW, 'monitors');
const ALERTS = path.join(OW, 'alerts.log');

const DEFAULTS = {
  POLL_MIN: 5,            // tick cadence (minutes) if a monitor doesn't override
  CALL_TIMEOUT_MS: 20000, // hard cap per MCP call
  MARKET_OPEN: 915,       // IST HHMM
  MARKET_CLOSE: 1530,
  MAX_FAILS_WARN: 3,      // consecutive fetch fails before a BLIND warning
};
const TICK_MS = 60000;    // the loop wakes each minute; each monitor polls on its own cadence

function istClock(ms: number) {
  const ist = new Date(ms + 5.5 * 3600 * 1000);
  return { num: ist.getUTCHours() * 100 + ist.getUTCMinutes(), h: ist.getUTCHours(), m: ist.getUTCMinutes(), dow: ist.getUTCDay() };
}
function marketOpen(ms: number): boolean {
  const c = istClock(ms);
  if (c.dow === 0 || c.dow === 6) return false;
  return c.num >= DEFAULTS.MARKET_OPEN && c.num <= DEFAULTS.MARKET_CLOSE;
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const timer = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t)) as Promise<T>;
}

function readJSON(p: string): any { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJSON(p: string, o: any) { try { fs.writeFileSync(p, JSON.stringify(o, null, 2)); } catch { /* best effort */ } }

// Append a line to alerts.log in the SAME format the daemon uses, so the
// alert-bridge and monitorctl parse it identically.
function emit(symbol: string, message: string, severity: string) {
  const line = `[${new Date().toISOString()}] [${severity}] ${symbol} ${message}\n`;
  try { fs.appendFileSync(ALERTS, line); } catch { /* best effort */ }
}

// Evaluate a monitor's gates against fetched data. Returns the fire (if any).
// Gate shape (all optional): stop_below, zone:[lo,hi], require_green_candle,
// max_sell_buy_ratio, breakout_above. Mirrors the daemon thesis gates so the
// two modes behave identically.
interface Fire { severity: string; message: string; terminal: boolean; }
export function evaluateGates(m: any, ltp: number, ratio: number, green: boolean): Fire | null {
  const g = m.gates || {};
  const sym = m.symbol || m.name;

  if (typeof g.stop_below === 'number' && ltp < g.stop_below) {
    return { severity: 'CRITICAL', message: `broke below stop ${g.stop_below} (LTP ${ltp}). Thesis invalidated — stand down.`, terminal: true };
  }
  if (Array.isArray(g.zone)) {
    const [lo, hi] = g.zone;
    const inZone = ltp >= lo && ltp <= hi;
    const greenOK = g.require_green_candle ? green : true;
    const bookOK = typeof g.max_sell_buy_ratio === 'number' ? ratio < g.max_sell_buy_ratio : true;
    if (inZone && greenOK && bookOK) {
      return { severity: 'CRITICAL', message: `ENTRY GATE MET — LTP ${ltp} in zone [${lo}-${hi}], green:${green}, book ${ratio.toFixed(2)}:1. Confirm on daily close, then run the live risk gate before any entry.`, terminal: true };
    }
  }
  if (typeof g.breakout_above === 'number' && ltp > g.breakout_above) {
    return { severity: 'WARNING', message: `reclaimed ${g.breakout_above} (LTP ${ltp}) — breakout heads-up. Lower quality; confirm daily close. Not a confirmed entry.`, terminal: false };
  }
  return null;
}

async function pollOne(file: string) {
  const p = path.join(MON_DIR, file);
  const m = readJSON(p);
  if (!m || m.disabled) return;
  if ((m.mode || 'in-session') === 'daemon') return;     // owned by a spawned daemon
  m.state = m.state || { fired: false, fails: 0, blindAlerted: false, breakoutAlerted: false };
  if (m.state.fired) return;                              // one-shot, already terminal

  // per-monitor cadence
  const pollMs = (m.poll_minutes || DEFAULTS.POLL_MIN) * 60000;
  const nowMs = Date.now();
  if (m.state.lastPoll && nowMs - m.state.lastPoll < pollMs - 1000) return;

  if (!marketOpen(nowMs)) return;
  const clk = istClock(nowMs);
  if (typeof m.time_gate_ist === 'number' && clk.num < m.time_gate_ist) return;

  m.state.lastPoll = nowMs;
  const sym = m.symbol || m.name;

  try {
    const q = await withTimeout(callGroww('get_quotes_and_depth',
      { search_query: m.search_query, segment: m.segment || 'CASH', entity_type: 'Stocks' }), DEFAULTS.CALL_TIMEOUT_MS, 'quotes');
    const d = q.result.quotes_depth[0];
    const ltp = d.ltp;
    const ratio = d.totalBuyQty > 0 ? d.totalSellQty / d.totalBuyQty : 99;

    let green = false;
    if (m.candle_interval) {
      const c = await withTimeout(callGroww('fetch_historical_candle_data',
        { company_name: m.search_query, interval_in_minutes: m.candle_interval, last_n_days: 1, segment: m.segment || 'CASH' }), DEFAULTS.CALL_TIMEOUT_MS, 'candles');
      const candles = c.result.candles;
      const last = candles[candles.length - 1];
      green = !!(last && last.close > last.open);
    }

    // recovered from a blind streak?
    if (m.state.fails >= DEFAULTS.MAX_FAILS_WARN && m.state.blindAlerted) {
      emit(sym, `watcher RECOVERED — data reachable again after ${m.state.fails} blind cycles.`, 'INFO');
    }
    m.state.fails = 0; m.state.blindAlerted = false;
    m.state.lastLtp = ltp; m.state.lastRatio = Number(ratio.toFixed(2)); m.state.lastGreen = green;

    const fire = evaluateGates(m, ltp, ratio, green);
    if (fire) {
      if (fire.terminal) {
        emit(sym, fire.message, fire.severity);
        m.state.fired = true; m.state.confirmedAt = new Date().toISOString();
      } else if (!m.state.breakoutAlerted) {           // non-terminal heads-up: once
        emit(sym, fire.message, fire.severity);
        m.state.breakoutAlerted = true;
      }
    }
    writeJSON(p, m);
  } catch (e: any) {
    m.state.fails = (m.state.fails || 0) + 1;
    if (m.state.fails >= DEFAULTS.MAX_FAILS_WARN && !m.state.blindAlerted) {
      emit(sym, `watcher BLIND — ${m.state.fails} consecutive data failures (${e.message}). Not evaluating gates. CHECK THE POSITION MANUALLY IN GROWW.`, 'WARNING');
      m.state.blindAlerted = true;
    }
    writeJSON(p, m);
  }
}

export function setupMonitorWatch(api: ExtensionAPI) {
  api.on("session_start", async (_event: any, ctx: any) => {
    try { if (!fs.existsSync(MON_DIR)) fs.mkdirSync(MON_DIR, { recursive: true }); } catch {}

    let ticking = false;
    const tick = async () => {
      if (ticking) return;                 // never overlap ticks
      if (!growwReady()) return;           // MCP not connected yet
      ticking = true;
      try {
        let files: string[] = [];
        try { files = fs.readdirSync(MON_DIR).filter(f => f.endsWith('.json')); } catch {}
        for (const f of files) { await pollOne(f); }
      } finally { ticking = false; }
    };

    const timer = setInterval(tick, TICK_MS);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();

    if (ctx && ctx.hasUI && ctx.ui && typeof ctx.ui.notify === 'function') {
      ctx.ui.notify('Overwatch in-session watcher armed — polling armed monitors during market hours.', 'info');
    }
  });
}
