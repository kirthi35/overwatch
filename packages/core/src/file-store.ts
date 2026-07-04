import * as fs from 'fs';
import * as path from 'path';
import { Monitor, Alert, OverwatchStore } from './types.js';

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

  constructor(private readonly baseDir: string) {
    this.monDir = path.join(baseDir, 'monitors');
    this.alertsLog = path.join(baseDir, 'alerts.log');
    this.thesesDir = path.join(baseDir, 'theses');
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
}
