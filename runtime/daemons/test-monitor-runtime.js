// Regression tests for the blind-monitor fix. Plain node, no framework.
//   node ~/.overwatch/daemons/test-monitor-runtime.js
//
// Covers the exact failure that lost the PARAS trade:
//   1. No daemon or skill template may use the dead SSE transport.
//   2. Persistent MCP failure must raise an escalating BLIND alert, not silence.
//   3. The poll loop must survive an MCP outage and reschedule (never die).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const rt = require('./lib/monitor-runtime.js');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok  ${name}`); passed++; })
    .catch((e) => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });
}

// A Wednesday, 11:30 IST (06:00 UTC) — weekday, inside market hours, past gate.
const MARKET_MS = Date.UTC(2026, 5, 24, 6, 0, 0);

async function main() {
  // 1. FLEET SCAN — the root cause. Dead SSE transport must be gone everywhere.
  await test('no SSEClientTransport in any daemon or the skill template', () => {
    const daemonDir = __dirname;
    const skill = path.join(__dirname, '..', 'skills', 'monitor-builder.md');
    const files = fs.readdirSync(daemonDir)
      .filter((f) => f.endsWith('.js') && !f.startsWith('test-'))
      .map((f) => path.join(daemonDir, f));
    files.push(path.join(daemonDir, 'lib', 'monitor-runtime.js'));
    files.push(skill);
    // Match real usage (import or instantiation), not prose that warns against it.
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /require\(['"][^'"]*client\/sse\.js['"]\)|new\s+SSEClientTransport\s*\(/.test(src);
    });
    assert.deepStrictEqual(offenders, [], `dead SSE transport still in: ${offenders.join(', ')}`);
  });

  await test('runtime targets the live /mcp/ StreamableHTTP endpoint', () => {
    assert.strictEqual(rt.GROWW_MCP_URL, 'https://mcp.groww.in/mcp/');
    const src = fs.readFileSync(path.join(os.homedir(), '.overwatch', 'daemons', 'lib', 'monitor-runtime.js'), 'utf8');
    assert.ok(/StreamableHTTPClientTransport/.test(src), 'must use StreamableHTTPClientTransport');
  });

  // 2. WATCHDOG BRAIN — escalation, not silence.
  await test('fail() escalates WARN -> CRITICAL -> periodic re-alert', () => {
    const O = rt.DEFAULTS;
    let s = {};
    const sev = [];
    for (let i = 1; i <= 22; i++) {
      const r = rt.fail(s, 'connect timeout 20000ms', O, 'TEST');
      s = r.state;
      if (r.alert) sev.push([i, r.alert.severity]);
    }
    // WARNING at 3, CRITICAL at 10, then every REALERT_EVERY (10) -> 20.
    assert.deepStrictEqual(sev, [[3, 'WARNING'], [10, 'CRITICAL'], [20, 'CRITICAL']],
      `unexpected alert schedule: ${JSON.stringify(sev)}`);
  });

  await test('no alert before MAX_FAILS_WARN (fails 1 and 2 are silent)', () => {
    let s = {};
    let r = rt.fail(s, 'x', rt.DEFAULTS, 'T'); s = r.state; assert.strictEqual(r.alert, null);
    r = rt.fail(s, 'x', rt.DEFAULTS, 'T'); s = r.state; assert.strictEqual(r.alert, null);
  });

  await test('recover() emits RECOVERED and resets the blind state', () => {
    let s = {};
    for (let i = 0; i < 4; i++) s = rt.fail(s, 'x', rt.DEFAULTS, 'T').state;
    assert.strictEqual(s.blindLevel, 'WARNING');
    const r = rt.recover(s, rt.DEFAULTS, 'T');
    assert.strictEqual(r.alert.severity, 'INFO');
    assert.match(r.alert.message, /RECOVERED/);
    assert.strictEqual(r.state.consecutiveFails, 0);
    assert.strictEqual(r.state.blindLevel, null);
  });

  // 3. INTEGRATION — an MCP outage produces a BLIND alert AND the loop survives.
  await test('outage: BLIND alert written to sink, loop reschedules, never throws', async () => {
    const statePath = path.join(os.tmpdir(), `ow-test-state-${process.pid}.json`);
    try { fs.unlinkSync(statePath); } catch {}
    const sink = [];
    const scheduled = [];
    const monitor = rt.createMonitor({
      label: 'TESTCO',
      statePath,
      token: 'fake-token',
      now: () => MARKET_MS,
      connect: async () => { throw new Error('connect timeout 20000ms'); },
      sink: (line) => sink.push(line),
      schedule: (_fn, ms) => scheduled.push(ms), // capture, don't recurse
    });

    let threw = false;
    for (let i = 0; i < rt.DEFAULTS.MAX_FAILS_WARN; i++) {
      try { await monitor.tick(); } catch { threw = true; }
    }
    assert.strictEqual(threw, false, 'tick() must never throw on MCP failure');
    const blind = sink.filter((l) => /BLIND/.test(l));
    assert.ok(blind.length >= 1, 'expected a BLIND alert in the sink');
    assert.ok(/\[WARNING\]/.test(blind[0]) && /TESTCO/.test(blind[0]), 'alert must be tagged WARNING + label');
    assert.ok(scheduled.length >= rt.DEFAULTS.MAX_FAILS_WARN, 'loop must reschedule after every failed cycle');
    assert.strictEqual(scheduled[scheduled.length - 1], rt.DEFAULTS.BACKOFF_MS, 'failed cycle uses BACKOFF_MS');
    fs.unlinkSync(statePath);
  });

  await test('healthy poll evaluates gates and can fire (one-shot)', async () => {
    const statePath = path.join(os.tmpdir(), `ow-test-ok-${process.pid}.json`);
    try { fs.unlinkSync(statePath); } catch {}
    const sink = [];
    const monitor = rt.createMonitor({
      label: 'OKCO',
      statePath,
      token: 'fake',
      now: () => MARKET_MS,
      connect: async () => ({ close: async () => {} }),
      sink: (l) => sink.push(l),
      schedule: () => {},
      poll: async () => ({ ltp: 100 }),
      evaluate: ({ ltp }, { alert, fire }) => {
        if (ltp < 200) { alert(`OKCO broke ${ltp}`, 'CRITICAL'); return fire(); }
      },
    });
    const r = await monitor.tick();
    assert.strictEqual(r.kind, 'fired');
    assert.ok(sink.some((l) => /\[CRITICAL\].*OKCO broke 100/.test(l)));
    assert.strictEqual(monitor.getState().fired, true);
    fs.unlinkSync(statePath);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
}

main();
