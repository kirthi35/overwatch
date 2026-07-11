import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { relativeAge, formatIst } from './time.js';

// Overwatch — Alert Bridge.
//
// WHY THIS EXISTS: monitors are background daemons. They write terminal events
// to ~/.overwatch/alerts.log and survive the chat closing — that is durable
// DETECTION. But the Pi chat agent is turn-based: it has no background loop, so
// while you are mid-session a daemon could fire and the agent would never know
// until you asked. This bridge closes that gap.
//
// Pi lets an extension push a message into the live session (api.sendMessage)
// and wake the agent even when idle (triggerTurn). So we tail alerts.log + the
// per-monitor state files; when a monitor hits a TERMINAL condition (a CRITICAL
// alert line, or a state file flipping fired:true), we inject a message and the
// agent SURFACES it to the user with a one-line read.
//
// Design choices (locked with the user):
//   - Trigger ONLY on CRITICAL alerts + fired transitions (low noise).
//   - Act = SURFACE + SUMMARIZE. The agent does NOT auto-run the full risk gate
//     or pull fresh data; it shows the alert, gives a one-line read, and offers
//     to run the live gate. (The doctrine for this lives in the master prompt.)
//   - Deliver as "followUp": never interrupt the user's current turn.
//
// This is the in-session layer. With the chat CLOSED, alerts.log + monitorctl
// remain the durable record — the two layers are complementary, not redundant.

const OW = path.join(os.homedir(), '.overwatch');
const ALERTS = path.join(OW, 'alerts.log');
const STATE_DIR = path.join(OW, 'thesis');
const POLL_MS = 4000;                 // tail cadence — alerts aren't sub-second
const DEDUP_WINDOW_MS = 10000;        // collapse a CRITICAL line + its fired flip

function readJSON(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

interface ParsedAlert { ts: string; sev: string; rest: string; }
function parseAlert(line: string): ParsedAlert | null {
  const m = line.match(/^\[([^\]]+)\]\s+\[(\w+)\]\s+(.*)$/);
  return m ? { ts: m[1], sev: m[2], rest: m[3] } : null;
}

// Label a raw alert line with its age at DELIVERY time. A 2-day-old line replayed
// from the log must never read as breaking news (the audit caught exactly that).
const STALE_AFTER_MS = 10 * 60 * 1000;
function ageLabel(tsIso: string, nowMs: number): string {
  const ms = Date.parse(tsIso);
  if (!Number.isFinite(ms)) return '(unknown age — treat as stale; verify before acting)';
  if (nowMs - ms > STALE_AFTER_MS) {
    return `(⚠️ STALE — from ${relativeAge(ms, nowMs)}, ${formatIst(ms, nowMs)}; verify with a fresh quote before acting)`;
  }
  return `(fired ${relativeAge(ms, nowMs)})`;
}

// First all-caps token in a string = the monitor's symbol/label (e.g. "PARAS").
// No hyphens, so both paths normalize to the same key for dedup: a CRITICAL
// line "PARAS invalidation" and a state file "paras-scenario-a" both -> "PARAS".
function labelOf(text: string): string {
  const m = (text || '').toUpperCase().match(/[A-Z][A-Z0-9]{2,}/);
  return m ? m[0] : '';
}

function monitorNameFromState(file: string): string {
  return file.replace(/\.(state\.)?json$/i, '').replace(/^\.state_/i, '');
}

