// Regression: one feed outage must produce ONE escalating alert stream, not one
// per monitor. The audited outage delivered 30-70 near-duplicate blind CRITICALs
// into a single conversation; foldOutage coalesces the fan-out at the watchdog
// level (same WARN@3 / CRIT@10 / re-alert-every-10 cadence as fail()).
//
// Run: npm run build -w @overwatch/core && node --test packages/core/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldOutage, recover, initMonitorState, DEFAULT_WATCHDOG } from '../dist/monitor-gates.js';

const SYMBOLS = Array.from({ length: 30 }, (_, i) => `SYM${i + 1}`);
const O = DEFAULT_WATCHDOG; // WARN@3, CRIT@10, re-alert every 10

function runOutage(cycles) {
  let state = initMonitorState();
  const alerts = [];
  for (let i = 0; i < cycles; i++) {
    const wd = foldOutage(state, 'fetch failed', O, SYMBOLS);
    state = wd.state;
    if (wd.alert) alerts.push(wd.alert);
  }
  return { state, alerts };
}

test('30-monitor outage: exactly 1 WARNING at fail #3 and 1 CRITICAL at #10', () => {
  const { alerts } = runOutage(10);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].severity, 'WARNING');
  assert.equal(alerts[1].severity, 'CRITICAL');
});

test('coalesced message names the count and the symbols', () => {
  const { alerts } = runOutage(3);
  assert.match(alerts[0].message, /30 monitor\(s\)/);
  assert.match(alerts[0].message, /SYM1, SYM2/);
  assert.match(alerts[0].message, /Groww feed unreachable/);
});

test('CRITICAL message carries the elapsed-minutes estimate and the count', () => {
  const { alerts } = runOutage(10);
  assert.match(alerts[1].message, /~10 min/); // 10 fails x 60s BACKOFF_MS
  assert.match(alerts[1].message, /all 30\s+monitor\(s\) are blind/);
});

test('re-alert cadence: one more CRITICAL every REALERT_EVERY cycles, no spam between', () => {
  const { alerts } = runOutage(30);
  // 3 -> WARNING, 10 -> CRITICAL, 20 -> CRITICAL, 30 -> CRITICAL
  assert.equal(alerts.length, 4);
  assert.deepEqual(alerts.map((a) => a.severity), ['WARNING', 'CRITICAL', 'CRITICAL', 'CRITICAL']);
});

test('recover after a blind outage emits exactly ONE INFO', () => {
  const { state } = runOutage(12);
  const rec = recover(state, O, 'The Groww feed');
  assert.ok(rec.alert);
  assert.equal(rec.alert.severity, 'INFO');
  assert.match(rec.alert.message, /The Groww feed/);
  assert.equal(rec.state.consecutiveFails, 0);
  assert.equal(rec.state.blindLevel, null);
});

test('recover after a short (never-alerted) outage stays silent', () => {
  const { state } = runOutage(2); // below MAX_FAILS_WARN
  const rec = recover(state, O, 'The Groww feed');
  assert.equal(rec.alert, null);
});
