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
  /** True for a terminal fire (vs a heads-up / blind escalation). */
  terminal?: boolean;
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
}
