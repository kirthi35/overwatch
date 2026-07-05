import { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { notifyTelegram } from './telegram.js';
import { UserContext, Monitor, AlertSeverity, JournalRecord } from './types.js';

// Custom (non-Groww) tools, parameterized by UserContext so each agent session
// writes to that user's own store (FileStore for the CLI, FirestoreStore for the
// server). Monitor daemon spawning is NOT done here anymore — the CLI wires
// u.onMonitorArmed to start its local monitord; the server leaves it undefined
// (the multi-tenant worker polls the store instead).
export function registerCustomTools(api: ExtensionAPI, u: UserContext) {
  api.registerTool({
    name: 'console_log_alert',
    label: 'Console Log Alert',
    description:
      "Sends an alert to the user and records it. Use this to notify the user of any important " +
      'market events or daemon monitoring alerts.',
    parameters: Type.Object({
      message: Type.String({ description: 'The alert message to display to the user' }),
      severity: Type.String({ description: 'INFO, WARNING, or CRITICAL' }),
    }),
    execute: async (_toolCallId, args) => {
      const ts = new Date().toISOString();
      const severity = (args.severity || 'INFO').toUpperCase() as AlertSeverity;
      await u.store.appendAlert({ ts, severity, message: args.message, conversationId: u.conversationId });
      // Deliver to Telegram too (no-op if this user has no config; severity-gated).
      void notifyTelegram({ message: args.message, severity }, u.telegram);
      return {
        content: [{ type: 'text', text: 'Alert successfully logged and delivered to the user.' }],
        details: { logged: true },
      };
    },
  });

  // arm_monitor — the PROPER way to start watching a symbol. Writes a validated
  // monitor to the store; the CLI's onMonitorArmed hook ensures its local daemon,
  // while the server's monitor worker picks it up from the store on its next tick.
  api.registerTool({
    name: 'arm_monitor',
    label: 'Arm Monitor',
    description:
      "Arm a price monitor on an NSE symbol. Writes a validated monitor to the workspace; a " +
      'background poller evaluates the gates during market hours (no LLM in the loop) and ' +
      'alerts on a fire — it survives the CLI/session closing. USE THIS instead of writing the ' +
      'monitor JSON by hand. Include only the gates the thesis needs; at least one gate is required. ',
    parameters: Type.Object({
      name: Type.String({ description: "Unique monitor id in kebab-case (e.g. 'paras-scenario-a'). Reused as the id; re-arming the same name overwrites it." }),
      symbol: Type.String({ description: "Ticker shown in alerts (e.g. 'PARAS')." }),
      search_query: Type.String({ description: "Groww search query for the instrument (e.g. 'Paras Defence')." }),
      segment: Type.Optional(Type.String({ description: "Groww segment. Default 'CASH'." })),
      poll_minutes: Type.Optional(Type.Number({ description: 'Poll cadence in minutes during market hours. Default 1 (every minute).' })),
      time_gate_ist: Type.Optional(Type.Number({ description: "IST HHMM; don't evaluate before this (e.g. 935 to skip opening noise). Omit for none." })),
      candle_interval: Type.Optional(Type.Number({ description: 'Candle interval in minutes for the green-candle check (e.g. 15). Required if gates.require_green_candle is set.' })),
      mode: Type.Optional(Type.String({ description: "'in-session' (default) or 'daemon' (a bespoke daemon owns it; the shared poller skips it)." })),
      gates: Type.Object({
        stop_below: Type.Optional(Type.Number({ description: 'LTP under this -> CRITICAL, terminal (invalidation).' })),
        zone: Type.Optional(Type.Array(Type.Number(), { description: '[lo, hi] entry zone. LTP inside + green (if required) + book under cap -> CRITICAL, terminal.' })),
        require_green_candle: Type.Optional(Type.Boolean({ description: 'Require the last candle green for the zone entry gate. Needs candle_interval.' })),
        max_sell_buy_ratio: Type.Optional(Type.Number({ description: 'Order-book sell:buy cap for the zone entry gate (e.g. 3.0).' })),
        breakout_above: Type.Optional(Type.Number({ description: 'LTP over this -> WARNING, non-terminal heads-up (fires once).' })),
      }, { description: 'Gate thresholds. All optional; include only what the thesis needs. At least one gate is required.' }),
    }),
    execute: async (_toolCallId, args: any) => {
      const g = args.gates || {};
      const hasGate = ['stop_below', 'zone', 'require_green_candle', 'max_sell_buy_ratio', 'breakout_above']
        .some((k) => g[k] !== undefined && g[k] !== null);
      if (!hasGate) {
        return { content: [{ type: 'text', text: 'arm_monitor: refused — no gates given. Supply at least one of stop_below, zone, or breakout_above.' }], details: { armed: false, name: undefined as string | undefined } };
      }
      if (g.require_green_candle && args.candle_interval === undefined) {
        return { content: [{ type: 'text', text: 'arm_monitor: refused — require_green_candle needs candle_interval (e.g. 15) so the poller can fetch candles.' }], details: { armed: false, name: undefined as string | undefined } };
      }

      const monitor: Monitor = {
        name: args.name,
        symbol: args.symbol,
        search_query: args.search_query,
        segment: args.segment || 'CASH',
        mode: args.mode === 'daemon' ? 'daemon' : 'in-session',
        poll_minutes: args.poll_minutes && args.poll_minutes > 0 ? args.poll_minutes : 1,
        gates: g,
      };
      if (args.time_gate_ist !== undefined) monitor.time_gate_ist = args.time_gate_ist;
      if (args.candle_interval !== undefined) monitor.candle_interval = args.candle_interval;
      if (u.conversationId) monitor.conversationId = u.conversationId;

      try {
        await u.store.putMonitor(monitor.name, monitor);
        // CLI: spawn/ensure local monitord. Server: no-op (worker polls the store).
        u.onMonitorArmed?.(monitor.name);
        const gateList = Object.entries(g)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        const summary =
          `Armed ${monitor.symbol} (${monitor.name}) — poll ${monitor.poll_minutes}m` +
          `${monitor.time_gate_ist ? `, after ${monitor.time_gate_ist} IST` : ''}. Gates: ${gateList}. ` +
          `It evaluates during NSE hours and survives this session closing.`;
        return { content: [{ type: 'text', text: summary }], details: { armed: true, name: monitor.name } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `arm_monitor: failed to write monitor — ${e.message}` }], details: { armed: false, name: undefined as string | undefined } };
      }
    },
  });

  // disarm_monitor — stop watching a symbol by deleting its stored monitor.
  api.registerTool({
    name: 'disarm_monitor',
    label: 'Disarm Monitor',
    description: 'Stop a monitor by name. Deletes it from the workspace so the poller stops evaluating it on its next tick.',
    parameters: Type.Object({
      name: Type.String({ description: "The monitor id used when arming (e.g. 'paras-scenario-a')." }),
    }),
    execute: async (_toolCallId, args: any) => {
      try {
        const existed = await u.store.deleteMonitor(args.name);
        if (!existed) {
          return { content: [{ type: 'text', text: `disarm_monitor: no monitor named '${args.name}'. Nothing to do.` }], details: { disarmed: false } };
        }
        return { content: [{ type: 'text', text: `Disarmed '${args.name}'. The poller drops it on the next tick.` }], details: { disarmed: true } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `disarm_monitor: failed — ${e.message}` }], details: { disarmed: false } };
      }
    },
  });

  // list_monitors — READ the user's armed monitors + their last-polled state, so the
  // model never has to shell out (`cat monitors/*.json`) to inspect them. The returned
  // state is CONFIG + a PAST reading written by the background worker — NOT a live
  // quote (DATA INTEGRITY rule 3); the tool labels each with its lastPoll + a STALE hint.
  api.registerTool({
    name: 'list_monitors',
    label: 'List Monitors',
    description:
      'List the currently armed monitors and their last-polled state (lastLtp, lastPoll, ' +
      'fired, breakoutAlerted, blindLevel, consecutiveFails). This is CONFIG plus a PAST, ' +
      'timestamped reading — NOT a live quote. To get the live price, use the Groww quote ' +
      'tool. Optionally pass a name to inspect a single monitor.',
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: 'Inspect only this monitor (its arm id). Omit to list all.' })),
    }),
    execute: async (_toolCallId, args: any) => {
      try {
        const monitors: Monitor[] = args?.name
          ? ([await u.store.getMonitor(args.name)].filter(Boolean) as Monitor[])
          : await u.store.listMonitors();
        if (monitors.length === 0) {
          const text = args?.name ? `No monitor named '${args.name}'.` : 'No monitors are currently armed.';
          return { content: [{ type: 'text', text }], details: { count: 0, monitors: [] as any[] } };
        }
        const view = monitors.map((m) => {
          const st = m.state || ({} as NonNullable<Monitor['state']>);
          const lastPollIso = st.lastPoll ? new Date(st.lastPoll).toISOString() : null;
          return {
            name: m.name,
            symbol: m.symbol,
            mode: m.mode,
            poll_minutes: m.poll_minutes,
            time_gate_ist: m.time_gate_ist,
            conversationId: m.conversationId,
            gates: m.gates,
            state: {
              fired: st.fired ?? false,
              breakoutAlerted: st.breakoutAlerted ?? false,
              blindLevel: st.blindLevel ?? null,
              consecutiveFails: st.consecutiveFails ?? 0,
              // These are STALE readings — labelled so the model never cites them as live.
              lastLtp_STALE: st.lastLtp ?? null,
              lastRatio_STALE: st.lastRatio ?? null,
              lastGreen_STALE: st.lastGreen ?? null,
              lastPoll: lastPollIso,
              lastError: st.lastError ?? null,
              confirmedAt: st.confirmedAt ?? null,
            },
          };
        });
        const summary = view
          .map((m) => {
            const s = m.state;
            const ltp = s.lastLtp_STALE != null ? `₹${s.lastLtp_STALE} (last polled ${s.lastPoll || 'never'}, STALE)` : 'no reading yet';
            const status = s.fired ? 'FIRED' : s.blindLevel ? `BLIND:${s.blindLevel}` : 'armed';
            return `- ${m.symbol} (${m.name}): ${status}; ${ltp}`;
          })
          .join('\n');
        return {
          content: [{ type: 'text', text: `${monitors.length} monitor(s). These are STALE, last-polled readings — NOT live quotes:\n${summary}` }],
          details: { count: monitors.length, monitors: view as any[] },
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `list_monitors: failed — ${e.message}` }], details: { count: 0, monitors: [] as any[] } };
      }
    },
  });

  // write_thesis — persist a per-symbol thesis / trade-card / active-position JSON.
  // Replaces the old shell-write-to-~/.overwatch path so the built-in bash/write
  // tools can be disabled on a shared multi-tenant host (see the server build).
  api.registerTool({
    name: 'write_thesis',
    label: 'Write Thesis',
    description:
      'Persist a per-symbol thesis, trade-card, or active-position JSON document to the workspace. ' +
      "Use this instead of writing files by hand. `id` is the document id / filename stem " +
      "(e.g. 'paras', 'paras-card', 'paras-active-position'); `doc` is the JSON object.",
    parameters: Type.Object({
      id: Type.String({ description: "Document id / filename stem, kebab-case (e.g. 'paras-card')." }),
      doc: Type.Any({ description: 'The thesis/card/position JSON object to store.' }),
    }),
    execute: async (_toolCallId, args: any) => {
      try {
        // Normalize doc: models sometimes pass a JSON string; Firestore needs a plain
        // object at the top level (not a string/array/primitive).
        let doc: unknown = args.doc;
        if (typeof doc === 'string') {
          try {
            doc = JSON.parse(doc);
          } catch {
            doc = { text: doc };
          }
        }
        if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
          doc = { value: doc };
        }
        await u.store.putThesis(args.id, doc);
        return { content: [{ type: 'text', text: `Wrote thesis '${args.id}'.` }], details: { written: true, id: args.id } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `write_thesis: failed — ${e.message}` }], details: { written: false, id: undefined as string | undefined } };
      }
    },
  });

  // append_journal — record ONE closed-trade to the journal (trade-journal skill).
  // Append-only: FileStore -> theses/journal.jsonl, FirestoreStore -> users/{uid}/journal.
  // This is the CLOSED lifecycle stage + the expectancy/adherence feed the Trades tab reads.
  api.registerTool({
    name: 'append_journal',
    label: 'Append Journal',
    description:
      'Record ONE closed-trade to the journal on every trade CLOSE (stop, target, time-stop, ' +
      'or manual exit). `record` fields: symbol (required), entry_date, exit_date, entry, ' +
      'stop_initial, stop_final, exit_price, shares, planned_R, realized_R, hold_days, mode ' +
      '(DIP|BREAKOUT), regime_state_at_entry, gates_passed[], gates_overridden[] (MUST be empty ' +
      'per standing orders), adherence_score, one_line_lesson, status (OPEN|CLOSED). Never places an order.',
    parameters: Type.Object({
      record: Type.Any({ description: 'The closed-trade journal record object (symbol required).' }),
    }),
    execute: async (_toolCallId, args: any) => {
      try {
        let rec: unknown = args.record;
        if (typeof rec === 'string') {
          try { rec = JSON.parse(rec); } catch { /* handled below */ }
        }
        if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
          return { content: [{ type: 'text', text: 'append_journal: failed — record must be an object.' }], details: { written: false, symbol: undefined as string | undefined } };
        }
        const symbol = (rec as Record<string, unknown>).symbol;
        if (typeof symbol !== 'string' || !symbol.trim()) {
          return { content: [{ type: 'text', text: 'append_journal: failed — record.symbol is required.' }], details: { written: false, symbol: undefined as string | undefined } };
        }
        await u.store.appendJournal(rec as JournalRecord);
        return { content: [{ type: 'text', text: `Recorded journal entry for '${symbol}'.` }], details: { written: true, symbol: symbol as string | undefined } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `append_journal: failed — ${e.message}` }], details: { written: false, symbol: undefined as string | undefined } };
      }
    },
  });
}
