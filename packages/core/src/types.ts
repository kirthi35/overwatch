// @overwatch/core — shared domain types + the per-user context that parameterizes
// the doctrine for multi-tenancy. Field names mirror the on-disk shapes used today
// (~/.overwatch/monitors/*.json, alerts.log) so the doctrine logic is untouched.

export interface MonitorGates {
  /** LTP under this -> CRITICAL, terminal (invalidation). */
  stop_below?: number;
  /** [lo, hi] entry zone. In-zone + green (if required) + book under cap -> CRITICAL, terminal. */
  zone?: [number, number];
  /** Require the last candle green for the zone entry gate. Needs candle_interval. */
  require_green_candle?: boolean;
  /** Order-book sell:buy cap for the zone entry gate (e.g. 3.0). */
  max_sell_buy_ratio?: number;
  /** LTP over this -> WARNING, non-terminal heads-up (fires once). */
  breakout_above?: number;
}

/** Hot, per-tick monitor state. Lives in the worker's hot cache; flushed to the
 *  durable store only on transitions + a throttled heartbeat. */
export interface MonitorState {
  fired: boolean;
  consecutiveFails: number;
  blindLevel: 'WARNING' | 'CRITICAL' | null;
  lastAlertedFail: number;
  breakoutAlerted: boolean;
  lastPoll?: number;
  lastError?: string | null;
  lastLtp?: number;
  lastRatio?: number;
  lastGreen?: boolean;
  confirmedAt?: string;
}

export interface Monitor {
  name: string;
  symbol: string;
  search_query: string;
  segment: string;
  mode: 'in-session' | 'daemon';
  poll_minutes: number;
  time_gate_ist?: number;
  candle_interval?: number;
  disabled?: boolean;
  /** The conversation this monitor was armed from — used to route fires back into chat. */
  conversationId?: string;
  /** The trade this monitor watches — the audit spine (ADR 0005). Fires inherit it. */
  tradeId?: string;
  gates: MonitorGates;
  state?: MonitorState;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
  ts: string;
  severity: AlertSeverity;
  label?: string;
  message: string;
  monitorName?: string;
  conversationId?: string;
  /** The trade this alert belongs to (ADR 0005) — inherited from the firing monitor. */
  tradeId?: string;
  /** True for a terminal fire (vs a heads-up / blind escalation). */
  terminal?: boolean;
}

/** One closed-trade record — the feedback loop the trade-journal skill appends on every
 *  CLOSE. Fields mirror the skill's schema; most are optional so backfilled/partial rows
 *  (e.g. an OPEN position awaiting its close) are representable. `realized_R` is null until
 *  the trade actually closes — expectancy math MUST skip null-R rows. */
export interface JournalRecord {
  symbol: string;
  entry_date?: string | null;
  exit_date?: string | null;
  entry?: number | null;
  stop_initial?: number | null;
  stop_final?: number | null;
  exit_price?: number | null;
  shares?: number | null;
  planned_R?: number | null;
  realized_R?: number | null;
  hold_days?: number | null;
  mode?: string | null;
  regime_state_at_entry?: string | null;
  gates_passed?: string[];
  gates_overridden?: string[];
  adherence_score?: number | null;
  one_line_lesson?: string;
  status?: 'OPEN' | 'CLOSED';
  /** ISO timestamp the record was written — used to order the CLOSED view. */
  ts?: string;
}

// ── Trade audit spine (ADR 0005) ────────────────────────────────────────────────────
export type TradeStatus = 'WATCHING' | 'CARDED' | 'OPEN' | 'CLOSED' | 'ABANDONED';
export type ThesisVerdict = 'RIGHT' | 'WRONG' | 'PARTIAL';

/** The thesis "why" — carried with the trade from WATCHING all the way to CLOSED so the
 *  audit always shows why we entered next to what happened. */