export function setupAlertBridge(api: ExtensionAPI) {
  api.on("session_start", async (_event: any, ctx: any) => {
    // Start from the CURRENT end of the log so we only react to events that
    // happen during this session — not replay everything from the day.
    let offset = 0;
    try { offset = fs.statSync(ALERTS).size; } catch {}

    // Seed fired-state so we don't fire for monitors already terminal at launch.
    const firedState = new Map<string, boolean>();
    try {
      for (const f of fs.readdirSync(STATE_DIR)) {
        if (!f.endsWith('.json')) continue;
        const s = readJSON(path.join(STATE_DIR, f));
        firedState.set(f, !!(s && s.fired));
      }
    } catch { /* dir may not exist yet */ }

    const firedSeen = new Set<string>();
    const recent: Array<{ label: string; t: number }> = [];

    const wokeRecently = (label: string, nowMs: number): boolean => {
      while (recent.length && nowMs - recent[0].t > DEDUP_WINDOW_MS) recent.shift();
      return label !== '' && recent.some(r => r.label === label);
    };

    const wake = (headline: string, raw: string, labels: string[]) => {
      const nowMs = Date.now();
      for (const label of labels) recent.push({ label, t: nowMs });
      api.sendMessage(
        {
          customType: "overwatch-monitor",
          content:
            `[OVERWATCH MONITOR EVENT] ${headline}\n\n` +
            `Raw alert(s):\n${raw}\n\n` +
            `ACT NOW (surface + summarize): tell the user what fired, in plain language, ` +
            `with a ONE-LINE read of what it means for the position/thesis. Respect each ` +
            `alert's age label — a STALE alert is history, not breaking news. Do NOT pull ` +
            `fresh data or run the full risk gate yet — end by offering to run the live ` +
            `risk gate if they want to act.`,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    };

    const poll = () => {
      const nowMs = Date.now();

      // 1) New CRITICAL alert lines appended since we last looked — batched into
      //    ONE wake per tail pass (a burst used to wake the model once per line),
      //    each line labeled with its age at delivery time.
      try {
        const size = fs.statSync(ALERTS).size;
        if (size < offset) offset = size;            // truncated / rotated
        if (size > offset) {
          const fd = fs.openSync(ALERTS, 'r');
          const buf = Buffer.alloc(size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = size;
          const criticals: Array<{ line: string; a: ParsedAlert }> = [];
          for (const line of buf.toString('utf8').split('\n')) {
            const a = parseAlert(line.trim());
            if (a && a.sev === 'CRITICAL') criticals.push({ line: line.trim(), a });
          }
          if (criticals.length) {
            const raw = criticals.map(({ line, a }) => `${line} ${ageLabel(a.ts, nowMs)}`).join('\n');
            const headline = criticals.length === 1
              ? 'A monitor raised a CRITICAL alert.'
              : `${criticals.length} CRITICAL monitor alerts (oldest first).`;
            wake(headline, raw, criticals.map(({ a }) => labelOf(a.rest)));
          }
        }
      } catch { /* alerts.log may not exist yet */ }

      // 2) State files flipping fired:false -> true (terminal, any severity).
      //    Skips if the CRITICAL path already woke for the same monitor.
      try {
        for (const f of fs.readdirSync(STATE_DIR)) {
          if (!f.endsWith('.json') || !/state/i.test(f)) continue;
          const s = readJSON(path.join(STATE_DIR, f));
          const nowFired = !!(s && s.fired);
          const was = firedState.get(f) || false;
          firedState.set(f, nowFired);
          if (nowFired && !was) {
            const name = monitorNameFromState(f);
            const key = `${f}:${s && s.confirmedAt ? s.confirmedAt : nowMs}`;
            if (firedSeen.has(key)) continue;
            firedSeen.add(key);
            if (wokeRecently(labelOf(name.toUpperCase()), nowMs)) continue;
            wake(
              `Monitor "${name}" reached a TERMINAL condition (one-shot fired).`,
              `state ${f}: ${JSON.stringify(s)}`,
              [labelOf(name.toUpperCase())],
            );
          }
        }
      } catch { /* state dir may not exist yet */ }
    };

    const timer = setInterval(poll, POLL_MS);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();

    if (ctx && ctx.hasUI && ctx.ui && typeof ctx.ui.notify === 'function') {
      ctx.ui.notify('Overwatch alert-bridge armed — watching for CRITICAL + fired events.', 'info');
    }
  });
}
