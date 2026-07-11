import { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Type } from '@sinclair/typebox';

const GROWW_MCP_URL = 'https://mcp.groww.in/mcp';

// Resilience budget. A dead feed must fail LOUD and FAST, never hang or vanish
// silently (the failure mode that let the model fabricate live prices).
const CONNECT_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MS = 20000;
const CONNECT_ATTEMPTS = 3; // total connect tries before declaring blind
const RECONNECT_BACKOFF_MS = 800;

export interface GrowwStatus {
  ready: boolean;
  toolCount: number;
  lastError: string | null;
  connectedAt: number | null;
}

// ---- small helpers (pure, module-level) -----------------------------------
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// A connection-level failure (vs. a per-tool backend error). Triggers a reconnect.
export function isConnError(msg: string): boolean {
  return /timed out|terminated|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|not connected|fetch failed|network|502|503|504|closed/i.test(
    msg || '',
  );
}

// Classify a THROWN tool failure so 429/500 don't get promoted to a full feed
// blackout. Order matters: "Network error: 500 …" contains "network", so the
// rate/backend checks must run BEFORE the conn check. 502/503/504 stay 'conn'
// (gateway-level → reconnect makes sense); 429/500 mean the connection is UP.
// The \b500\b variants are anchored to error-ish context so a price like
// "LTP 1500" or "24,500" can never classify as a backend error.
export function classifyToolFailure(msg: string): 'conn' | 'rate' | 'backend' | 'unknown' {
  const m = msg || '';
  if (/\b429\b|too many requests|rate.?limit/i.test(m)) return 'rate';
  if (/internal server error|error[:\s]+500\b|\bHTTP\s*500\b|\bstatus\s*[:=]?\s*500\b|\b500\s+internal\b/i.test(m)) return 'backend';
  if (isConnError(m)) return 'conn';
  return 'unknown';
}

// Single retry delay when Groww rate-limits (429). One retry max — the call
// budget is CALL_TIMEOUT_MS; multi-retry loops would blow it.
const RATE_RETRY_DELAY_MS = 1500;
// Retry delay when listTools returns fewer tools than the known-good catalog.
const LIST_RETRY_DELAY_MS = 500;

// Tools that read the user's Groww ACCOUNT (they need the account permission scope on
// the API key), as opposed to public market data. A CONSISTENT backend error on these
// while market-data tools succeed is the signature of a key that is missing the
// Holdings/Positions scope — NOT a feed outage.
const ACCOUNT_SCOPE_TOOLS = new Set([
  'get_equity_portfolio_holdings',
  'get_my_trading_positions_today',
  'get_specific_stock_position',
  'get_available_margin_details',
  'get_order_details',
]);

// The single blind signal the model sees when a data tool can't reach Groww.
// Returned as a NORMAL (non-throwing) result on purpose: a raw thrown MCP error
// reads as vague noise the model fabricated around; this is an unmissable
// instruction embedded in the tool output.
export function feedDownResult(name: string, reason: string) {
  const text =
    `🚫 GROWW_FEED_DOWN — tool "${name}" could not fetch live data (${reason}).\n` +
    `LIVE MARKET DATA IS UNAVAILABLE right now. Per DATA INTEGRITY rules: do NOT state, ` +
    `estimate, or infer ANY price / LTP / level / indicator, and do NOT reuse an earlier ` +
    `turn's number as "current". Tell the user plainly that the Groww feed is down and that ` +
    `you are BLIND. You may re-check with the market_feed_status tool.`;
  return { content: [{ type: 'text' as const, text }], details: { feedDown: true, tool: name } };
}

// A per-tool error where the Groww server RESPONDED with `isError` (permission,
// validation, or a backend fault) — the connection is UP, only this one tool failed.
// Returned as a NORMAL (non-throwing) result carrying the real error so the model
// reports the actual problem, instead of the old behaviour that promoted ANY tool
// error to a global GROWW_FEED_DOWN / BLIND panic (wrong: a holdings permission error
// would make the agent refuse to quote perfectly-available market prices).
export function toolErrorResult(name: string, detail: string) {
  const isValidation = /validation error|field required|type=missing/i.test(detail);
  const scopeHint =
    !isValidation && ACCOUNT_SCOPE_TOOLS.has(name)
      ? ` This tool reads your Groww ACCOUNT (holdings/positions/margin). A consistent ` +
        `backend error here almost always means the Groww API key is missing the ` +
        `Holdings/Positions permission scope — the user must regenerate the Groww API key ` +
        `with account read scope. Market data is unaffected.`
      : '';
  const text =
    `⚠️ Groww tool "${name}" returned an error: ${detail}.` +
    scopeHint +
    ` NOTE: the Groww connection is UP — this is a single-tool error, NOT a feed blackout, ` +
    `so do NOT declare yourself blind. Do NOT fabricate the missing values; report this ` +
    `specific tool failure to the user.`;
  return { content: [{ type: 'text' as const, text }], details: { toolError: true, tool: name } };
}

