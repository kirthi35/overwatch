// Regression: the doctrine rules added after the July 2026 conversation audit
// must stay in the master prompt (both CLI and server variants), and the IST
// clock helpers must label time correctly — the audit caught wrong weekdays,
// "market is closed" during hours, stale polls read as "today", and a GO
// verdict issued on stale data.
//
// Run: npm run build -w @overwatch/core && node --test packages/core/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterPrompt } from '../dist/doctrine.js';
import { relativeAge, formatIst, istNowBanner } from '../dist/time.js';

// ---- master prompt rules (both variants) ----------------------------------

for (const shellTools of [true, false]) {
  const label = shellTools ? 'CLI' : 'server';
  const prompt = buildMasterPrompt({ shellTools });

  test(`master prompt (${label}): fresh-quote GO gate (H1)`, () => {
    assert.match(prompt, /RETURNED SUCCESSFULLY IN THIS SAME TURN/);
    assert.match(prompt, /STAND DOWN \(stale-data\)/);
    assert.match(prompt, /no such thing as a "live risk gate" on stale data/);
  });

  test(`master prompt (${label}): tool-failure disclosure (P1)`, () => {
    assert.match(prompt, /## TOOL FAILURE DISCLOSURE/);
    assert.match(prompt, /NEVER describe a failed write/);
    assert.match(prompt, /say that step was SKIPPED/);
  });

  test(`master prompt (${label}): derived-claims rules (H2 + P3)`, () => {
    assert.match(prompt, /must name the symbol it came\s+from/);
    assert.match(prompt, /NEVER carry a level, low, high, or volume figure/);
    assert.match(prompt, /Never invent multipliers, betas, or correlations/);
  });

  test(`master prompt (${label}): stop-discipline rule (P6)`, () => {
    assert.match(prompt, /A stop, once set, is the stop/);
    assert.match(prompt, /adherence override/);
  });

  test(`master prompt (${label}): privacy & secrets (P7)`, () => {
    assert.match(prompt, /## PRIVACY & SECRETS/);
    assert.match(prompt, /Refuse custody of secrets/);
    assert.match(prompt, /This chat IS stored/);
    assert.match(prompt, /NEVER claim a message "wasn't stored"/);
  });

  test(`master prompt (${label}): monitor-arm echo (P4)`, () => {
    assert.match(prompt, /an alert fires at the ARMED gate, not at the number in\s*\n?your prose/i);
  });
}

// ---- IST clock helpers ------------------------------------------------------

// 2026-07-11 is a Saturday. 08:35 UTC = 14:05 IST.
const FRI_OPEN = Date.parse('2026-07-10T05:00:00Z'); // Friday 10:30 IST — session open
const SAT = Date.parse('2026-07-11T08:35:00Z'); // Saturday 14:05 IST
const FRI_PREOPEN = Date.parse('2026-07-10T03:35:00Z'); // Friday 09:05 IST
const FRI_EVENING = Date.parse('2026-07-10T14:00:00Z'); // Friday 19:30 IST

test('istNowBanner: weekday, date, and OPEN session during Friday market hours', () => {
  const b = istNowBanner(FRI_OPEN);
  assert.match(b, /## CLOCK \(server-verified\)/);
  assert.match(b, /Friday, 10 July 2026, 10:30 IST/);
  assert.match(b, /NSE session: OPEN \(closes 15:30 IST\)/);
  assert.match(b, /holidays are NOT checked/);
  assert.match(b, /Trust THIS clock/);
});

test('istNowBanner: weekend is CLOSED', () => {
  assert.match(istNowBanner(SAT), /Saturday, 11 July 2026/);
  assert.match(istNowBanner(SAT), /CLOSED \(weekend\)/);
});

test('istNowBanner: 09:05 IST is PRE-OPEN, evening is CLOSED', () => {
  assert.match(istNowBanner(FRI_PREOPEN), /PRE-OPEN/);
  assert.match(istNowBanner(FRI_EVENING), /CLOSED \(regular hours/);
});

test('istNowBanner: IST midnight boundary — 20:00 UTC Thursday is 01:30 IST Friday', () => {
  const b = istNowBanner(Date.parse('2026-07-09T20:00:00Z'));
  assert.match(b, /Friday, 10 July 2026, 01:30 IST/);
});

test('relativeAge: minutes, hours, days', () => {
  const now = SAT;
  assert.equal(relativeAge(now - 30 * 1000, now), 'just now');
  assert.equal(relativeAge(now - 5 * 60000, now), '5m ago');
  assert.equal(relativeAge(now - 18 * 3600 * 1000, now), '18h ago');
  assert.equal(relativeAge(now - 2 * 86400 * 1000, now), '2d ago');
  assert.equal(relativeAge('garbage', now), 'unknown age');
});

test('formatIst: yesterday close-of-market poll labels as yesterday with age', () => {
  // Poll at Thu 2026-07-09 15:30 IST (= 10:00 UTC), viewed Fri 09:03 IST (= 03:33 UTC).
  const poll = Date.parse('2026-07-09T10:00:39Z');
  const now = Date.parse('2026-07-10T03:33:00Z');
  const s = formatIst(poll, now);
  assert.match(s, /^2026-07-09 15:30 IST \(yesterday, 17h ago\)$/);
});

test('formatIst: same-IST-day is today even across UTC midnight', () => {
  // 19:30 UTC Jul 9 = 01:00 IST Jul 10; viewed 05:00 UTC Jul 10 = 10:30 IST Jul 10.
  const s = formatIst(Date.parse('2026-07-09T19:30:00Z'), Date.parse('2026-07-10T05:00:00Z'));
  assert.match(s, /^2026-07-10 01:00 IST \(today, 9h ago\)$/);
});
