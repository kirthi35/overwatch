// Pure-logic tests for the Trades tab. Run with Node's built-in test runner + type
// stripping (Node 22.7+/25): node --test --experimental-strip-types packages/web/src/lib/trades.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlateTrades, computeExpectancy, baseSymbol } from './trades.ts';

test('baseSymbol: strips suffixes and honors symbol field', () => {
  assert.equal(baseSymbol({ id: 'paras' }), 'PARAS');
  assert.equal(baseSymbol({ id: 'paras-card' }), 'PARAS');
  assert.equal(baseSymbol({ id: 'paras-active-position' }), 'PARAS');
  assert.equal(baseSymbol({ id: 'x123', symbol: 'rubicon' }), 'RUBICON');
});

test('correlateTrades: one live trade per symbol, bucketed by highest stage', () => {
  const live = correlateTrades([
    { id: 'paras' },
    { id: 'paras-card' },
    { id: 'paras-active-position' },
    { id: 'apollo' },
    { id: 'e2e-card' },
  ]);
  const bySym = Object.fromEntries(live.map((t) => [t.symbol, t]));
  assert.equal(bySym['PARAS'].status, 'OPEN'); // has active-position
  assert.ok(bySym['PARAS'].card && bySym['PARAS'].thesis && bySym['PARAS'].position);
  assert.equal(bySym['APOLLO'].status, 'WATCHING'); // thesis only
  assert.equal(bySym['E2E'].status, 'CARDED'); // card, no position
  assert.equal(live.length, 3);
});

test('correlateTrades: OPEN sorts before CARDED before WATCHING', () => {
  const live = correlateTrades([{ id: 'aaa' }, { id: 'bbb-card' }, { id: 'ccc-active-position' }]);
  assert.deepEqual(live.map((t) => t.status), ['OPEN', 'CARDED', 'WATCHING']);
});

test('computeExpectancy: skips null realized_R (backfill/OPEN rows) — no NaN', () => {
  // ETERNAL closed (+1.0R), PARAS + RUBICON open (realized_R null) — the exact backfill shape.
  const e = computeExpectancy([
    { id: '1', symbol: 'ETERNAL', realized_R: 1.0, status: 'CLOSED' },
    { id: '2', symbol: 'PARAS', realized_R: null, status: 'OPEN', gates_overridden: ['R:R floor'] },
    { id: '3', symbol: 'RUBICON', realized_R: null, status: 'OPEN', gates_overridden: ['Gate 0'] },
  ]);
  assert.equal(e.closedCount, 1);
  assert.equal(e.wins, 1);
  assert.equal(e.expectancy, 1.0);
  assert.ok(Number.isFinite(e.expectancy as number), 'expectancy must not be NaN');
  assert.equal(e.overrides, 2); // both open rows carry overridden gates
});

test('computeExpectancy: zero closed trades -> nulls, never divide-by-zero', () => {
  const e = computeExpectancy([{ id: '1', symbol: 'X', realized_R: null }]);
  assert.equal(e.closedCount, 0);
  assert.equal(e.winRate, null);
  assert.equal(e.expectancy, null);
});

test('computeExpectancy: win/loss math on a fixture', () => {
  const e = computeExpectancy([
    { id: '1', symbol: 'A', realized_R: 2 },
    { id: '2', symbol: 'B', realized_R: 3 },
    { id: '3', symbol: 'C', realized_R: -1 },
    { id: '4', symbol: 'D', realized_R: -1 },
  ]);
  assert.equal(e.closedCount, 4);
  assert.equal(e.wins, 2);
  assert.equal(e.losses, 2);
  assert.equal(e.winRate, 0.5);
  assert.equal(e.avgWinR, 2.5);
  assert.equal(e.avgLossR, 1);
  // 0.5*2.5 - 0.5*1 = 0.75
  assert.equal(e.expectancy, 0.75);
});
