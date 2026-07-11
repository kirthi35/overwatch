// Regression: local WRITE tools must FAIL LOUD. The audit caught the model telling
// a user "the monitor is live and tracking your position" after upsert_trade had
// failed 3x — because failures were returned as normal-looking tool results. Pi
// flags a result as an error ONLY when execute THROWS, so every write-tool failure
// must throw with an unmissable "NOTHING WAS SAVED"-style message.
//
// Run: npm run build -w @overwatch/core && node --test packages/core/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCustomTools } from '../dist/custom-tools.js';

// Minimal fake ExtensionAPI: capture registered tools by name.
function makeApi() {
  const tools = new Map();
  return { tools, registerTool: (t) => tools.set(t.name, t), on: () => {} };
}

// Store whose writes reject — simulates the Firestore failure from the audit.
const REJECTING_STORE = {
  putMonitor: async () => { throw new Error('firestore write denied'); },
  deleteMonitor: async () => { throw new Error('firestore write denied'); },
  putThesis: async () => { throw new Error('firestore write denied'); },
  appendJournal: async () => { throw new Error('firestore write denied'); },
  putTrade: async () => { throw new Error('firestore write denied'); },
  getTrade: async () => null,
  listMonitors: async () => [],
};

function makeUser(store = REJECTING_STORE) {
  return { uid: 'test', conversationId: 'cid-1', store, skillsDir: '/tmp' };
}

function setup(store) {
  const api = makeApi();
  registerCustomTools(api, makeUser(store));
  return api.tools;
}

test('upsert_trade: store failure REJECTS with NOTHING WAS SAVED', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('upsert_trade').execute('t1', { symbol: 'PARAS', status: 'WATCHING' }),
    /upsert_trade FAILED — NOTHING WAS SAVED/,
  );
});

test('upsert_trade: status OPEN without a position REJECTS (assertTradeConsistent)', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('upsert_trade').execute('t1', { symbol: 'PARAS', status: 'OPEN' }),
    /upsert_trade FAILED — NOTHING WAS SAVED.*requires a position/s,
  );
});

test('arm_monitor: store failure REJECTS and says the monitor is NOT armed', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('arm_monitor').execute('t1', { name: 'paras-stop', symbol: 'PARAS', search_query: 'Paras', gates: { stop_below: 1234 } }),
    /arm_monitor FAILED.*NOT armed/s,
  );
});

test('arm_monitor: refusal (no gates) REJECTS — refusals must not read as success', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('arm_monitor').execute('t1', { name: 'x', symbol: 'X', search_query: 'x', gates: {} }),
    /arm_monitor REFUSED — NO monitor was armed/,
  );
});

test('append_journal: non-object record REJECTS with NOTHING WAS RECORDED', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('append_journal').execute('t1', { record: 'not an object' }),
    /append_journal FAILED — NOTHING WAS RECORDED/,
  );
});

test('close_trade: missing trade REJECTS with NOTHING WAS CLOSED', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('close_trade').execute('t1', { tradeId: 'ghost' }),
    /close_trade FAILED — no trade "ghost"/,
  );
});

test('write_thesis: store failure REJECTS with NOTHING WAS SAVED', async () => {
  const tools = setup();
  await assert.rejects(
    () => tools.get('write_thesis').execute('t1', { id: 'paras', doc: { a: 1 } }),
    /write_thesis FAILED — NOTHING WAS SAVED/,
  );
});

test('success path still returns a normal result (no regression)', async () => {
  const okStore = {
    ...REJECTING_STORE,
    putTrade: async () => {},
    putMonitor: async () => {},
  };
  const tools = setup(okStore);
  const r = await tools.get('upsert_trade').execute('t1', { symbol: 'PARAS' });
  assert.match(r.content[0].text, /→ WATCHING/);
  assert.equal(typeof r.details.tradeId, 'string');
  const m = await tools.get('arm_monitor').execute('t1', { name: 'paras-stop', symbol: 'PARAS', search_query: 'Paras', gates: { stop_below: 1234 } });
  assert.match(m.content[0].text, /Armed PARAS/);
  assert.equal(m.details.armed, true);
});
