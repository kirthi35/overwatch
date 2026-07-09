// Regression: a per-tool Groww backend/permission error must NOT be promoted to a
// global GROWW_FEED_DOWN / BLIND panic. Only transport/connection failures are blind.
// Root cause it guards: a market-data-scope Groww key returns a backend error on
// account tools (get_equity_portfolio_holdings etc.); the old bridge told the model
// "LIVE MARKET DATA IS UNAVAILABLE … you are BLIND", making it refuse working prices.
//
// Run: npm run build -w @overwatch/core && node --test packages/core/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConnError,
  feedDownResult,
  toolErrorResult,
  makeToolBackendError,
} from '../dist/mcp-bridge.js';

const BACKEND_MSG = 'Some Backend API error happened with this tool call, please try again or try other tools';

test('isConnError: real transport failures are connection errors', () => {
  for (const m of ['fetch failed', 'connection timed out', 'socket hang up', 'ECONNRESET', 'stream closed', 'HTTP 503']) {
    assert.equal(isConnError(m), true, `expected conn error: ${m}`);
  }
});

test('isConnError: a Groww per-tool backend error is NOT a connection error', () => {
  assert.equal(isConnError(BACKEND_MSG), false);
  assert.equal(isConnError('Error executing tool: 2 validation errors ... Field required'), false);
});

test('makeToolBackendError: tags the error and extracts text detail', () => {
  const err = makeToolBackendError('get_equity_portfolio_holdings', [{ type: 'text', text: BACKEND_MSG }]);
  assert.equal(err.toolBackendError, true);
  assert.equal(err.toolErrorDetail, BACKEND_MSG);
  assert.match(err.message, /get_equity_portfolio_holdings/);
});

test('toolErrorResult: account-tool backend error does NOT declare BLIND, adds scope hint', () => {
  const r = toolErrorResult('get_equity_portfolio_holdings', BACKEND_MSG);
  assert.equal(r.details.toolError, true);
  assert.equal(r.details.feedDown, undefined);
  const text = r.content[0].text;
  // must NOT reuse the market-data blind language
  assert.doesNotMatch(text, /BLIND/);
  assert.doesNotMatch(text, /LIVE MARKET DATA IS UNAVAILABLE/);
  assert.doesNotMatch(text, /GROWW_FEED_DOWN/);
  // must carry the actionable account-scope hint
  assert.match(text, /Holdings\/Positions permission scope/);
  assert.match(text, /connection is UP/);
});

test('toolErrorResult: a validation error gets NO scope hint (params problem, not scope)', () => {
  const r = toolErrorResult('get_order_details', 'Error executing tool: Field required [type=missing]');
  const text = r.content[0].text;
  assert.doesNotMatch(text, /permission scope/);
  assert.doesNotMatch(text, /BLIND/);
});

test('toolErrorResult: non-account tool backend error stays non-blind, no scope hint', () => {
  const r = toolErrorResult('get_quotes_and_depth', 'some transient tool fault');
  const text = r.content[0].text;
  assert.equal(r.details.toolError, true);
  assert.doesNotMatch(text, /BLIND/);
  assert.doesNotMatch(text, /permission scope/);
});

test('feedDownResult: transport-blind path unchanged (still declares BLIND)', () => {
  const r = feedDownResult('get_quotes_and_depth', 'fetch failed');
  assert.equal(r.details.feedDown, true);
  const text = r.content[0].text;
  assert.match(text, /GROWW_FEED_DOWN/);
  assert.match(text, /BLIND/);
  assert.match(text, /LIVE MARKET DATA IS UNAVAILABLE/);
});
