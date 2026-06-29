// Overwatch — shared resilient monitor runtime.
//
// WHY THIS EXISTS: the original daemons used SSEClientTransport against
// mcp.groww.in/mcp. Groww retired that SSE endpoint (returns
// "terminated: other side closed"), so monitors connected to a dead path,
// had no connect timeout, logged failures only to stdout, and had no
// heartbeat. Result: a monitor went silently blind at 09:35 and missed a
// stop-loss break. See alerts.log + daemons/paras.out.
//
// This module is the ONE place that talks to Groww MCP for monitors. Every
// daemon is now thin config + an evaluate() callback on top of it. The loop:
//   - uses the StreamableHTTP transport against /mcp/ (the live path)
//   - hard-caps every MCP call with a timeout (no infinite hangs)
//   - NEVER dies on error — it always reschedules
//   - runs an ESCALATING watchdog: WARNING when first blind, CRITICAL if
//     blindness persists, periodic re-alerts so it can't be a single buried
//     line. All watchdog alerts go to alerts.log (what the user watches),
//     not stdout.
//
// All IO (connect / clock / log sink / scheduler) is injectable so the
// watchdog brain can be unit-tested without a network or a real clock.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { notifyTelegram } = require('./telegram.js');

const OW_DIR = path.join(os.homedir(), '.overwatch');
const DEFAULT_LOG = path.join(OW_DIR, 'alerts.log');
const GROWW_MCP_URL = 'https://mcp.groww.in/mcp/'; // trailing slash: /mcp 307-redirects here

const DEFAULTS = {
  POLL_MS: 60000,           // healthy cadence
  BACKOFF_MS: 15000,        // wait after a failed cycle before retry
  CALL_TIMEOUT_MS: 20000,   // hard cap per MCP call (connect / tool / close)
  MAX_FAILS_WARN: 3,        // consecutive fails before first BLIND warning
  MAX_FAILS_CRIT: 10,       // consecutive fails before escalating to CRITICAL
  REALERT_EVERY: 10,        // after CRITICAL, re-alert every N more fails
  MARKET_OPEN: 915,         // IST HHMM
  MARKET_CLOSE: 1530,
  TIME_GATE: 0,             // don't evaluate before this IST HHMM (skip open noise)
  SKIP_WEEKENDS: true,
};

function nowISO(ms) { return new Date(ms).toISOString(); }

// IST wall clock derived from an absolute ms timestamp (injectable for tests).
function istClock(ms) {
  const ist = new Date(ms + 5.5 * 3600 * 1000);
  return {
    num: ist.getUTCHours() * 100 + ist.getUTCMinutes(),
    h: ist.getUTCHours(),
    m: String(ist.getUTCMinutes()).padStart(2, '0'),
    dow: ist.getUTCDay(), // 0 Sun .. 6 Sat
  };
}

function marketOpen(ms, O) {
  const c = istClock(ms);
  if (O.SKIP_WEEKENDS && (c.dow === 0 || c.dow === 6)) return false;
  return c.num >= O.MARKET_OPEN && c.num <= O.MARKET_CLOSE;
}

// Race a promise against a timer so a hung MCP call can't freeze the loop.
function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// ---- WATCHDOG BRAIN (pure, unit-tested) ----------------------------------
//
// fail(): fold one failed cycle into state, deciding whether to emit an alert
// and at what severity. Escalates instead of going quiet:
//   fail #MAX_FAILS_WARN          -> WARNING (first blind)
//   fail #MAX_FAILS_CRIT          -> CRITICAL (persistent blind)
//   every REALERT_EVERY after that-> CRITICAL re-ping (don't let it rot)
// Returns { state, alert } where alert is { severity, message } | null.

