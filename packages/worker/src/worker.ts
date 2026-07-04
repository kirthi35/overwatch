import type { Firestore } from 'firebase-admin/firestore';
import {
  GrowwDataClient,
  evaluateGates,
  fail,
  recover,
  marketOpen,
  istClock,
  initMonitorState,
  DEFAULT_WATCHDOG,
  notifyTelegram,
  type Monitor,
  type MonitorState,
  type WatchdogOpts,
  type AlertSeverity,
  type TelegramConfig,
} from '@overwatch/core';
import { SecretsStore, FirestoreStore } from '@overwatch/server';

const TICK_MS = 60000;
const HEARTBEAT_MS = 150000; // ~2.5 min: throttled state flush for the UI "last polled" label

interface HotEntry {
  uid: string;
  path: string; // users/{uid}/monitors/{docId}
  monitor: Monitor; // config (kept fresh from Firestore)
  state: MonitorState; // hot, in-memory authoritative state
  lastFlush: number;
}

// MonitorWorker — the multi-tenant poller. Config comes from Firestore via ONE
// collectionGroup onSnapshot (reads on CHANGE only, not per tick). The 60s loop runs
// entirely on the in-memory hot cache (seeded from each monitor doc's last-flushed
// state), so Firestore isn't overloaded. Writes to Firestore happen ONLY on transitions
// (fire / blind / recover) and a throttled state heartbeat. Per-user Groww token
// (BYOK) — a dead token blinds only its owner's monitors. Reuses evaluateGates +
// fail/recover verbatim from @overwatch/core.
export class MonitorWorker {
  private hot = new Map<string, HotEntry>();
  private telegramByUid = new Map<string, TelegramConfig | undefined>();
  private ticking = false;
  private timer?: ReturnType<typeof setInterval>;
  private unsub?: () => void;
  private readonly O: WatchdogOpts = DEFAULT_WATCHDOG;

  // opts.alwaysOpen bypasses the NSE-hours gate — for tests/verification off-hours.
  constructor(private readonly db: Firestore, private readonly opts: { alwaysOpen?: boolean } = {}) {}

  start(): void {
    // Config sync: push on change, not per-tick reads.
    this.unsub = this.db.collectionGroup('monitors').onSnapshot(
      (snap) => {
        for (const ch of snap.docChanges()) this.applyChange(ch.type, ch.doc.ref.path, ch.doc.data() as Monitor);
      },
      (err) => console.error('[worker] monitors onSnapshot error:', err.message),
    );
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    console.log('[worker] up. Tick 60s during NSE hours; config via onSnapshot; per-user token.');
  }

  async stop(): Promise<void> {
    if (this.unsub) this.unsub();
    if (this.timer) clearInterval(this.timer);
  }

  private key(uid: string, name: string): string {
    return `${uid}:${name}`;
  }

  private applyChange(type: string, path: string, m: Monitor): void {
    const uid = path.split('/')[1];
    const key = this.key(uid, m.name);
    if (type === 'removed') {
      this.hot.delete(key);
      return;
    }
    const existing = this.hot.get(key);
    // Keep in-memory state if present (authoritative for the live loop; also avoids our
    // own heartbeat write echoing back and clobbering counters). Else seed from the doc.
    const state = existing?.state ?? m.state ?? initMonitorState();
    this.hot.set(key, { uid, path, monitor: m, state, lastFlush: existing?.lastFlush ?? 0 });
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    const now = Date.now();
    if (!this.opts.alwaysOpen && !marketOpen(now, this.O)) return;
    this.ticking = true;
    try {
      const byUid = new Map<string, HotEntry[]>();
      for (const e of this.hot.values()) {
        const m = e.monitor;
        if (m.disabled || (m.mode || 'in-session') === 'daemon' || e.state.fired) continue;
        const pollMs = (m.poll_minutes || 1) * 60000;
        if (e.state.lastPoll && now - e.state.lastPoll < pollMs - 1000) continue;
        if (typeof m.time_gate_ist === 'number' && istClock(now).num < m.time_gate_ist) continue;
        const list = byUid.get(e.uid) ?? [];
        list.push(e);
        byUid.set(e.uid, list);
      }
      for (const [uid, entries] of byUid) await this.pollUser(uid, entries, now);
    } finally {
      this.ticking = false;
    }
  }

