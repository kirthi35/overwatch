import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { notifyTelegram } from './telegram.js';

const OVERWATCH_DIR = path.join(os.homedir(), '.overwatch');
const MON_DIR = path.join(OVERWATCH_DIR, 'monitors');
const MONITORD = path.join(OVERWATCH_DIR, 'daemons', 'overwatch-monitord.js');
const MONITORD_PID = path.join(OVERWATCH_DIR, 'monitord.pid');

// Sanitize a monitor name into a safe filename stem (no path traversal).
function monFile(name: string): string {
  const stem = String(name).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'monitor';
  return path.join(MON_DIR, `${stem}.json`);
}

// Is the single monitor daemon already running? Reads its pidfile and probes.
function monitordAlive(): boolean {
  try {
    const pid = (JSON.parse(fs.readFileSync(MONITORD_PID, 'utf8')) || {}).pid;
    if (!pid) return false;
    process.kill(pid, 0);   // throws if the process is gone
    return true;
  } catch { return false; }
}

// Ensure the ONE monitor daemon is up. Spawned detached so it survives the CLI
// closing (the whole point). Inherits GROWW_API_TOKEN from this process's env.
function ensureMonitord(): string {
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

export function registerCustomTools(api: ExtensionAPI) {

  api.registerTool({
    name: "console_log_alert",
    label: "Console Log Alert",
    description: "Sends an alert to the user's console and logs it to ~/.overwatch/alerts.log. Use this to notify the user of any important market events or daemon monitoring alerts.",
    parameters: Type.Object({
      message: Type.String({ description: "The alert message to display to the user" }),
      severity: Type.String({ description: "INFO, WARNING, or CRITICAL" })
    }),
    execute: async (toolCallId, args) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [${args.severity}] ${args.message}\n`;
      
      const logPath = path.join(OVERWATCH_DIR, 'alerts.log');
      fs.appendFileSync(logPath, logEntry, 'utf8');

      // Deliver to Telegram too (no-op if unconfigured; severity-gated there).
      void notifyTelegram({ message: args.message, severity: args.severity });

      console.log(`\n\x1b[33m--- OVERWATCH ALERT [${args.severity}] ---\x1b[0m`);
      console.log(args.message);
      console.log(`\x1b[33m--------------------------------------\x1b[0m\n`);
      
      return {
        content: [{ type: "text", text: "Alert successfully logged and displayed to the user." }],
        details: { logged: true }
      };
    }
  });

  // arm_monitor — the PROPER way to start watching a symbol in-session. Writes a
  // validated ~/.overwatch/monitors/<name>.json; the in-process watcher picks it
  // up on the next 1-minute tick (no restart) and evaluates the gates in plain JS
  // during market hours. Replaces hand-writing the JSON via the generic write tool.
  api.registerTool({
    name: "arm_monitor",
    label: "Arm Monitor",
    description: "Arm an in-session price monitor on an NSE symbol. Writes ~/.overwatch/monitors/<name>.json; the in-process watcher picks it up on the next 1-minute tick (no restart) and evaluates the gates during market hours — no LLM in the loop. USE THIS instead of writing the monitor JSON by hand. Include only the gates the thesis needs; at least one gate is required. For unattended (CLI-closed) monitoring, also spawn a daemon per monitor-builder.md and pass mode:'daemon' here so the watcher skips it.",
    parameters: Type.Object({
      name: Type.String({ description: "Unique monitor id in kebab-case (e.g. 'paras-scenario-a'). Reused as the filename; re-arming the same name overwrites it." }),
      symbol: Type.String({ description: "Ticker shown in alerts (e.g. 'PARAS')." }),
      search_query: Type.String({ description: "Groww search query for the instrument (e.g. 'Paras Defence')." }),
      segment: Type.Optional(Type.String({ description: "Groww segment. Default 'CASH'." })),
      poll_minutes: Type.Optional(Type.Number({ description: "Poll cadence in minutes during market hours. Default 1 (every minute)." })),
      time_gate_ist: Type.Optional(Type.Number({ description: "IST HHMM; don't evaluate before this (e.g. 935 to skip opening noise). Omit for none." })),
      candle_interval: Type.Optional(Type.Number({ description: "Candle interval in minutes for the green-candle check (e.g. 15). Required if gates.require_green_candle is set." })),
      mode: Type.Optional(Type.String({ description: "'in-session' (default; the watcher owns it) or 'daemon' (a spawned daemon owns it; the watcher skips it to avoid double-polling)." })),
      gates: Type.Object({
        stop_below: Type.Optional(Type.Number({ description: "LTP under this -> CRITICAL, terminal (invalidation)." })),
        zone: Type.Optional(Type.Array(Type.Number(), { description: "[lo, hi] entry zone. LTP inside + green (if required) + book under cap -> CRITICAL, terminal." })),
        require_green_candle: Type.Optional(Type.Boolean({ description: "Require the last candle green for the zone entry gate. Needs candle_interval." })),
        max_sell_buy_ratio: Type.Optional(Type.Number({ description: "Order-book sell:buy cap for the zone entry gate (e.g. 3.0)." })),
        breakout_above: Type.Optional(Type.Number({ description: "LTP over this -> WARNING, non-terminal heads-up (fires once)." })),
      }, { description: "Gate thresholds. All optional; include only what the thesis needs. At least one gate is required." }),
    }),
    execute: async (_toolCallId, args: any) => {
      const g = args.gates || {};
      const hasGate = ['stop_below', 'zone', 'require_green_candle', 'max_sell_buy_ratio', 'breakout_above']
        .some(k => g[k] !== undefined && g[k] !== null);
      if (!hasGate) {
        return { content: [{ type: "text", text: "arm_monitor: refused — no gates given. Supply at least one of stop_below, zone, or breakout_above." }], details: { armed: false, file: undefined as string | undefined, daemon: undefined as string | undefined } };
      }
      if (g.require_green_candle && args.candle_interval === undefined) {
        return { content: [{ type: "text", text: "arm_monitor: refused — require_green_candle needs candle_interval (e.g. 15) so the watcher can fetch candles." }], details: { armed: false, file: undefined as string | undefined, daemon: undefined as string | undefined } };
      }

      const monitor: any = {
        name: args.name,
        symbol: args.symbol,
        search_query: args.search_query,
        segment: args.segment || 'CASH',
        mode: args.mode || 'in-session',
        poll_minutes: args.poll_minutes && args.poll_minutes > 0 ? args.poll_minutes : 1,
        gates: g,
      };
      if (args.time_gate_ist !== undefined) monitor.time_gate_ist = args.time_gate_ist;
      if (args.candle_interval !== undefined) monitor.candle_interval = args.candle_interval;

      try {
        if (!fs.existsSync(MON_DIR)) fs.mkdirSync(MON_DIR, { recursive: true });
        const file = monFile(args.name);
        fs.writeFileSync(file, JSON.stringify(monitor, null, 2), 'utf8');
        // Start the single always-on monitor daemon if it isn't up yet.
        const daemon = monitor.mode === 'daemon' ? 'skipped (bespoke daemon owns this)' : ensureMonitord();
        const gateList = Object.entries(g).filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
        const summary = `Armed ${monitor.symbol} (${monitor.name}) — poll ${monitor.poll_minutes}m${monitor.time_gate_ist ? `, after ${monitor.time_gate_ist} IST` : ''}. Gates: ${gateList}. ${daemon}. It runs even if you close the CLI, and evaluates during NSE hours on the next tick.`;
        return { content: [{ type: "text", text: summary }], details: { armed: true, file, daemon } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `arm_monitor: failed to write monitor file — ${e.message}` }], details: { armed: false, file: undefined as string | undefined, daemon: undefined as string | undefined } };
      }
    }
  });

  // disarm_monitor — stop watching a symbol. Deletes the armed file so the
  // watcher drops it on the next tick. The counterpart to arm_monitor.
  api.registerTool({
    name: "disarm_monitor",
    label: "Disarm Monitor",
    description: "Stop an in-session monitor by name. Deletes ~/.overwatch/monitors/<name>.json so the watcher stops polling it on the next tick. Does NOT stop a spawned daemon — use monitorctl for those.",
    parameters: Type.Object({
      name: Type.String({ description: "The monitor id used when arming (e.g. 'paras-scenario-a')." }),
    }),
    execute: async (_toolCallId, args: any) => {
      const file = monFile(args.name);
      try {
        if (!fs.existsSync(file)) {
          return { content: [{ type: "text", text: `disarm_monitor: no armed monitor named '${args.name}'. Nothing to do.` }], details: { disarmed: false, file: undefined as string | undefined } };
        }
        fs.unlinkSync(file);
        return { content: [{ type: "text", text: `Disarmed '${args.name}'. The watcher will stop polling it on the next tick.` }], details: { disarmed: true, file } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `disarm_monitor: failed — ${e.message}` }], details: { disarmed: false, file: undefined as string | undefined } };
      }
    }
  });

}
