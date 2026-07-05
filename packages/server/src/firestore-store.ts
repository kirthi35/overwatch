import type { Firestore } from 'firebase-admin/firestore';
import { sanitizeName, type OverwatchStore, type Monitor, type Alert, type JournalRecord, type Trade } from '@overwatch/core';

// FirestoreStore — the uid-scoped OverwatchStore used by the server + worker.
// Every path lives under users/{uid}/**, so isolation is enforced both by
// construction (this instance only ever touches one uid) and by security rules.
export class FirestoreStore implements OverwatchStore {
  constructor(private readonly db: Firestore, private readonly uid: string) {}

  private monitorDoc(name: string) {
    return this.db.doc(`users/${this.uid}/monitors/${sanitizeName(name)}`);
  }
  private thesisDoc(id: string) {
    return this.db.doc(`users/${this.uid}/theses/${sanitizeName(id)}`);
  }
  private alertsCol() {
    return this.db.collection(`users/${this.uid}/alerts`);
  }

  async putMonitor(name: string, monitor: Monitor): Promise<void> {
    await this.monitorDoc(name).set(monitor as unknown as Record<string, unknown>, { merge: false });
  }

  async deleteMonitor(name: string): Promise<boolean> {
    const ref = this.monitorDoc(name);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  async getMonitor(name: string): Promise<Monitor | null> {
    const snap = await this.monitorDoc(name).get();
    return snap.exists ? (snap.data() as Monitor) : null;
  }

  async listMonitors(): Promise<Monitor[]> {
    const snap = await this.db.collection(`users/${this.uid}/monitors`).get();
    return snap.docs.map((d) => d.data() as Monitor);
  }

  async appendAlert(alert: Alert): Promise<void> {
    // `seen: false` powers the UI unread badge; ts is already on the alert.
    await this.alertsCol().add({ ...alert, seen: false } as Record<string, unknown>);
  }

  async putThesis(id: string, doc: unknown): Promise<void> {
    await this.thesisDoc(id).set(doc as Record<string, unknown>, { merge: false });
  }

  async getThesis(id: string): Promise<unknown | null> {
    const snap = await this.thesisDoc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async appendJournal(record: JournalRecord): Promise<void> {
    // LEGACY (superseded by the trade spine). Append-only under users/{uid}/journal.
    await this.db
      .collection(`users/${this.uid}/journal`)
      .add({ ts: new Date().toISOString(), ...record } as Record<string, unknown>);
  }

  private tradeDoc(tradeId: string) {
    return this.db.doc(`users/${this.uid}/trades/${sanitizeName(tradeId)}`);
  }

  async putTrade(trade: Trade): Promise<void> {
    await this.tradeDoc(trade.tradeId).set(trade as unknown as Record<string, unknown>, { merge: false });
  }

  async getTrade(tradeId: string): Promise<Trade | null> {
    const snap = await this.tradeDoc(tradeId).get();
    return snap.exists ? (snap.data() as Trade) : null;
  }

  async listTrades(): Promise<Trade[]> {
    const snap = await this.db.collection(`users/${this.uid}/trades`).get();
    return snap.docs.map((d) => d.data() as Trade);
  }
}
