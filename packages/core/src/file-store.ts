import * as fs from 'fs';
import * as path from 'path';
import { Monitor, Alert, JournalRecord, Trade, OverwatchStore } from './types.js';

// Sanitize a monitor/thesis id into a safe filename stem (no path traversal).
// Same rule the arm_monitor tool has always used.
export function sanitizeName(name: string): string {
  return (
    String(name).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') ||
    'item'
  );
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

// FileStore — the local-filesystem OverwatchStore used by the CLI (single-user).
// Preserves today's ~/.overwatch/ layout so nothing about the CLI's on-disk
// behavior changes: monitors/<name>.json, alerts.log, theses/<id>.json.
export class FileStore implements OverwatchStore {
  private readonly monDir: string;
  private readonly alertsLog: string;
  private readonly thesesDir: string;
  private readonly tradesDir: string;

  constructor(private readonly baseDir: string) {
    this.monDir = path.join(baseDir, 'monitors');
    this.alertsLog = path.join(baseDir, 'alerts.log');
    this.thesesDir = path.join(baseDir, 'theses');
    this.tradesDir = path.join(baseDir, 'trades');
  }

  private monFile(name: string): string {
    return path.join(this.monDir, `${sanitizeName(name)}.json`);
  }

  async putMonitor(name: string, monitor: Monitor): Promise<void> {
    ensureDir(this.monDir);
    fs.writeFileSync(this.monFile(name), JSON.stringify(monitor, null, 2), 'utf8');
  }

  async deleteMonitor(name: string): Promise<boolean> {
    const f = this.monFile(name);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    return true;
  }

  async getMonitor(name: string): Promise<Monitor | null> {
    return readJSON<Monitor>(this.monFile(name));
  }

  async listMonitors(): Promise<Monitor[]> {
    try {
      return fs
        .readdirSync(this.monDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJSON<Monitor>(path.join(this.monDir, f)))
        .filter((m): m is Monitor => m !== null);
    } catch {
      return [];
    }
  }

  async appendAlert(a: Alert): Promise<void> {
    ensureDir(this.baseDir);
    // Same line format both producers use today: [ISO] [SEV] [LABEL] msg
    // (label bracket omitted when absent, matching console_log_alert).
    const label = a.label ? ` [${a.label}]` : '';
    fs.appendFileSync(this.alertsLog, `[${a.ts}] [${a.severity}]${label} ${a.message}\n`, 'utf8');
  }

  async putThesis(id: string, doc: unknown): Promise<void> {
    ensureDir(this.thesesDir);
    fs.writeFileSync(path.join(this.thesesDir, `${sanitizeName(id)}.json`), JSON.stringify(doc, null, 2), 'utf8');
  }

  async getThesis(id: string): Promise<unknown | null> {
    return readJSON<unknown>(path.join(this.thesesDir, `${sanitizeName(id)}.json`));
  }

  async appendJournal(record: JournalRecord): Promise<void> {
    ensureDir(this.thesesDir);
    // Append-only, one JSON object per line — the theses/journal.jsonl convention the
    // trade-journal skill already documents. LEGACY: superseded by the trade spine.
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
    fs.appendFileSync(path.join(this.thesesDir, 'journal.jsonl'), line + '\n', 'utf8');
  }

  private tradeFile(id: string): string {
    return path.join(this.tradesDir, `${sanitizeName(id)}.json`);
  }

  async putTrade(trade: Trade): Promise<void> {
    ensureDir(this.tradesDir);
    fs.writeFileSync(this.tradeFile(trade.tradeId), JSON.stringify(trade, null, 2), 'utf8');
  }

  async getTrade(tradeId: string): Promise<Trade | null> {
    return readJSON<Trade>(this.tradeFile(tradeId));
  }

  async listTrades(): Promise<Trade[]> {
    try {
      return fs
        .readdirSync(this.tradesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJSON<Trade>(path.join(this.tradesDir, f)))
        .filter((t): t is Trade => t !== null);
    } catch {
      return [];
    }
  }
}
