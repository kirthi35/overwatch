import type { Firestore } from 'firebase-admin/firestore';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { UserContext } from '@overwatch/core';
import { generateTitle, buildTranscript } from './title.js';

// Mirror completed messages + turn stats to Firestore for the UI. The live SSE
// stream carries token-by-token updates; here we persist only COMPLETED messages
// (delta of session.messages past what's already stored) on agent_end. Human-paced,
// no per-token writes. Pi's local JSONL remains the faithful hot record.

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('');
  }
  return '';
}

// Strip anything non-JSON-serializable so Firestore never rejects a message.
function plain(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

function safeStats(session: AgentSession): unknown {
  try {
    return plain(session.getSessionStats());
  } catch {
    return null;
  }
}

export interface Persistence {
  /** Force a flush (e.g. before disposing a session). */
  flush: () => Promise<void>;
  detach: () => void;
}

export async function attachPersistence(
  session: AgentSession,
  db: Firestore,
  uid: string,
  cid: string,
  u?: UserContext,
): Promise<Persistence> {
  const convo = db.doc(`users/${uid}/conversations/${cid}`);
  const messagesCol = convo.collection('messages');

  // Start the seq where Firestore already is, so a rehydrated session doesn't
  // double-write history.
  // nextSeq = next Firestore doc number (monotonic, appends after existing docs).
  // sessionCursor = how many of session.messages are already in the store (the seeded
  // prior conversation) — decoupled from nextSeq so seeding a subset stays consistent.
  const existing = await messagesCol.count().get().catch(() => null);
  let nextSeq = existing ? existing.data().count : (await messagesCol.get()).size;
  const wasNew = nextSeq === 0;
  let titled = !wasNew; // only brand-new conversations get an LLM title
  let sessionCursor = (session.messages as unknown[]).length;

  let flushing: Promise<void> | null = null;
  async function flush(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      const msgs = session.messages as unknown as Array<{ role: string; content: unknown }>;
      if (msgs.length > sessionCursor) {
        // Store the FULL transcript (every message, incl. tool results) — Firestore is
        // the complete record. The UI filters for display.
        const batch = db.batch();
        for (let i = sessionCursor; i < msgs.length; i++) {
          const m = msgs[i];
          batch.set(messagesCol.doc(String(nextSeq).padStart(6, '0')), {
            seq: nextSeq,
            role: m.role,
            content: extractText(m.content), // text, for the UI
            msg: plain(m), // the full Pi message, replayed verbatim on resume (JSONL-style)
            ts: new Date().toISOString(),
          });
          nextSeq++;
        }
        batch.set(convo, { updatedAt: new Date().toISOString(), lastStats: safeStats(session) }, { merge: true });
        await batch.commit();
        sessionCursor = msgs.length;

        // First turn of a new conversation: title it from the whole transcript (async).
        if (!titled && u) {
          titled = true;
          const transcript = buildTranscript(msgs);
          if (transcript) {
            void generateTitle(u, transcript)
              .then((title) => {
                if (title) return convo.set({ title }, { merge: true });
              })
              .catch(() => {});
          }
        }
      }
    })();
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  }

  const unsub = session.subscribe((evt) => {
    if (evt.type === 'agent_end') void flush();
  });

  return { flush, detach: () => unsub() };
}