// Build the tagged error `callRaw` throws when the server returns `isError`. The tag
// (`toolBackendError`) lets the execute wrapper distinguish a server-side tool error
// (connection fine) from a transport/blind failure.
export function makeToolBackendError(name: string, content: unknown): Error {
  const detail = Array.isArray(content)
    ? (content as Array<any>)
        .filter((c) => c?.type === 'text')
        .map((c) => c.text)
        .join(' ') || JSON.stringify(content)
    : JSON.stringify(content);
  const err = new Error(`MCP tool ${name} error: ${detail}`) as Error & {
    toolBackendError?: boolean;
    toolErrorDetail?: string;
  };
  err.toolBackendError = true;
  err.toolErrorDetail = detail;
  return err;
}

// ---- P2: fundamentals stats-enum sanitizer --------------------------------
// fetch_stocks_fundamental_data validates `stats` against a strict enum; an
// out-of-enum value fails the WHOLE call. Fallback list (from the server's own
// validation error) used when the tool schema doesn't expose the enum.
const VALID_FUND_STATS = new Set([
  'marketCap', 'pbRatio', 'peRatio', 'divYield', 'bookValue', 'epsTtm', 'roe',
  'industryPe', 'cappedType', 'dividendYieldInPercent', 'faceValue', 'debtToEquity',
  'returnOnAssets', 'returnOnEquity', 'operatingProfitMargin', 'netProfitMargin',
  'quickRatio', 'cashRatio', 'debtToAsset', 'evToSales', 'evToEbitda', 'earningsYield',
]);

function enumForArrayField(schema: any, field: string): Set<string> | null {
  try {
    const items = schema?.properties?.[field]?.items;
    const en = items?.enum || items?.anyOf?.flatMap((a: any) => a?.enum || []);
    if (Array.isArray(en) && en.length) return new Set(en.map(String));
  } catch {
    /* fall through */
  }
  return null;
}

function sanitizeArgs(name: string, args: any, schema: any): any {
  if (name === 'fetch_stocks_fundamental_data' && args && Array.isArray(args.stats)) {
    const valid = enumForArrayField(schema, 'stats') || VALID_FUND_STATS;
    const filtered = args.stats.filter((s: any) => valid.has(String(s)));
    return { ...args, stats: filtered.length ? filtered : undefined };
  }
  return args;
}

// ---- pre-validation arg coercion -------------------------------------------
// The model chronically serializes object params as JSON STRINGS (e.g.
// fetch_technical_screener's `request`), and Pi's TypeBox validation never
// JSON.parses string→object — so the call fails "request: must be object" every
// time, and retries re-send the identical malformed payload. This runs as the
// tool's `prepareArguments` hook (BEFORE validation) and parses any string arg
// whose schema expects an object/array. Defensive by design: any parse failure
// returns the original value untouched so the normal validation error still
// surfaces — never swallow, never guess.
function schemaWantsObjectish(s: any): boolean {
  if (!s || typeof s !== 'object') return false;
  const collect = (x: any): any[] => (Array.isArray(x?.anyOf) || Array.isArray(x?.oneOf) ? [...(x.anyOf ?? []), ...(x.oneOf ?? [])] : []);
  const candidates = [s, ...collect(s)];
  return candidates.some((c) => {
    const t = c?.type;
    const types = Array.isArray(t) ? t : [t];
    return types.includes('object') || types.includes('array');
  });
}

export function coerceStringifiedArgs(args: unknown, rawSchema: any): unknown {
  const tryParse = (v: string): unknown => {
    try {
      const parsed = JSON.parse(v);
      return parsed !== null && typeof parsed === 'object' ? parsed : v;
    } catch {
      return v;
    }
  };
  // Whole-args-as-string: the model sent the entire arguments payload as one string.
  if (typeof args === 'string') {
    const parsed = tryParse(args);
    if (parsed !== args) args = parsed;
    else return args;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const props = rawSchema?.properties;
  if (!props || typeof props !== 'object') return args;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === 'string' && schemaWantsObjectish(props[k])) {
      const parsed = tryParse(v);
      if (parsed !== v) {
        if (!out) out = { ...(args as Record<string, unknown>) };
        out[k] = parsed;
      }
    }
  }
  return out ?? args;
}

