import type { Firestore } from 'firebase-admin/firestore';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

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
// Surfaced alerts are marked so they're injected exactly once. The injected message
// mirrors the CLI alert-bridge: SURFACE + one-line read, then offer the live gate.

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

export function attachAlertRouter(session: AgentSession, db: Firestore, uid: string, cid: string): AlertRouter {
  const alertsCol = db.collection(`users/${uid}/alerts`);
  const query = alertsCol.where('conversationId', '==', cid);

  const unsub = query.onSnapshot(
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') continue;
        const a = change.doc.data() as AlertData;
        if (a.surfaced) continue; // already injected once
        if ((a.severity || '').toUpperCase() !== 'CRITICAL') continue; // low-noise: CRITICAL only
        void surface(change.doc.ref, a);
      }
    },
    (err) => console.error(`[alert-router ${uid}:${cid}] onSnapshot error:`, err.message),
  );

  async function surface(ref: FirebaseFirestore.DocumentReference, a: AlertData): Promise<void> {
    try {
      const headline = a.terminal ? 'A monitor fired a terminal condition.' : 'A monitor raised a CRITICAL alert.';
      await session.sendCustomMessage(
        {
          customType: 'overwatch-monitor',
          content:
            `[OVERWATCH MONITOR EVENT] ${headline}\n\n` +
            `Raw alert:\n[${a.ts ?? ''}] [${a.severity}] [${a.label ?? a.monitorName ?? ''}] ${a.message ?? ''}\n\n` +
            `ACT NOW (surface + summarize): tell the user this fired, in plain language, with a ONE-LINE ` +
            `read of what it means for the position/thesis. Do NOT pull fresh data or run the full risk gate ` +
            `yet — end by offering to run the live risk gate if they want to act.`,
          display: true,
        },
        { triggerTurn: true, deliverAs: 'followUp' },
      );
      await ref.set({ surfaced: true }, { merge: true });
    } catch (e: any) {
      console.error(`[alert-router ${uid}:${cid}] surface failed:`, e?.message ?? e);
    }
  }

  return { detach: () => unsub() };
}