function fail(state, errMsg, O, label) {
  const s = { ...state };
  s.consecutiveFails = (s.consecutiveFails || 0) + 1;
  s.lastError = errMsg;
  const n = s.consecutiveFails;
  let alert = null;

  if (n === O.MAX_FAILS_WARN) {
    alert = {
      severity: 'WARNING',
      message: `${label} monitor BLIND — ${n} consecutive MCP failures (${errMsg}). Not evaluating gates. Check Groww backend / token. CHECK THE POSITION MANUALLY IN GROWW.`,
    };
    s.blindLevel = 'WARNING';
    s.lastAlertedFail = n;
  } else if (n === O.MAX_FAILS_CRIT) {
    alert = {
      severity: 'CRITICAL',
      message: `${label} monitor STILL BLIND after ${n} failures (~${Math.round((n * O.BACKOFF_MS) / 60000)} min). The monitor CANNOT see price — it will miss stops/triggers. WATCH THIS POSITION YOURSELF IN GROWW NOW.`,
    };
    s.blindLevel = 'CRITICAL';
    s.lastAlertedFail = n;
  } else if (n > O.MAX_FAILS_CRIT && (n - O.MAX_FAILS_CRIT) % O.REALERT_EVERY === 0) {
    alert = {
      severity: 'CRITICAL',
      message: `${label} monitor blind for ${n} cycles. Still down (${errMsg}). Manual watch required.`,
    };
    s.lastAlertedFail = n;
  }
  return { state: s, alert };
}

// recover(): a healthy cycle. If we were blind, emit a RECOVERED notice and
// reset the failure counters. Returns { state, alert }.
function recover(state, O, label) {
  const s = { ...state };
  let alert = null;
  if ((s.consecutiveFails || 0) >= O.MAX_FAILS_WARN && s.blindLevel) {
    alert = {
      severity: 'INFO',
      message: `${label} monitor RECOVERED — MCP reachable again after ${s.consecutiveFails} blind cycles.`,
    };
  }
  s.consecutiveFails = 0;
  s.blindLevel = null;
  s.lastAlertedFail = 0;
  s.lastError = null;
  return { state: s, alert };
}

// ---- DEFAULT IO (overridable) --------------------------------------------

async function defaultConnect(token, O) {
  // Lazy require so the pure watchdog tests don't need the SDK installed.
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const transport = new StreamableHTTPClientTransport(new URL(GROWW_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    // The optional server->client SSE notification stream idle-drops on Groww
    // and the SDK's default reconnect loops forever. Tool calls use the POST
    // path and don't need it, so disable reconnection.
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 0,
    },
  });
  const client = new Client({ name: 'overwatch-monitor', version: '1.0.0' }, { capabilities: {} });
  await withTimeout(client.connect(transport), O.CALL_TIMEOUT_MS, 'connect');
  return client;
}