// The largest Groww tool catalog any bridge in this process has ever seen.
// MODULE-level on purpose: the catalog is global (same for every user), but
// bridges are per-user and rebuilt on session churn — an instance-level cache
// would reset exactly when it's needed. Used only to DETECT a partial listing
// and trigger a re-list; tools are never registered from cached definitions.
let knownGoodToolNames: string[] = [];

// GrowwMcpBridge — a PER-USER instance that owns one Groww MCP connection built
// from that user's read-only token. Was module-level singleton state; now each
// agent session constructs its own bridge, so concurrent users never share a
// client or clobber each other's credentials (the process.env channel is gone).
export class GrowwMcpBridge {
  private client: Client | null = null;
  // True only after a successful connect+listTools. Data-tool calls check it and,
  // on failure, attempt ONE reconnect before declaring the feed down.
  private mcpReady = false;
  private toolCount = 0;
  private lastError: string | null = null;
  private connectedAt: number | null = null;
  // Names already registered with the Pi agent this session. Registered `execute`
  // closures read `this.client`, so a swapped client is picked up automatically.
  // Registration is per-name (not one-shot): a partial listTools no longer freezes
  // the tool set — reconnects and later setups re-list and register the missing ones.
  private registeredToolNames = new Set<string>();
  private statusToolRegistered = false;
  // The ExtensionAPI handle, kept so reconnect() can register newly-listed tools.
  private api: ExtensionAPI | null = null;

  constructor(private readonly token: string) {}

  status(): GrowwStatus {
    return {
      ready: this.mcpReady && this.client !== null,
      toolCount: this.toolCount,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
    };
  }

  ready(): boolean {
    return this.mcpReady && this.client !== null;
  }

  // ---- connection ---------------------------------------------------------
  private makeClient(): Client {
    const transport = new StreamableHTTPClientTransport(new URL(GROWW_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      // Disable the optional server->client SSE stream's reconnection: Groww drops
      // it when idle and the SDK would spin an infinite retry loop. Tool calls use
      // the separate POST path and don't need it.
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    });
    const client = new Client({ name: 'overwatch-mcp-bridge', version: '1.0.0' }, { capabilities: {} });
    let noticeLogged = false;
    client.onerror = (error: any) => {
      const msg = String(error?.message ?? error);
      if (/SSE stream disconnected|Maximum reconnection attempts|terminated/i.test(msg)) {
        if (!noticeLogged) {
          noticeLogged = true;
          console.warn('[i] Groww MCP notification channel idle-dropped (harmless; data tool calls unaffected).');
        }
        return;
      }
      console.error('Groww MCP Client Error:', error);
    };
    (client as any).__transport = transport;
    return client;
  }

  private async connectClient(): Promise<Client> {
    const client = this.makeClient();
    await withTimeout(client.connect((client as any).__transport), CONNECT_TIMEOUT_MS, 'Groww MCP connect');
    return client;
  }

  private async connectWithRetry(): Promise<Client> {
    let err: any;
    for (let i = 1; i <= CONNECT_ATTEMPTS; i++) {
      try {
        return await this.connectClient();
      } catch (e: any) {
        err = e;
        this.lastError = e.message;
        if (i < CONNECT_ATTEMPTS) {
          console.warn(`[!] Groww MCP connect attempt ${i}/${CONNECT_ATTEMPTS} failed (${e.message}). Retrying…`);
          await new Promise((r) => setTimeout(r, RECONNECT_BACKOFF_MS * i));
        }
      }
    }
    throw err;
  }

  // Rebuild the client mid-session after a call failure. One shot; returns success.
  private async reconnect(): Promise<boolean> {
    if (!this.token) {
      this.mcpReady = false;
      this.lastError = 'no Groww token';
      return false;
    }
    try {
      if (this.client) {
        try {
          await withTimeout(this.client.close(), 3000, 'close');
        } catch {
          /* ignore */
        }
      }
      this.client = await this.connectClient();
      this.mcpReady = true;
      this.connectedAt = Date.now();
      this.lastError = null;
      console.warn('[+] Groww MCP reconnected.');
      // Self-heal the tool set: tools missing from the original (possibly partial)
      // listing get registered now. A re-list failure must NOT fail the reconnect —
      // the connection itself is back and existing tools work.
      if (this.api) {
        try {
          await this.listAndRegister(this.api);
        } catch (e: any) {
          console.warn(`[!] Groww MCP re-list after reconnect failed (${e.message}); keeping existing tool set.`);
        }
      }
      return true;
    } catch (e: any) {
      this.mcpReady = false;
      this.lastError = e.message;
      console.error(`[!] Groww MCP reconnect failed: ${e.message}`);
      return false;
    }
  }

