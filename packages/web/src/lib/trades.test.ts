// Pure-logic tests for the Trades audit tab (ADR 0005).
// Run: node --test --experimental-strip-types packages/web/src/lib/trades.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveStatus, computeAudit, expectancy, type Trade } from './trades.ts';

const T = (o: Partial<Trade>): Trade => ({ id: o.tradeId ?? 'x', ...o } as Trade);

test('effectiveStatus: derives from what the trade HOLDS, not the doc name', () => {
  assert.equal(effectiveStatus(T({ thesis: { why: 'x' } })), 'WATCHING');
  assert.equal(effectiveStatus(T({ card: { stop: 1 } })), 'CARDED');
  // the mis-bucketing fix: a card that already holds a live position is OPEN
  assert.equal(effectiveStatus(T({ card: { stop: 1 }, position: { shares: 10, entry: 100 } })), 'OPEN');
  assert.equal(effectiveStatus(T({ status: 'OPEN', position: { entry: 100 } })), 'OPEN');
  assert.equal(effectiveStatus(T({ close: { exit_price: 90 } })), 'CLOSED');
  assert.equal(effectiveStatus(T({ status: 'CLOSED', close: { exit_date: '2026-07-02' } })), 'CLOSED');
  assert.equal(effectiveStatus(T({ status: 'ABANDONED' })), 'ABANDONED');
});

test('expectancy: null on empty, math on a fixture', () => {
  assert.equal(expectancy([]), null);
  // 2 wins (2,3) avg 2.5, 2 losses (-1,-1) avg 1 -> 0.5*2.5 - 0.5*1 = 0.75
  assert.equal(expectancy([2, 3, -1, -1]), 0.75);
});

test('computeAudit: splits expectancy by adherence; rule-breaks do not indict the doctrine', () => {
  // ETERNAL: closed, adherent, +1R. PARAS/RUBICON: closed rule-breaks, negative.
  const a = computeAudit([
    T({ symbol: 'ETERNAL', status: 'CLOSED', close: { realized_R: 1.0, adherent: true } }),
    T({ symbol: 'PARAS', status: 'CLOSED', gates: { overridden: ['stop floor'] }, close: { realized_R: -0.1, adherent: false } }),
    T({ symbol: 'RUBICON', status: 'CLOSED', gates: { overridden: ['Gate 0'] }, close: { realized_R: -0.9, adherent: false } }),
  ]);
  assert.equal(a.closed, 3);
  assert.equal(a.expAdherent, 1.0); // doctrine, when followed, worked
  assert.ok((a.expRuleBreak as number) < 0); // rule-breaks lost — a discipline problem
  assert.equal(a.overrides, 2);
});

test('computeAudit: no closed / null realized_R -> nulls, never NaN', () => {
  const a = computeAudit([
    T({ symbol: 'WATCH', status: 'WATCHING', thesis: { why: 'x' } }),
    T({ symbol: 'OPENISH', status: 'OPEN', position: { entry: 100, shares: 5 } }),
    T({ symbol: 'NOR', status: 'CLOSED', close: { exit_price: 90, realized_R: null } }),
  ]);
  assert.equal(a.closed, 1); // the CLOSED one counts as closed…
  assert.equal(a.winRate, null); // …but has no R, so expectancy stays null (no NaN)
  assert.equal(a.expAdherent, null);
  assert.ok(!Number.isNaN(a.expAdherent as unknown as number));
});
