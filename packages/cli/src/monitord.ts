import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

// Local monitor-daemon lifecycle for the single-user CLI. The multi-tenant server
// does NOT use this — its worker polls the store instead. Wired via
// UserContext.onMonitorArmed so the doctrine's arm_monitor tool stays transport-agnostic.

const OVERWATCH_DIR = path.join(os.homedir(), '.overwatch');
const MONITORD = path.join(OVERWATCH_DIR, 'daemons', 'overwatch-monitord.js');
const MONITORD_PID = path.join(OVERWATCH_DIR, 'monitord.pid');

// Is the single monitor daemon already running? Reads its pidfile and probes.
function monitordAlive(): boolean {
  try {
    const pid = (JSON.parse(fs.readFileSync(MONITORD_PID, 'utf8')) || {}).pid;
    if (!pid) return false;
    process.kill(pid, 0); // throws if the process is gone
    return true;
  } catch {
    return false;
  }
}

// Ensure the ONE monitor daemon is up. Spawned detached so it survives the CLI
// closing (the whole point). Inherits GROWW_API_TOKEN from this process's env.
export function ensureMonitord(): string {
  if (monitordAlive()) return 'monitord already running';
  if (!fs.existsSync(MONITORD)) return 'monitord NOT installed — run `npm run seed`';
  try {
    const logDir = path.join(OVERWATCH_DIR, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, 'monitord.out'), 'a');
    const child = spawn(process.execPath, [MONITORD], { detached: true, stdio: ['ignore', out, out], env: process.env });
    child.unref();
    return 'monitord started';
  } catch (e: any) {
    return `monitord spawn failed: ${e.message}`;
  }
}