  private async pollUser(uid: string, entries: HotEntry[], now: number): Promise<void> {
    let token: string | undefined;
    try {
      const creds = await new SecretsStore(this.db, uid).get();
      token = creds?.growwToken;
      this.telegramByUid.set(
        uid,
        creds?.telegram
          ? { botToken: creds.telegram.botToken, chatId: creds.telegram.chatId, minSeverity: (creds.telegram.minSeverity || 'WARNING').toUpperCase() as AlertSeverity }
          : undefined,
      );
    } catch {
      token = undefined;
    }
    if (!token) {
      for (const e of entries) await this.applyFailure(e, 'no Groww token for user');
      return;
    }
    const client = new GrowwDataClient(token);
    try {
      await client.connect();
    } catch (e: any) {
      // A connect failure blinds every one of this user's monitors — fold it into each
      // watchdog so blindness escalates rather than looking like a quiet market.
      for (const en of entries) await this.applyFailure(en, e.message);
      await client.close();
      return;
    }
    for (const e of entries) await this.pollOne(client, e, now);
    await client.close();
  }

  private async pollOne(client: GrowwDataClient, e: HotEntry, now: number): Promise<void> {
    const m = e.monitor;
    const sym = m.symbol || m.name;
    e.state.lastPoll = now;
    try {
      const q: any = await client.call('get_quotes_and_depth', { search_query: m.search_query, segment: m.segment || 'CASH', entity_type: 'Stocks' });
      const d = q.result.quotes_depth[0];
      const ltp: number = d.ltp;
      const ratio = d.totalBuyQty > 0 ? d.totalSellQty / d.totalBuyQty : 99;

      let green = false;
      if (m.candle_interval) {
        const c: any = await client.call('fetch_historical_candle_data', { company_name: m.search_query, interval_in_minutes: m.candle_interval, last_n_days: 1, segment: m.segment || 'CASH' });
        const candles = c.result.candles;
        const last = candles[candles.length - 1];
        green = !!(last && last.close > last.open);
      }

      // Healthy cycle: clear blind state (RECOVERED notice if we were blind).
      const rec = recover(e.state, this.O, sym);
      e.state = rec.state;
      if (rec.alert) await this.emit(e, rec.alert.severity, rec.alert.message, false);

      e.state.lastLtp = ltp;
      e.state.lastRatio = Number(ratio.toFixed(2));
      e.state.lastGreen = green;

      const fire = evaluateGates(m, ltp, ratio, green);
      if (fire) {
        if (fire.terminal) {
          e.state.fired = true;
          e.state.confirmedAt = new Date(now).toISOString();
          await this.emit(e, fire.severity, fire.message, true);
          await this.flushState(e, now); // durable-first: state persisted with fired=true
        } else if (!e.state.breakoutAlerted) {
          e.state.breakoutAlerted = true;
          await this.emit(e, fire.severity, fire.message, false);
          await this.flushState(e, now);
        }
      }

      if (now - e.lastFlush >= HEARTBEAT_MS) await this.flushState(e, now);
    } catch (err: any) {
      await this.applyFailure(e, err.message);
    }
  }

  private async applyFailure(e: HotEntry, msg: string): Promise<void> {
    const wd = fail(e.state, msg, this.O, e.monitor.symbol || e.monitor.name);
    e.state = wd.state;
    if (wd.alert) {
      await this.emit(e, wd.alert.severity, wd.alert.message, false);
      await this.flushState(e, Date.now());
    }
  }

  // Alert: write the durable Firestore alert doc FIRST, then deliver to Telegram.
  private async emit(e: HotEntry, severity: AlertSeverity, message: string, terminal: boolean): Promise<void> {
    const sym = e.monitor.symbol || e.monitor.name;
    try {
      await new FirestoreStore(this.db, e.uid).appendAlert({
        ts: new Date().toISOString(),
        severity,
        label: sym,
        message,
        monitorName: e.monitor.name,
        conversationId: e.monitor.conversationId,
        terminal,
      });
    } catch (err: any) {
      console.error('[worker] appendAlert failed:', err.message);
    }
    try {
      await notifyTelegram({ label: sym, message, severity }, this.telegramByUid.get(e.uid));
    } catch {
      /* delivery is best-effort */
    }
  }

  // Flush the hot state to the monitor doc's `state` field (throttled heartbeat +
  // immediately on transitions). This is the ONLY per-monitor Firestore write in steady state.
  private async flushState(e: HotEntry, now: number): Promise<void> {
    e.lastFlush = now;
    try {
      await this.db.doc(e.path).set({ state: e.state }, { merge: true });
    } catch (err: any) {
      console.error('[worker] flushState failed:', err.message);
    }
  }

  get size(): number {
    return this.hot.size;
  }
}
