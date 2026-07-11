// Regression: the model chronically serializes object params as JSON STRINGS
// (fetch_technical_screener's `request` failed "must be object" on EVERY first
// call in the audited conversations, and retries re-sent the identical payload).
// coerceStringifiedArgs runs as prepareArguments (BEFORE TypeBox validation) and
// must parse those strings — and must NEVER swallow a genuinely-bad value.
//
// Run: npm run build -w @overwatch/core && node --test packages/core/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceStringifiedArgs } from '../dist/mcp-bridge.js';

const SCREENER_SCHEMA = {
  type: 'object',
  properties: {
    request: { type: 'object', properties: { filters: { type: 'array' } } },
    limit: { type: 'number' },
  },
};

test('stringified object param is parsed (the fetch_technical_screener bug)', () => {
  const out = coerceStringifiedArgs({ request: '{"filters":[{"rsi":">70"}]}' }, SCREENER_SCHEMA);
  assert.deepEqual(out, { request: { filters: [{ rsi: '>70' }] } });
});

test('stringified array param is parsed', () => {
  const schema = { type: 'object', properties: { symbols: { type: 'array' } } };
  const out = coerceStringifiedArgs({ symbols: '["PARAS","TITAN"]' }, schema);
  assert.deepEqual(out, { symbols: ['PARAS', 'TITAN'] });
});

test('malformed JSON passes through untouched so validation still errors', () => {
  const args = { request: '{filters: not json' };
  const out = coerceStringifiedArgs(args, SCREENER_SCHEMA);
  assert.equal(out, args); // same reference — nothing swallowed
});

test('non-string values are untouched', () => {
  const args = { request: { filters: [] }, limit: 5 };
  const out = coerceStringifiedArgs(args, SCREENER_SCHEMA);
  assert.equal(out, args);
});

test('string param whose schema wants a string is untouched (even if it parses)', () => {
  const schema = { type: 'object', properties: { query: { type: 'string' } } };
  const args = { query: '{"looks":"like json"}' };
  const out = coerceStringifiedArgs(args, schema);
  assert.equal(out, args);
});

test('whole-args-as-string is parsed to an object', () => {
  const out = coerceStringifiedArgs('{"request":{"filters":[]}}', SCREENER_SCHEMA);
  assert.deepEqual(out, { request: { filters: [] } });
});

test('whole-args string that is not JSON passes through untouched', () => {
  const out = coerceStringifiedArgs('give me breakouts', SCREENER_SCHEMA);
  assert.equal(out, 'give me breakouts');
});

test('schema without type info leaves values untouched', () => {
  const args = { request: '{"a":1}' };
  assert.equal(coerceStringifiedArgs(args, { type: 'object', properties: { request: {} } }), args);
  assert.equal(coerceStringifiedArgs(args, undefined), args);
});

test('anyOf schema wanting an object is coerced', () => {
  const schema = { type: 'object', properties: { request: { anyOf: [{ type: 'object' }, { type: 'null' }] } } };
  const out = coerceStringifiedArgs({ request: '{"a":1}' }, schema);
  assert.deepEqual(out, { request: { a: 1 } });
});

test('a JSON string that parses to a primitive is left as the string', () => {
  const out = coerceStringifiedArgs({ request: '42' }, SCREENER_SCHEMA);
  assert.deepEqual(out, { request: '42' }); // "42" parses to a number, not object/array
});
