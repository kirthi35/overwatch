import * as path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import type { AgentSession, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { buildUserSession } from './session-builder.js';
import { buildUserContext } from './user-context.js';
import { attachPersistence, type Persistence } from './persistence.js';
import { attachAlertRouter, type AlertRouter } from './alert-router.js';

export type EventSink = (evt: unknown) => void;

export interface PoolEntry {
  key: string;
  uid: string;
  cid: string;
  session: AgentSession;
  registry: ModelRegistry;
  persistence: Persistence;
  alertRouter: AlertRouter;
  unsub: () => void;
  sinks: Set<EventSink>;
  lastUsed: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export interface PoolOptions {
  /** Max warm sessions before LRU eviction of idle (no-sink) entries. */
  maxWarm?: number;
  /** Idle grace before disposing a session with no attached SSE clients (ms). */
  idleMs?: number;
  /** Root dir for Pi's local JSONL hot layer: <root>/<uid>/<cid>. Omit -> in-memory. */
  sessionsRoot?: string;
}

// One warm AgentSession per (uid, cid). Lazy-created; kept alive while an SSE client
// is attached plus an idle grace; LRU-evicted past maxWarm. A single subscribe() per
// session fans events out to all attached SSE sinks (persistence subscribes separately).
export class SessionPool {
  private entries = new Map<string, PoolEntry>();
  private building = new Map<string, Promise<PoolEntry>>();

  constructor(private readonly db: Firestore, private readonly opts: PoolOptions = {}) {}

  private key(uid: string, cid: string): string {
    return `${uid}:${cid}`;
  }

  async get(uid: string, cid: string, model?: { provider: string; id: string }): Promise<PoolEntry> {
    const key = this.key(uid, cid);
    const existing = this.entries.get(key);
    if (existing) {
      this.touch(existing);
      return existing;
    }
    const inflight = this.building.get(key);
    if (inflight) return inflight;
    const p = this.build(uid, cid, model).finally(() => this.building.delete(key));
    this.building.set(key, p);
    return p;
  }

  private async build(uid: string, cid: string, model?: { provider: string; id: string }): Promise<PoolEntry> {
    const u = await buildUserContext(this.db, uid, cid);
    const sessionsDir = this.opts.sessionsRoot ? path.join(this.opts.sessionsRoot, uid, cid) : undefined;
    const { session, registry } = await buildUserSession(u, { model, sessionsDir });
    const persistence = await attachPersistence(session, this.db, uid, cid, u);
    // Route this conversation's monitor fires into the live session (online) and
    // replay any that fired while it was cold (open-time).
    const alertRouter = attachAlertRouter(session, this.db, uid, cid);
    const sinks = new Set<EventSink>();
    const unsub = session.subscribe((evt) => {
      for (const s of sinks) {
        try {
          s(evt);
        } catch {
          /* a broken sink must not break the fan-out */
        }
      }
    });
    const entry: PoolEntry = { key: this.key(uid, cid), uid, cid, session, registry, persistence, alertRouter, unsub, sinks, lastUsed: Date.now() };
    this.entries.set(entry.key, entry);
    this.touch(entry);
    this.evictIfNeeded();
    return entry;
  }

  /** Attach an SSE sink; returns an unsubscribe. Keeps the session warm while attached. */
  addSink(entry: PoolEntry, sink: EventSink): () => void {
    entry.sinks.add(sink);
    this.touch(entry);
    return () => {
      entry.sinks.delete(sink);
      this.touch(entry);
    };
  }

  private touch(entry: PoolEntry): void {
    entry.lastUsed = Date.now();
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const idle = this.opts.idleMs ?? 8 * 60000;
    entry.idleTimer = setTimeout(() => {
      if (entry.sinks.size === 0) void this.dispose(entry.key);
      else this.touch(entry);
    }, idle);
    entry.idleTimer.unref?.();
  }

  private evictIfNeeded(): void {
    const max = this.opts.maxWarm ?? 40;
    while (this.entries.size > max) {
      let victim: PoolEntry | undefined;
      for (const e of this.entries.values()) {
        if (e.sinks.size > 0) continue; // never evict a session with a live client
        if (!victim || e.lastUsed < victim.lastUsed) victim = e;
      }
      if (!victim) break; // all warm sessions are actively attached
      void this.dispose(victim.key);
    }
  }

  async dispose(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    if (e.idleTimer) clearTimeout(e.idleTimer);
    try {
      await e.persistence.flush();
    } catch {
      /* best effort */
    }
    e.persistence.detach();
    e.alertRouter.detach();
    e.unsub();
    try {
      e.session.dispose();
    } catch {
      /* ignore */
    }
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((k) => this.dispose(k)));
  }

  get size(): number {
    return this.entries.size;
  }
}
