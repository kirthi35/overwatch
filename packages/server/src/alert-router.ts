import type { Firestore } from 'firebase-admin/firestore';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { relativeAge, formatIst } from '@overwatch/core';

// Alert -> conversation routing (the server side of the monitor loop).
//
// Each warm conversation session gets ONE Firestore listener on its own alerts
// (filtered by conversationId). This single listener handles BOTH:
//   - ONLINE: a fire that happens while the session is warm -> injected immediately.
//   - REPLAY: fires that happened while the session was cold surface on next open
//     (the listener's initial snapshot delivers the un-surfaced alerts).
//
// Only CRITICAL alerts wake the chat (low-noise doctrine — terminal fires + CRITICAL
// blind escalations); WARNING heads-ups still show in the Alerts tab + Telegram.
// Surfaced alerts are marked so they're injected exactly once.
//
// Delivery discipline (added after the July 2026 audit):
//   - Alerts in a snapshot are SORTED by ts (the query has no orderBy — a cold-open
//     replay used to arrive in random doc order, so "blind 230 min" could surface
//     before "blind 120 min"). ISO timestamps sort lexicographically. Deliberately
//     NOT an orderBy + composite index: a missing index kills the whole listener.
//   - The batch is injected as ONE message (one triggerTurn), not one turn per alert
//     (30-70 blind CRITICALs used to each wake the model separately).
//   - Each alert line carries its AGE, computed at DELIVERY time; stale alerts
//     (>10 min) are explicitly labeled so the model never narrates a 2-day-old fire
//     as "just triggered". Terminal fires say the monitor has STOPPED polling.

const STALE_AFTER_MS = 10 * 60 * 1000;

export interface AlertRouter {
  detach: () => void;
}

interface AlertData {
  ts?: string;
  severity?: string;
  label?: string;
  message?: string;
  monitorName?: string;
  terminal?: boolean;
  surfaced?: boolean;
}

// One alert -> one line of the injected batch message. Exported for tests.
export function formatAlertLine(a: AlertData, nowMs: number): string {
  const tsMs = a.ts ? Date.parse(a.ts) : NaN;
  const known = Number.isFinite(tsMs);
  const stale = known && nowMs - tsMs > STALE_AFTER_MS;
  const when = known
    ? stale
      ? `⚠️ STALE alert from ${relativeAge(tsMs, nowMs)} (${formatIst(tsMs, nowMs)}) — the market may have moved since; VERIFY with a fresh quote before acting or advising.`
      : `fired ${relativeAge(tsMs, nowMs)} (${formatIst(tsMs, nowMs)}).`
    : 'fired at an unknown time — treat as stale and verify before acting.';
  const terminal = a.terminal
    ? ' This was a terminal fire — the monitor is now FIRED and has STOPPED polling; it will not alert again.'
    : '';
  return `- [${a.severity}] [${a.label ?? a.monitorName ?? ''}] ${when}${terminal}\n  ${a.message ?? ''}`;
}

export function attachAlertRouter(session: AgentSession, db: Firestore, uid: string, cid: string): AlertRouter {
  const alertsCol = db.collection(`users/${uid}/alerts`);
  const query = alertsCol.where('conversationId', '==', cid);

  const unsub = query.onSnapshot(
    (snap) => {
      // Collect-then-send: every pending alert in this snapshot goes out as ONE
      // ts-ordered injection instead of N independent triggerTurn wakes.
      const pending: Array<{ ref: FirebaseFirestore.DocumentReference; a: AlertData }> = [];
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') continue;
        const a = change.doc.data() as AlertData;
        if (a.surfaced) continue; // already injected once
        if ((a.severity || '').toUpperCase() !== 'CRITICAL') continue; // low-noise: CRITICAL only
        pending.push({ ref: change.doc.ref, a });
      }
      if (!pending.length) return;
      pending.sort((x, y) => (x.a.ts ?? '').localeCompare(y.a.ts ?? ''));
      void surfaceBatch(pending);
    },
    (err) => console.error(`[alert-router ${uid}:${cid}] onSnapshot error:`, err.message),
  );

  async function surfaceBatch(pending: Array<{ ref: FirebaseFirestore.DocumentReference; a: AlertData }>): Promise<void> {
    try {
      const now = Date.now();
      const lines = pending.map(({ a }) => formatAlertLine(a, now)).join('\n');
      const headline =
        pending.length === 1
          ? pending[0].a.terminal
            ? 'A monitor fired a terminal condition.'
            : 'A monitor raised a CRITICAL alert.'
          : `${pending.length} monitor alerts (oldest first).`;
      await session.sendCustomMessage(
        {
          customType: 'overwatch-monitor',
          content:
            `[OVERWATCH MONITOR EVENT] ${headline}\n\n` +
            `${lines}\n\n` +
            `ACT NOW (surface + summarize): tell the user what fired, in plain language, with a ONE-LINE ` +
            `read of what it means for the position/thesis. Respect each alert's age label — a STALE alert ` +
            `is history, not breaking news. Do NOT pull fresh data or run the full risk gate ` +
            `yet — end by offering to run the live risk gate if they want to act.`,
          display: true,
        },
        { triggerTurn: true, deliverAs: 'followUp' },
      );
      await Promise.all(pending.map(({ ref }) => ref.set({ surfaced: true }, { merge: true })));
    } catch (e: any) {
      console.error(`[alert-router ${uid}:${cid}] surface failed:`, e?.message ?? e);
    }
  }

  return { detach: () => unsub() };
}