  // Raw call: timeout-guarded. Throws a TAGGED backend error when the server responds
  // with `isError` (connection fine, tool failed), or a plain error on transport failure.
  private async callRaw(name: string, args: any): Promise<string> {
    if (!this.client) throw new Error('Groww MCP not connected');
    const result: any = await withTimeout(this.client.callTool({ name, arguments: args }), CALL_TIMEOUT_MS, `Groww ${name}`);
    if (result.isError) throw makeToolBackendError(name, result.content);
    return (result.content as Array<any>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  }

  // Parsed convenience call (external reuse outside the agent loop).
  async call(name: string, args: any): Promise<any> {
    return JSON.parse(await this.callRaw(name, args));
  }

  // ---- status self-check tool --------------------------------------------
  private registerStatusTool(api: ExtensionAPI): void {
    if (this.statusToolRegistered) return;
    this.statusToolRegistered = true;
    api.registerTool({
      name: 'market_feed_status',
      label: 'Market Feed Status',
      description:
        'Verify whether the LIVE Groww market-data feed actually works RIGHT NOW. ' +
        'Call this whenever you are about to state a live price and are not certain the last ' +
        'data call in THIS turn succeeded, or after any GROWW_FEED_DOWN result. It runs a real ' +
        'probe (not just a connection flag) and reports whether you are BLIND.',
      parameters: Type.Object({}),
      execute: async () => {
        if (!this.ready()) await this.reconnect();
        let probeOk = false;
        let probeMsg = '';
        try {
          await this.callRaw('resolve_market_time_and_calendar', {});
          probeOk = true;
        } catch (e: any) {
          probeMsg = e.message;
          if (isConnError(e.message) && (await this.reconnect())) {
            try {
              await this.callRaw('resolve_market_time_and_calendar', {});
              probeOk = true;
            } catch (e2: any) {
              probeMsg = e2.message;
            }
          }
        }
        const st = this.status();
        const text = [
          probeOk
            ? '✅ FEED STATUS: LIVE — Groww data path verified by a real probe this call. Live prices are OK to quote.'
            : `🚫 FEED STATUS: BLIND — live Groww data is NOT reachable (${probeMsg}). Do NOT state or estimate any price/level; tell the user the feed is down.`,
          `connected=${st.ready} tools=${st.toolCount}${st.lastError ? ` lastError="${st.lastError}"` : ''}`,
        ].join('\n');
        return { content: [{ type: 'text', text }], details: { blind: !probeOk, connected: st.ready } };
      },
    });
  }

  // ---- tool listing + registration -----------------------------------------
  // List the Groww tools on the CURRENT client and register any not yet known to
  // Pi. Re-runnable: called from setup() and after a successful reconnect(), so a
  // partial first listing no longer freezes the tool set for the session.
  private async listAndRegister(api: ExtensionAPI): Promise<void> {
    if (!this.client) throw new Error('Groww MCP not connected');
    let { tools } = await withTimeout(this.client.listTools(), CALL_TIMEOUT_MS, 'listTools');
    // A listing smaller than the known-good catalog is usually a transient backend
    // hiccup ("Tool … not found" mid-conversation). Retry once, take the larger
    // result. Tools are only ever registered from a FRESH listing, never a cache.
    if (tools.length < knownGoodToolNames.length) {
      console.warn(`[!] Groww listTools returned ${tools.length} tools (known-good ${knownGoodToolNames.length}); retrying once…`);
      await new Promise((r) => setTimeout(r, LIST_RETRY_DELAY_MS));
      try {
        const second = await withTimeout(this.client.listTools(), CALL_TIMEOUT_MS, 'listTools retry');
        if (second.tools.length > tools.length) tools = second.tools;
      } catch {
        /* keep the first listing */
      }
    }
    if (tools.length >= knownGoodToolNames.length) knownGoodToolNames = tools.map((t) => t.name);
    this.toolCount = tools.length;

    // Register each data tool with Pi once per name. Each wraps callRaw with
    // pre-validation arg coercion (prepareArguments), arg-sanitizing (P2), a
    // timeout, rate-limit/backend classification, ONE reconnect-and-retry on
    // transport failure, and a loud feed-down result otherwise (P1 — never
    // vanish silently). api.registerTool is a Map set, so re-registration by
    // name would be idempotent anyway; the Set just makes the intent explicit.
    for (const tool of tools) {
      if (this.registeredToolNames.has(tool.name)) continue;
      this.registeredToolNames.add(tool.name);
      const schema = tool.inputSchema ? Type.Unsafe<any>(tool.inputSchema) : Type.Object({});
      const rawSchema = tool.inputSchema;
      api.registerTool({
        name: tool.name,
        label: `Groww: ${tool.name}`,
        description: tool.description || `Groww MCP Tool: ${tool.name}`,
        parameters: schema,
        // Runs BEFORE TypeBox validation — fixes the model's chronic habit of
        // sending object params as JSON strings (fetch_technical_screener).
        prepareArguments: (args: unknown) => coerceStringifiedArgs(args, rawSchema) as any,
        execute: async (_toolCallId: string, args: any) => {
          const clean = sanitizeArgs(tool.name, args, rawSchema);
          try {
            const text = await this.callRaw(tool.name, clean);
            return { content: [{ type: 'text', text }], details: {} };
          } catch (e1: any) {
            // Server RESPONDED with a per-tool error (permission/validation/backend).
            // Connection is fine — surface the real error; do NOT declare the feed blind.
            if (e1?.toolBackendError) return toolErrorResult(tool.name, e1.toolErrorDetail || e1.message);
            const kind = classifyToolFailure(e1.message);
            // Rate-limited (429): the connection is UP. One short-delay retry, then
            // report the rate limit — NEVER promote it to a feed blackout.
            if (kind === 'rate') {
              await new Promise((r) => setTimeout(r, RATE_RETRY_DELAY_MS));
              try {
                const text = await this.callRaw(tool.name, clean);
                return { content: [{ type: 'text', text }], details: {} };
              } catch (e2: any) {
                if (e2?.toolBackendError) return toolErrorResult(tool.name, e2.toolErrorDetail || e2.message);
                return toolErrorResult(
                  tool.name,
                  `429 rate-limited: ${e2.message}. The Groww API is rate-limiting; wait a few seconds and retry — this is NOT a feed outage, do not declare BLIND`,
                );
              }
            }
            // Server-side 500: the connection is UP, this one call failed.
            if (kind === 'backend') return toolErrorResult(tool.name, e1.message);
            // Transport/connection failure — one reconnect, else the feed is genuinely down.
            if (kind === 'conn' && (await this.reconnect())) {
              try {
                const text = await this.callRaw(tool.name, clean);
                return { content: [{ type: 'text', text }], details: {} };
              } catch (e2: any) {
                if (e2?.toolBackendError) return toolErrorResult(tool.name, e2.toolErrorDetail || e2.message);
                return feedDownResult(tool.name, e2.message);
              }
            }
            return feedDownResult(tool.name, e1.message);
          }
        },
      });
    }
  }

  // ---- main entry: connect + register (called per query; guarded) ---------
  async setup(api: ExtensionAPI): Promise<GrowwStatus> {
    this.api = api;
    // The status tool must exist even when the feed is down, so always register it.
    this.registerStatusTool(api);

    if (this.mcpReady && this.client) {
      // Turn-level self-heal: if an earlier partial listing left us short of the
      // known-good catalog, re-list now instead of returning — otherwise a missing
      // tool stays missing for the life of this bridge.
      if (knownGoodToolNames.length > this.registeredToolNames.size) {
        try {
          await this.listAndRegister(api);
        } catch (e: any) {
          console.warn(`[!] Groww MCP self-heal re-list failed (${e.message}); keeping existing tool set.`);
        }
      }
      return this.status();
    }

    if (!this.token) {
      this.lastError = 'GROWW_API_TOKEN missing';
      console.warn('\n[!] Groww token missing for this user. Groww MCP tools will not be available.');
      return this.status();
    }

    try {
      console.log('\nConnecting to Groww MCP via Streamable HTTP…');
      this.client = await this.connectWithRetry();
      await this.listAndRegister(api);
      console.log(`[+] Connected! Found ${this.toolCount} Groww MCP tools.`);

      this.mcpReady = true;
      this.connectedAt = Date.now();
      this.lastError = null;
      return this.status();
    } catch (error: any) {
      this.mcpReady = false;
      this.lastError = error.message;
      console.error(`\n[!] Failed to connect to Groww MCP after ${CONNECT_ATTEMPTS} attempts: ${error.message}`);
      if (error.code === 401) console.error('[!] Authentication failed. The Groww token might be expired.');
      // Return a not-ready status (rather than throwing) so the doctrine factory
      // injects a BLIND banner into the system prompt for this turn.
      return this.status();
    }
  }
}
