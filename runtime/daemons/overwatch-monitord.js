#!/usr/bin/env node
// Overwatch — the ONE monitor. A single always-on supervisor daemon.
//
// WHY THIS EXISTS: monitoring used to be split in two — an in-process watcher
// (died when the CLI closed) and hand-written per-thesis daemons. The generic
// gate logic (poll -> evaluate -> emit) lived in both, in two languages. This
// daemon collapses the generic case into ONE engine that survives the CLI
// closing. arm_monitor writes ~/.overwatch/monitors/<name>.json and ensures
// this process is up; disarm_monitor deletes a file and this drops it on the
// next tick. Bespoke gates that don't fit the generic schema still use a
// hand-written daemon (monitor-builder.md) — this owns everything else.
//
// LOOP: wake every minute; connect ONE MCP client for the tick; poll each armed
// monitor that's due (its own poll_minutes cadence) during NSE hours; evaluate
// its gates in plain JS; write any fire to alerts.log (+ Telegram). Reuses the
// shared runtime's watchdog brain (fail/recover) so a dead feed escalates
// WARNING -> CRITICAL instead of going silently blind.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { notifyTelegram } = require('./lib/telegram.js');
const {
  istClock, marketOpen, withTimeout, fail, recover, DEFAULTS, GROWW_MCP_URL,
} = require('./lib/monitor-runtime.js');

const OW = path.join(os.homedir(), '.overwatch');
const MON_DIR = path.join(OW, 'monitors');
const ALERTS = path.join(OW, 'alerts.log');
const PIDFILE = path.join(OW, 'monitord.pid');
const GROWW_JSON = path.join(OW, 'groww.json');

const TICK_MS = 60000;                              // wake every minute
// Watchdog cadence: a failed monitor retries next tick (60s), so size the blind
// "~N min" estimate to TICK_MS rather than the lib's per-daemon BACKOFF_MS.
const O = { ...DEFAULTS, BACKOFF_MS: TICK_MS };

// Groww token: env first (inherited when arm_monitor spawns us), then the
// chmod-600 groww.json the CLI writes (so a reboot-launched daemon still works).
function token() {
  const env = process.env.GROWW_API_TOKEN || process.env.GROWW_MCP_TOKEN || process.env.GROWW_TOKEN;
  if (env) return env;
  try { return JSON.parse(fs.readFileSync(GROWW_JSON, 'utf8')).token || ''; } catch { return ''; }
}

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJSON(p, o) { try { fs.writeFileSync(p, JSON.stringify(o, null, 2)); } catch { /* best effort */ } }

// Append to alerts.log in the SAME format the lib uses, so the alert-bridge and
// monitorctl parse it identically. Mirror to Telegram (no-op if unconfigured).
function emit(label, message, severity) {
  const line = `[${new Date().toISOString()}] [${severity}] [${label}] ${message}\n`;
  try { fs.appendFileSync(ALERTS, line); } catch { /* best effort */ }
  console.log(`[ALERT ${severity}][${label}] ${message}`);
  try { notifyTelegram({ label, message, severity }); } catch { /* delivery is best-effort */ }
}

// Generic gates — identical semantics to the retired in-session watcher.
// Priority order: stop_below (terminal) -> zone entry (terminal) -> breakout (heads-up).
function evaluateGates(m, ltp, ratio, green) {
  const g = m.gates || {};
  if (typeof g.stop_below === 'number' && ltp < g.stop_below) {
    return { severity: 'CRITICAL', terminal: true, message: `broke below stop ${g.stop_below} (LTP ${ltp}). Thesis invalidated — stand down.` };
  }
  if (Array.isArray(g.zone)) {
    const [lo, hi] = g.zone;
    const inZone = ltp >= lo && ltp <= hi;
    const greenOK = g.require_green_candle ? green : true;
    const bookOK = typeof g.max_sell_buy_ratio === 'number' ? ratio < g.max_sell_buy_ratio : true;
    if (inZone && greenOK && bookOK) {
      return { severity: 'CRITICAL', terminal: true, message: `ENTRY GATE MET — LTP ${ltp} in zone [${lo}-${hi}], green:${green}, book ${ratio.toFixed(2)}:1. Confirm on daily close, then run the live risk gate before any entry.` };
    }
  }
  if (typeof g.breakout_above === 'number' && ltp > g.breakout_above) {
    return { severity: 'WARNING', terminal: false, message: `reclaimed ${g.breakout_above} (LTP ${ltp}) — breakout heads-up. Lower quality; confirm daily close. Not a confirmed entry.` };
  }
  return null;
}

function initState(m) {
  m.state = m.state || { fired: false, consecutiveFails: 0, blindLevel: null, lastAlertedFail: 0, breakoutAlerted: false };
  return m;
}

