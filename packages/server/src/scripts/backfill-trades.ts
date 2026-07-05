import { getAuth } from 'firebase-admin/auth';
import { getDb } from '../firebase.js';
import type { Trade } from '@overwatch/core';

// Backfill the three audited Jul 1–3 trades as full audit records into ONE user's
// trades collection, so the first weekly review has real content (ADR 0005 D4).
// Verdicts come from the lesson library (theses/lessons/L-2026-07-0{1,2,3}.md).
//
// Run (pick one):
//   BACKFILL_EMAIL=you@example.com  npm run backfill-trades -w @overwatch/server
//   BACKFILL_UID=<firebase-uid>     npm run backfill-trades -w @overwatch/server

const TRADES: Trade[] = [
  {
    tradeId: 'eternal-2026-07-01',
    symbol: 'ETERNAL',
    status: 'CLOSED',
    thesis: {
      why: 'slow mega-cap range vehicle — accumulate on weakness, trim into strength',
      archetype: 'maxed-multiple mega-cap',
    },
    position: { entry: 264.6, shares: 40, openedAt: '2026-07-01' },
    gates: { passed: ['regime', 'R:R', 'no-chase'], overridden: [] },
    close: {
      exit_price: 282,
      exit_date: '2026-07-02',
      realized_R: 1.0,
      hold_days: 1,
      thesis_verdict: 'RIGHT',
      adherent: true,
      one_line_lesson: 'Followed doctrine; +6.6% (~+1.0R). Correctly sized and exited.',
    },
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  },
  {
    tradeId: 'paras-2026-07-02',
    symbol: 'PARAS',
    status: 'OPEN',
    thesis: {
      why: 'defence small-cap momentum, +53% on the month (evidence: L-2026-07-02)',
      archetype: 'live-headroom small-cap',
      break_triggers: ['daily close below the armed stop', 'driver break'],
    },
    card: { mode: 'improvised-momentum', stop: 1278, shares: 10, hold_deadline: '2026-07-09' },
    position: { entry: 1322.47, stop: 1278, shares: 10, openedAt: '2026-07-02' },
    gates: {
      passed: [],
      overridden: ['R:R floor (blended 1.98:1)', 'stop floor (0.5xATR)', 'no-chase (entered at day high, RSI ~70)'],
    },
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  },
  {
    tradeId: 'rubicon-2026-07-03',
    symbol: 'RUBICON',
    status: 'OPEN',
    thesis: {
      why: 'defence small-cap, order book loading — BUT valuation REFUTED, P/E 92 vs 35, QoQ growth decelerating (evidence: L-2026-07-03)',
      archetype: 'structural growth, decelerating',
      break_triggers: ['daily close below the armed stop', 'anchor low breaks'],
    },
    card: { stop: 1275, shares: 5 },
    position: { entry: 1375, stop: 1275, shares: 5, openedAt: '2026-07-03' },
    gates: {
      passed: [],
      overridden: ['sizer verdict (Gate 0 skipped)', 'valuation-refuted cap', 'no-instant-fire-zones', 'sizing direction (back-computed)'],
    },
    createdAt: '2026-07-03T00:00:00Z',
    updatedAt: '2026-07-03T00:00:00Z',
  },
];

async function resolveUid(): Promise<string> {
  if (process.env.BACKFILL_UID) return process.env.BACKFILL_UID;
  const email = process.env.BACKFILL_EMAIL;
  if (!email) throw new Error('Set BACKFILL_EMAIL=<email> or BACKFILL_UID=<uid>.');
  const user = await getAuth().getUserByEmail(email);
  return user.uid;
}

async function main() {
  const uid = await resolveUid();
  const db = getDb();
  for (const t of TRADES) {
    await db.doc(`users/${uid}/trades/${t.tradeId}`).set(t as unknown as Record<string, unknown>, { merge: false });
    console.log(`  backfilled trades/${t.tradeId} (${t.symbol} · ${t.status})`);
  }
  console.log(`Backfilled ${TRADES.length} audited trades into users/${uid}/trades.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('backfill-trades failed:', e.message);
    process.exit(1);
  },
);