export interface TradeThesis {
  why?: string; // one-line driver
  archetype?: string;
  claims?: string[];
  break_triggers?: string[];
  [k: string]: unknown;
}
export interface TradeCard {
  mode?: 'DIP' | 'BREAKOUT' | string;
  entry_zone?: number[];
  stop?: number;
  T1?: number;
  T2?: number;
  shares?: number;
  risk_budget?: number;
  hold_deadline?: string;
  [k: string]: unknown;
}
export interface TradePosition {
  entry?: number;
  stop?: number;
  shares?: number;
  openedAt?: string;
  [k: string]: unknown;
}
export interface TradeGates {
  passed?: string[];
  /** MUST be empty per the standing orders — non-empty = adherence failure. */
  overridden?: string[];
}
export interface TradeClose {
  exit_price?: number | null;
  exit_date?: string | null;
  realized_R?: number | null;
  hold_days?: number | null;
  /** Did the driver actually play out? AI proposes, operator confirms (ADR 0005 D3). */
  thesis_verdict?: ThesisVerdict;
  /** Were the rules followed? Derived: true iff gates.overridden is empty. */
  adherent?: boolean;
  one_line_lesson?: string;
}

/** A trade — the audit spine. card / position / gates / close accrete as it advances;
 *  monitors + alerts reference it by `tradeId`; `conversationId` links the chat that
 *  produced it. journal = trades where status==CLOSED. */
export interface Trade {
  tradeId: string;
  symbol: string;
  conversationId?: string;
  status: TradeStatus;
  /** Standing Order 7 re-entry: a new trade referencing the prior one. */
  reentryOf?: string;
  thesis?: TradeThesis;
  card?: TradeCard;
  position?: TradePosition;
  gates?: TradeGates;
  close?: TradeClose;
  createdAt?: string;
  updatedAt?: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  minSeverity: AlertSeverity;
}

export interface OllamaConfig {
  apiKey: string;
  baseUrl: string;
  models: string[];
  modelId: string;
}

/** Everything one user's agent session (or the worker, on that user's behalf) needs.
 *  Constructed per-user — never global. Replaces the process.env credential channel. */
export interface UserContext {
  uid: string;
  /** The conversation this session belongs to, if any — stamped onto monitors armed
   *  in-session so a later fire can be routed back into this conversation. The CLI
   *  leaves it undefined (no conversation concept). */
  conversationId?: string;
  /** Decrypted Groww read-only token — in-memory only, never persisted in the clear. */
  growwToken: string;
  llm: {
    provider: 'claude' | 'glm';
    anthropicKey?: string;
    ollama?: OllamaConfig;
  };
  telegram?: TelegramConfig;
  /** uid-scoped durable store (FileStore for the CLI, FirestoreStore for the server). */
  store: OverwatchStore;
  /** Global read-only doctrine skills directory. */
  skillsDir: string;
  /** Optional hook invoked after a monitor is armed. The CLI wires this to spawn its
   *  local monitord; the server leaves it undefined (the worker polls Firestore). */
  onMonitorArmed?: (monitorName: string) => void;
}

/** The uid-scoped persistence seam. FileStore (CLI, local files) and FirestoreStore
 *  (server, per-user docs) implement it; the doctrine tools depend only on this. */
export interface OverwatchStore {
  putMonitor(name: string, monitor: Monitor): Promise<void>;
  deleteMonitor(name: string): Promise<boolean>;
  getMonitor(name: string): Promise<Monitor | null>;
  listMonitors(): Promise<Monitor[]>;
  appendAlert(alert: Alert): Promise<void>;
  putThesis(id: string, doc: unknown): Promise<void>;
  getThesis(id: string): Promise<unknown | null>;
  /** Append one closed-trade record. LEGACY — superseded by the trade spine (putTrade
   *  with status CLOSED, ADR 0005); kept for back-compat. */
  appendJournal(record: JournalRecord): Promise<void>;
  /** The trade audit spine (ADR 0005). putTrade upsert-MERGES the partial into the
   *  existing trade (or creates it); the Trades tab reads listTrades() and groups by
   *  status. journal = trades where status==CLOSED. */
  putTrade(trade: Trade): Promise<void>;
  getTrade(tradeId: string): Promise<Trade | null>;
  listTrades(): Promise<Trade[]>;
}
