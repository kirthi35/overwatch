import { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { notifyTelegram } from './telegram.js';
import { UserContext, Monitor, AlertSeverity, JournalRecord, Trade } from './types.js';
import { mergeTrade, isAdherent, assertTradeConsistent } from './trade.js';
import { formatIst } from './time.js';

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
      tradeId: Type.Optional(Type.String({ description: 'The trade this monitor watches (from upsert_trade). Links the monitor + its fired alerts to that trade for the weekly audit (ADR 0005).' })),
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
      // Failures THROW (here and in every write tool below): Pi flags a thrown
      // error as an isError tool result, which the model cannot misread as
      // success — the audit caught it describing failed writes as done.
      if (!hasGate) {
        throw new Error('❌ arm_monitor REFUSED — NO monitor was armed. Supply at least one of stop_below, zone, or breakout_above. You MUST tell the user no monitor is watching this.');
      }
      if (g.require_green_candle && args.candle_interval === undefined) {
        throw new Error('❌ arm_monitor REFUSED — NO monitor was armed. require_green_candle needs candle_interval (e.g. 15) so the poller can fetch candles. You MUST tell the user no monitor is watching this.');
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
      if (args.tradeId) monitor.tradeId = args.tradeId;

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
          `It evaluates during NSE hours and survives this session closing. ` +
          `⚠️ Alerts fire at THESE armed gates — restate them to the user and reconcile ` +
          `with any stop you quoted in your analysis (re-arm if they differ).`;
        return { content: [{ type: 'text', text: summary }], details: { armed: true, name: monitor.name } };
      } catch (e: any) {
        throw new Error(`❌ arm_monitor FAILED — the monitor was NOT armed and nothing is watching ${args.symbol}. Reason: ${e.message}. You MUST tell the user this write failed; do not describe the monitor as armed or watching.`);
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
        throw new Error(`❌ disarm_monitor FAILED — the monitor '${args.name}' was NOT removed and may still fire alerts. Reason: ${e.message}. You MUST tell the user this failed.`);
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
        const now = Date.now();
        const summary = view
          .map((m) => {
            const s = m.state;
            // Absolute IST stamp + day label + relative age: the bare ISO form let the
            // model read yesterday's 15:30 close-of-market poll as "today ~3:30 PM".
            const polled = s.lastPoll ? formatIst(s.lastPoll, now) : 'never';
            const ltp = s.lastLtp_STALE != null ? `₹${s.lastLtp_STALE} (last polled ${polled}, STALE)` : 'no reading yet';
            const status = s.fired
              ? 'FIRED (terminal — polling STOPPED; this monitor will never alert again)'
              : s.blindLevel
                ? `BLIND:${s.blindLevel}`
                : 'armed';
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
        throw new Error(`❌ write_thesis FAILED — NOTHING WAS SAVED for '${args.id}'. Reason: ${e.message}. You MUST tell the user this write failed; do not describe the thesis as recorded.`);
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
          throw new Error('❌ append_journal FAILED — NOTHING WAS RECORDED: record must be an object. You MUST tell the user the journal entry was not saved.');
        }
        const symbol = (rec as Record<string, unknown>).symbol;
        if (typeof symbol !== 'string' || !symbol.trim()) {
          throw new Error('❌ append_journal FAILED — NOTHING WAS RECORDED: record.symbol is required. You MUST tell the user the journal entry was not saved.');
        }
        await u.store.appendJournal(rec as JournalRecord);
        return { content: [{ type: 'text', text: `Recorded journal entry for '${symbol}'.` }], details: { written: true, symbol: symbol as string | undefined } };
      } catch (e: any) {
        if (/append_journal FAILED/.test(e.message)) throw e;
        throw new Error(`❌ append_journal FAILED — NOTHING WAS RECORDED. Reason: ${e.message}. You MUST tell the user the journal entry was not saved.`);
      }
    },
  });

  // upsert_trade — create or advance a trade (the audit spine, ADR 0005). Mints a stable
  // tradeId on first write, stamps the conversation, carries thesis/card/position/gates.
  // Pass the SAME tradeId to arm_monitor + later updates so the whole trade stays linked.
  api.registerTool({
    name: 'upsert_trade',
    label: 'Upsert Trade',
    description:
      'Create or advance a trade record — the audit spine. Call as it moves through the ' +
      'lifecycle: WATCHING (thesis) → CARDED (card) → OPEN (position). Returns a stable tradeId; ' +
      'pass it back on later calls AND to arm_monitor so the whole trade — thesis, plan, gates, ' +
      'monitors, alerts — stays linked for the weekly audit. Records only — never places an order.',
    parameters: Type.Object({
      tradeId: Type.Optional(Type.String({ description: 'Existing trade id to advance. Omit to create a new trade.' })),
      symbol: Type.String({ description: "Ticker (e.g. 'PARAS')." }),
      status: Type.Optional(Type.String({ description: 'WATCHING | CARDED | OPEN | ABANDONED. Defaults WATCHING on create. OPEN requires position; use close_trade to close.' })),
      reentryOf: Type.Optional(Type.String({ description: 'Prior tradeId this re-entry follows (Standing Order 7).' })),
      thesis: Type.Optional(Type.Any({ description: 'Thesis "why": {why, archetype, claims[], break_triggers[]}. Carried to the close.' })),
      card: Type.Optional(Type.Any({ description: 'Trade card: {mode, entry_zone:[lo,hi], stop, T1, T2, shares, risk_budget, hold_deadline}.' })),
      position: Type.Optional(Type.Any({ description: 'Open position: {entry, stop, shares}. Set with status OPEN.' })),
      gates: Type.Optional(Type.Any({ description: 'Gates: {passed:[...], overridden:[...]}. overridden MUST be empty per the standing orders.' })),
    }),
    execute: async (_toolCallId, args: any) => {
      try {
        const tradeId = args.tradeId || `${(args.symbol || 'trade').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
        const prev = args.tradeId ? ((await u.store.getTrade(tradeId)) as Trade | null) : null;
        const now = new Date().toISOString();
        const patch: any = { tradeId, symbol: args.symbol };
        if (args.status) patch.status = String(args.status).toUpperCase();
        if (args.reentryOf) patch.reentryOf = args.reentryOf;
        for (const k of ['thesis', 'card', 'position', 'gates'] as const) {
          if (args[k] && typeof args[k] === 'object') patch[k] = args[k];
        }
        const merged = mergeTrade(prev, patch);
        if (!merged.status) merged.status = 'WATCHING';
        if (u.conversationId && !merged.conversationId) merged.conversationId = u.conversationId;
        merged.createdAt = prev?.createdAt || now;
        merged.updatedAt = now;
        assertTradeConsistent(merged);
        await u.store.putTrade(merged);
        return { content: [{ type: 'text', text: `Trade ${tradeId} (${merged.symbol}) → ${merged.status}. Reuse tradeId "${tradeId}" for arm_monitor + later updates.` }], details: { tradeId: tradeId as string | undefined, status: merged.status as string | undefined } };
      } catch (e: any) {
        throw new Error(`❌ upsert_trade FAILED — NOTHING WAS SAVED. Reason: ${e.message}. The trade record does NOT exist/was NOT updated, and no monitor or audit trail is tracking it. You MUST tell the user this write failed; do not describe the trade as recorded, logged, or tracked.`);
      }
    },
  });

  // close_trade — record a CLOSE + the audit verdict (ADR 0005). thesis_verdict is the
  // operator-confirmed judgment; `adherent` is derived from the trade's own gates.
  api.registerTool({
    name: 'close_trade',
    label: 'Close Trade',
    description:
      'Record a trade CLOSE + the audit verdict on every exit (stop, target, time-stop, or ' +
      'manual). Sets status CLOSED. thesis_verdict (RIGHT|WRONG|PARTIAL) = did the driver play ' +
      'out (operator-confirmed). "Rules followed?" is derived from the trade\'s gates. This is ' +
      'the feedback loop the weekly audit reads. Records only — never places an order.',
    parameters: Type.Object({
      tradeId: Type.String({ description: 'The trade to close (from upsert_trade).' }),
      exit_price: Type.Optional(Type.Number({ description: 'Exit price.' })),
      exit_date: Type.Optional(Type.String({ description: 'Exit date (YYYY-MM-DD).' })),
      realized_R: Type.Optional(Type.Number({ description: 'Realized R = (exit − entry) ÷ (entry − initial stop).' })),
      hold_days: Type.Optional(Type.Number({ description: 'Days held.' })),
      thesis_verdict: Type.Optional(Type.String({ description: 'RIGHT | WRONG | PARTIAL — did the driver actually play out (operator-confirmed).' })),
      one_line_lesson: Type.Optional(Type.String({ description: 'The takeaway.' })),
    }),
    execute: async (_toolCallId, args: any) => {
      try {
        const prev = (await u.store.getTrade(args.tradeId)) as Trade | null;
        if (!prev) {
          throw new Error(`❌ close_trade FAILED — no trade "${args.tradeId}" exists; NOTHING WAS CLOSED. Create it with upsert_trade first. You MUST tell the user the trade was not closed.`);
        }
        const close: any = {};
        if (args.exit_price !== undefined) close.exit_price = args.exit_price;
        if (args.exit_date !== undefined) close.exit_date = args.exit_date;
        if (args.realized_R !== undefined) close.realized_R = args.realized_R;
        if (args.hold_days !== undefined) close.hold_days = args.hold_days;
        if (args.thesis_verdict) close.thesis_verdict = String(args.thesis_verdict).toUpperCase();
        if (args.one_line_lesson) close.one_line_lesson = args.one_line_lesson;
        close.adherent = isAdherent(prev.gates);
        const merged = mergeTrade(prev, { tradeId: args.tradeId, status: 'CLOSED', close });
        merged.updatedAt = new Date().toISOString();
        assertTradeConsistent(merged);
        await u.store.putTrade(merged);
        const adh = close.adherent ? 'rules FOLLOWED' : 'rules OVERRIDDEN (adherence failure)';
        return { content: [{ type: 'text', text: `Closed ${merged.symbol} — ${args.realized_R != null ? args.realized_R + 'R, ' : ''}thesis ${close.thesis_verdict || '?'}, ${adh}.` }], details: { closed: true, adherent: close.adherent as boolean | undefined } };
      } catch (e: any) {
        if (/close_trade FAILED/.test(e.message)) throw e;
        throw new Error(`❌ close_trade FAILED — the trade was NOT closed and NOTHING WAS SAVED. Reason: ${e.message}. You MUST tell the user this write failed; do not describe the trade as closed.`);
      }
    },
  });
}
