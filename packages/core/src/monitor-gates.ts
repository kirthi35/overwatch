import type { Monitor, MonitorState, AlertSeverity } from './types.js';

// Pure monitor gate + blind-watchdog logic, ported from the seeded CJS daemon
// (runtime/daemons/lib/monitor-runtime.js + overwatch-monitord.js) into typed TS so
// the multi-tenant worker reuses the SAME semantics. The CLI keeps its seeded JS copy.
// Everything here is pure (no IO) and unit-testable.

export interface WatchdogOpts {
  POLL_MS: number;
  BACKOFF_MS: number;
  MAX_FAILS_WARN: number;
  MAX_FAILS_CRIT: number;
  REALERT_EVERY: number;
  MARKET_OPEN: number; // IST HHMM
  MARKET_CLOSE: number;
  SKIP_WEEKENDS: boolean;
}

export const DEFAULT_WATCHDOG: WatchdogOpts = {
  POLL_MS: 60000,
  BACKOFF_MS: 60000, // worker ticks every 60s; sizes the "~N min blind" estimate
  MAX_FAILS_WARN: 3,
  MAX_FAILS_CRIT: 10,
  REALERT_EVERY: 10,
  MARKET_OPEN: 915,
  MARKET_CLOSE: 1530,
  SKIP_WEEKENDS: true,
};

export interface IstClock {
  num: number; // HHMM
  h: number;
  m: string;
  dow: number; // 0 Sun .. 6 Sat
}

// IST wall clock derived from an absolute ms timestamp (injectable for tests).
export function istClock(ms: number): IstClock {
  const ist = new Date(ms + 5.5 * 3600 * 1000);
  return {
    num: ist.getUTCHours() * 100 + ist.getUTCMinutes(),
    h: ist.getUTCHours(),
    m: String(ist.getUTCMinutes()).padStart(2, '0'),
    dow: ist.getUTCDay(),
  };
}

export function marketOpen(ms: number, O: WatchdogOpts = DEFAULT_WATCHDOG): boolean {
  const c = istClock(ms);
  if (O.SKIP_WEEKENDS && (c.dow === 0 || c.dow === 6)) return false;
  return c.num >= O.MARKET_OPEN && c.num <= O.MARKET_CLOSE;
}

export interface GateFire {
  severity: AlertSeverity;
  terminal: boolean;
  message: string;
}

// Generic gates — identical priority + semantics to the seeded daemon:
// stop_below (terminal) -> zone entry (terminal) -> breakout (heads-up).
export function evaluateGates(monitor: Monitor, ltp: number, ratio: number, green: boolean): GateFire | null {
  const g = monitor.gates || {};
  if (typeof g.stop_below === 'number' && ltp < g.stop_below) {
    return { severity: 'CRITICAL', terminal: true, message: `broke below stop ${g.stop_below} (LTP ${ltp}). Thesis invalidated — stand down.` };
  }
  if (Array.isArray(g.zone)) {
    const [lo, hi] = g.zone;
    const inZone = ltp >= lo && ltp <= hi;
    const greenOK = g.require_green_candle ? green : true;
    const bookOK = typeof g.max_sell_buy_ratio === 'number' ? ratio < g.max_sell_buy_ratio : true;
    if (inZone && greenOK && bookOK) {
      return {
        severity: 'CRITICAL',
        terminal: true,
        message: `ENTRY GATE MET — LTP ${ltp} in zone [${lo}-${hi}], green:${green}, book ${ratio.toFixed(2)}:1. Confirm on daily close, then run the live risk gate before any entry.`,
      };
    }
  }
  if (typeof g.breakout_above === 'number' && ltp > g.breakout_above) {
    return {
      severity: 'WARNING',
      terminal: false,
      message: `reclaimed ${g.breakout_above} (LTP ${ltp}) — breakout heads-up. Lower quality; confirm daily close. Not a confirmed entry.`,
    };
  }
  return null;
}

export interface WatchdogAlert {
  severity: AlertSeverity;
  message: string;
}

export function initMonitorState(): MonitorState {
  return { fired: false, consecutiveFails: 0, blindLevel: null, lastAlertedFail: 0, breakoutAlerted: false };
}

// fail(): fold one failed cycle into state; escalate WARNING -> CRITICAL -> periodic re-alert.
export function fail(state: MonitorState, errMsg: string, O: WatchdogOpts, label: string): { state: MonitorState; alert: WatchdogAlert | null } {
  const s: MonitorState = { ...state };
  s.consecutiveFails = (s.consecutiveFails || 0) + 1;
  s.lastError = errMsg;
  const n = s.consecutiveFails;
  let alert: WatchdogAlert | null = null;

  if (n === O.MAX_FAILS_WARN) {
    alert = { severity: 'WARNING', message: `${label} monitor BLIND — ${n} consecutive MCP failures (${errMsg}). Not evaluating gates. Check Groww backend / token. CHECK THE POSITION MANUALLY IN GROWW.` };
    s.blindLevel = 'WARNING';
    s.lastAlertedFail = n;
  } else if (n === O.MAX_FAILS_CRIT) {
    alert = { severity: 'CRITICAL', message: `${label} monitor STILL BLIND after ${n} failures (~${Math.round((n * O.BACKOFF_MS) / 60000)} min). The monitor CANNOT see price — it will miss stops/triggers. WATCH THIS POSITION YOURSELF IN GROWW NOW.` };
    s.blindLevel = 'CRITICAL';
    s.lastAlertedFail = n;
  } else if (n > O.MAX_FAILS_CRIT && (n - O.MAX_FAILS_CRIT) % O.REALERT_EVERY === 0) {
    alert = { severity: 'CRITICAL', message: `${label} monitor blind for ${n} cycles. Still down (${errMsg}). Manual watch required.` };
    s.lastAlertedFail = n;
  }
  return { state: s, alert };
}

// recover(): a healthy cycle. If we were blind, emit RECOVERED and reset counters.
export function recover(state: MonitorState, O: WatchdogOpts, label: string): { state: MonitorState; alert: WatchdogAlert | null } {
  const s: MonitorState = { ...state };
  let alert: WatchdogAlert | null = null;
  if ((s.consecutiveFails || 0) >= O.MAX_FAILS_WARN && s.blindLevel) {
    alert = { severity: 'INFO', message: `${label} monitor RECOVERED — MCP reachable again after ${s.consecutiveFails} blind cycles.` };
  }
  s.consecutiveFails = 0;
  s.blindLevel = null;
  s.lastAlertedFail = 0;
  s.lastError = null;
  return { state: s, alert };
}