// One monitor, one cycle. NEVER throws (folds errors into the blind watchdog).
async function pollOne(call, file) {
  const p = path.join(MON_DIR, file);
  const m = readJSON(p);
  if (!m || m.disabled) return;
  if ((m.mode || 'in-session') === 'daemon') return;   // owned by a bespoke external daemon
  initState(m);
  if (m.state.fired) return;                            // one-shot, already terminal

  // per-monitor cadence (default: every minute)
  const pollMs = (m.poll_minutes || 1) * 60000;
  const nowMs = Date.now();
  if (m.state.lastPoll && nowMs - m.state.lastPoll < pollMs - 1000) return;

  const clk = istClock(nowMs);
  if (typeof m.time_gate_ist === 'number' && clk.num < m.time_gate_ist) return;

  m.state.lastPoll = nowMs;
  const sym = m.symbol || m.name;

  try {
    const q = await call('get_quotes_and_depth', { search_query: m.search_query, segment: m.segment || 'CASH', entity_type: 'Stocks' });
    const d = q.result.quotes_depth[0];
    const ltp = d.ltp;
    const ratio = d.totalBuyQty > 0 ? d.totalSellQty / d.totalBuyQty : 99;

    let green = false;
    if (m.candle_interval) {
      const c = await call('fetch_historical_candle_data', { company_name: m.search_query, interval_in_minutes: m.candle_interval, last_n_days: 1, segment: m.segment || 'CASH' });
      const candles = c.result.candles;
      const last = candles[candles.length - 1];
      green = !!(last && last.close > last.open);
    }

    // Healthy cycle: clear blind state (RECOVERED notice if we were blind).
    const rec = recover(m.state, O, sym);
    m.state = rec.state;
    if (rec.alert) emit(sym, rec.alert.message, rec.alert.severity);

    m.state.lastLtp = ltp; m.state.lastRatio = Number(ratio.toFixed(2)); m.state.lastGreen = green;

    const fire = evaluateGates(m, ltp, ratio, green);
    if (fire) {
      if (fire.terminal) {
        emit(sym, fire.message, fire.severity);
        m.state.fired = true; m.state.confirmedAt = new Date().toISOString();
      } else if (!m.state.breakoutAlerted) {            // non-terminal heads-up: once
        emit(sym, fire.message, fire.severity);
        m.state.breakoutAlerted = true;
      }
    }
    writeJSON(p, m);
  } catch (e) {
    const wd = fail(m.state, e.message, O, sym);
    m.state = wd.state;
    if (wd.alert) emit(sym, wd.alert.message, wd.alert.severity);
    writeJSON(p, m);
  }
}

// A connect-level failure blinds EVERY monitor (pollOne never runs). Fold it
// into each active monitor's watchdog so blindness still escalates — the whole
// point of this daemon (a dead feed must not look like a quiet market).
function foldConnectFail(file, errMsg) {
  const p = path.join(MON_DIR, file);
  const m = readJSON(p);
  if (!m || m.disabled || (m.mode || 'in-session') === 'daemon') return;
  initState(m);
  if (m.state.fired) return;
  const sym = m.symbol || m.name;
  const wd = fail(m.state, errMsg, O, sym);
  m.state = wd.state;
  if (wd.alert) emit(sym, wd.alert.message, wd.alert.severity);
  writeJSON(p, m);
}

async function connect(tok) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const transport = new StreamableHTTPClientTransport(new URL(GROWW_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${tok}` } },
    reconnectionOptions: { initialReconnectionDelay: 1000, maxReconnectionDelay: 30000, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 },
  });
  const client = new Client({ name: 'overwatch-monitord', version: '1.0.0' }, { capabilities: {} });
  await withTimeout(client.connect(transport), O.CALL_TIMEOUT_MS, 'connect');
  return client;
}

let ticking = false;
async function tick() {
  if (ticking) return;                                  // never overlap ticks
  let files = [];
  try { files = fs.readdirSync(MON_DIR).filter((f) => f.endsWith('.json')); } catch { /* dir gone */ }
  if (!files.length) return;                            // nothing armed — idle
  if (!marketOpen(Date.now(), O)) return;               // off-hours / weekend: don't connect

  ticking = true;
  let client;
  try {
    client = await connect(token());
    const call = async (name, args) =>
      JSON.parse((await withTimeout(client.callTool({ name, arguments: args }), O.CALL_TIMEOUT_MS, name)).content[0].text);
    for (const f of files) { await pollOne(call, f); } // re-read dir each tick => live add/remove
  } catch (e) {
    console.error(`[monitord] tick connect failed: ${e.message}`);
    for (const f of files) foldConnectFail(f, e.message);
  } finally {
    if (client) { try { await withTimeout(client.close(), 5000, 'close'); } catch { /* ignore */ } }
    ticking = false;
  }
}

// ---- singleton + lifecycle ------------------------------------------------

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function acquireSingleton() {
  const existing = readJSON(PIDFILE);
  if (existing && existing.pid && existing.pid !== process.pid && alive(existing.pid)) {
    console.error(`[monitord] already running (pid ${existing.pid}); exiting.`);
    process.exit(0);
  }
  writeJSON(PIDFILE, { pid: process.pid, startedAt: new Date().toISOString() });
}

function releaseSingleton() {
  const existing = readJSON(PIDFILE);
  if (existing && existing.pid === process.pid) { try { fs.unlinkSync(PIDFILE); } catch { /* ignore */ } }
}

function main() {
  try { if (!fs.existsSync(MON_DIR)) fs.mkdirSync(MON_DIR, { recursive: true }); } catch { /* ignore */ }
  acquireSingleton();

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { releaseSingleton(); process.exit(0); });
  }
  process.on('exit', releaseSingleton);

  if (!token()) {
    emit('monitord', 'No Groww token (env or ~/.overwatch/groww.json). Cannot poll — arm from the CLI so the token is passed.', 'CRITICAL');
  }
  console.log(`[monitord] up (pid ${process.pid}). Tick ${TICK_MS / 1000}s; polling ~/.overwatch/monitors/*.json during NSE hours.`);

  const timer = setInterval(() => { tick().catch((e) => console.error(`[monitord] tick crashed: ${e.message}`)); }, TICK_MS);
  if (typeof timer.unref === 'function') { /* keep process alive: do NOT unref */ }
  tick().catch((e) => console.error(`[monitord] first tick crashed: ${e.message}`));
}

main();

module.exports = { evaluateGates }; // exported for tests
