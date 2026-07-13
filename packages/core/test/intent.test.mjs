// Intent classifier: market (trading doctrine + Groww) vs general (Composio).
// The hard persona boundary depends on this — a market prompt must never route to
// the general assistant (loses the trading doctrine) and vice versa.
//
// Run: npm run build -w @overwatch/core && node --test packages/core/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent } from '../dist/intent.js';

test('market prompts classify as market', () => {
  for (const p of [
    'what is the setup on RELIANCE today?',
    'should I buy TCS at the breakout?',
    'check my portfolio holdings',
    'arm a monitor on PARAS below 1200',
    'is the nifty regime bullish?',
    'RSI and MACD on HDFC bank',
    "what's the LTP of Infosys",
  ]) {
    assert.equal(classifyIntent(p), 'market', p);
  }
});

test('general prompts classify as general', () => {
  for (const p of [
    'summarize my unread gmail',
    'send an email to my boss',
    'what is on my calendar tomorrow',
    'create a github issue for this bug',
    'post a message in the slack channel',
    'add a page to my notion database',
    'run this python code to compute the average',
  ]) {
    assert.equal(classifyIntent(p), 'general', p);
  }
});

test('empty / whitespace defaults to market (trading-first)', () => {
  assert.equal(classifyIntent(''), 'market');
  assert.equal(classifyIntent('   '), 'market');
  assert.equal(classifyIntent(undefined), 'market');
});

test('ties default to market', () => {
  // one market term (stop) + one general term (email) -> tie -> market
  assert.equal(classifyIntent('stop the email'), 'market');
});

test('mixed but general-dominant routes general', () => {
  // "email"+"calendar"+"send" (3 general) vs "stock" (1 market)
  assert.equal(classifyIntent('email me a calendar summary and send the stock list'), 'general');
});

test('mixed but market-dominant routes market', () => {
  // "portfolio"+"nifty"+"buy" (3 market) vs "email" (1 general)
  assert.equal(classifyIntent('email me if my portfolio nifty position says buy'), 'market');
});