// ---- MONITOR FACTORY ------------------------------------------------------
//
// createMonitor(cfg) returns { start, tick, getState }.
//   cfg.label     : short name for alerts (e.g. "PARAS")
//   cfg.statePath : where to persist {fired, consecutiveFails, ...}
//   cfg.poll      : async (client, helpers) => data   helpers: { call, withTimeout }
//                   `call(name, args)` = timeout-wrapped client.callTool, returns
//                   the parsed first-text-content JSON.
//   cfg.evaluate  : (data, helpers) => boolean|void   helpers: { alert(msg,sev), fire() }
//                   return true (or call fire()) to stop the monitor (one-shot).
//   cfg.opts      : overrides for DEFAULTS
//   cfg.token     : Groww token (defaults to env)
//   Injectables (tests): connect, now, sink, schedule, logPath
function createMonitor(cfg) {
  const O = { ...DEFAULTS, ...(cfg.opts || {}) };
  const label = cfg.label || cfg.symbol || 'MONITOR';
  const logPath = cfg.logPath || DEFAULT_LOG;
  const token = cfg.token || process.env.GROWW_MCP_TOKEN || process.env.GROWW_API_TOKEN || process.env.GROWW_TOKEN || '';
  const now = cfg.now || (() => Date.now());
  const schedule = cfg.schedule || ((fn, ms) => setTimeout(fn, ms));
  const connect = cfg.connect || ((tok) => defaultConnect(tok, O));
  const sink = cfg.sink || ((line) => fs.appendFileSync(logPath, line));

  function loadState() {
    try { return JSON.parse(fs.readFileSync(cfg.statePath, 'utf8')); }
    catch { return { fired: false, consecutiveFails: 0, blindLevel: null, lastAlertedFail: 0 }; }
  }
  function saveState(s) {
    try { fs.writeFileSync(cfg.statePath, JSON.stringify(s, null, 2)); } catch {}
  }

  // Emit an alert line to the user's alerts.log (and echo to stdout).
  function emit(message, severity, ms) {
    const line = `[${nowISO(ms)}] [${severity}] [${label}] ${message}\n`;
    sink(line);
    console.log(`[ALERT ${severity}][${label}] ${message}`);
    // Walk-away delivery: push to Telegram (no-op if unconfigured; severity-gated
    // there). Fire-and-forget — must never block or crash the poll loop.
    try { notifyTelegram({ label, message, severity }); } catch { /* delivery is best-effort */ }
  }

  // Parse the first text content block of an MCP tool result as JSON.
  function parse(result) {
    return JSON.parse(result.content[0].text);
  }

  // One cycle. Returns a result descriptor (handy for tests). NEVER throws.
  async function tick() {
    const ms = now();
    let state = loadState();
    if (state.fired) return { kind: 'done' };

    if (!marketOpen(ms, O)) { schedule(tick, O.POLL_MS); return { kind: 'closed' }; }
    const clk = istClock(ms);
    if (clk.num < O.TIME_GATE) {
      console.log(`[${clk.h}:${clk.m}] ${label} pre-gate (waiting ${O.TIME_GATE} IST).`);
      schedule(tick, O.POLL_MS);
      return { kind: 'pregate' };
    }

    let client;
    try {
      client = await connect(token);
      const call = async (name, args) =>
        parse(await withTimeout(client.callTool({ name, arguments: args }), O.CALL_TIMEOUT_MS, name));
      const data = await cfg.poll(client, { call, withTimeout });

      // Healthy cycle: clear blind state (with RECOVERED notice if we were blind).
      const rec = recover(state, O, label);
      state = rec.state;
      if (rec.alert) emit(rec.alert.message, rec.alert.severity, ms);

      // Run the thesis gates.
      let fired = false;
      const helpers = {
        alert: (msg, sev) => emit(msg, sev || 'WARNING', ms),
        fire: () => { fired = true; },
      };
      const r = cfg.evaluate(data, helpers);
      if (r === true) fired = true;

      if (fired) {
        state.fired = true;
        state.confirmedAt = nowISO(ms);
        saveState(state);
        return { kind: 'fired' };
      }
      saveState(state);
      schedule(tick, O.POLL_MS);
      return { kind: 'ok', data };
    } catch (e) {
      const wd = fail(state, e.message, O, label);
      state = wd.state;
      console.error(`[${clk.h}:${clk.m}] ${label} poll fail #${state.consecutiveFails}: ${e.message}`);
      if (wd.alert) emit(wd.alert.message, wd.alert.severity, ms);
      saveState(state);
      schedule(tick, O.BACKOFF_MS);
      return { kind: 'fail', error: e.message, blindLevel: state.blindLevel, fails: state.consecutiveFails };
    } finally {
      if (client) { try { await withTimeout(client.close(), 5000, 'close'); } catch {} }
    }
  }

  function start() {
    if (!token) {
      emit('No Groww token in env (GROWW_API_TOKEN / GROWW_MCP_TOKEN / GROWW_TOKEN). Monitor cannot start.', 'CRITICAL', now());
      return;
    }
    emit(`Monitor armed (resilient runtime). Poll ${O.POLL_MS / 1000}s, timeout ${O.CALL_TIMEOUT_MS / 1000}s, watchdog WARN@${O.MAX_FAILS_WARN}/CRIT@${O.MAX_FAILS_CRIT}.`, 'INFO', now());
    tick().catch((e) => {
      // tick() is designed never to throw; this is a last-resort net so the
      // process logs instead of dying silently.
      emit(`Monitor loop crashed unexpectedly: ${e.message}. Restart required.`, 'CRITICAL', now());
    });
  }

  return { start, tick, getState: loadState };
}

module.exports = {
  createMonitor,
  // exported for tests
  fail,
  recover,
  istClock,
  marketOpen,
  withTimeout,
  DEFAULTS,
  GROWW_MCP_URL,
};
