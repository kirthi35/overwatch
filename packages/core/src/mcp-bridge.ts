import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@sinclair/typebox";
import { Entry } from "@napi-rs/keyring";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GROWW_MCP_URL = "https://mcp.groww.in/mcp";

// Resilience budget. A dead feed must fail LOUD and FAST, never hang or vanish
// silently (the failure mode that let the model fabricate live prices).
const CONNECT_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MS = 20000;
const CONNECT_ATTEMPTS = 3;           // total connect tries before declaring blind
const RECONNECT_BACKOFF_MS = 800;

// ---- module state ---------------------------------------------------------
let mcpClient: Client | null = null;
// True only after a successful connect+listTools. Data-tool calls check it and,
// on failure, attempt ONE reconnect before declaring the feed down.
let mcpReady = false;
let toolCount = 0;
let lastError: string | null = null;
let connectedAt: number | null = null;
// Tools are registered with the Pi agent exactly once per process. Reconnects
// only swap the underlying client; the registered `execute` closures read the
// module-level `mcpClient`, so a swapped client is picked up automatically.
let dataToolsRegistered = false;
let statusToolRegistered = false;

export interface GrowwStatus { ready: boolean; toolCount: number; lastError: string | null; connectedAt: number | null; }
export function growwStatus(): GrowwStatus {
  return { ready: mcpReady && mcpClient !== null, toolCount, lastError, connectedAt };
}
export function growwReady(): boolean { return mcpReady && mcpClient !== null; }

// ---- small helpers --------------------------------------------------------
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// A connection-level failure (vs. a per-tool backend error). Triggers a reconnect.
function isConnError(msg: string): boolean {
  return /timed out|terminated|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|not connected|fetch failed|network|502|503|504|closed/i.test(msg || '');
}

function monitordAlive(): boolean {
  try {
    const pid = (JSON.parse(fs.readFileSync(path.join(os.homedir(), '.overwatch', 'monitord.pid'), 'utf8')) || {}).pid;
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

// The single blind signal the model sees when a data tool can't reach Groww.
// Returned as a NORMAL (non-throwing) result on purpose: a raw thrown MCP error
// reads as vague noise the model fabricated around; this is an unmissable
// instruction embedded in the tool output.
function feedDownResult(name: string, reason: string) {
  const text =
    `🚫 GROWW_FEED_DOWN — tool "${name}" could not fetch live data (${reason}).\n` +
    `LIVE MARKET DATA IS UNAVAILABLE right now. Per DATA INTEGRITY rules: do NOT state, ` +
    `estimate, or infer ANY price / LTP / level / indicator, and do NOT reuse an earlier ` +
    `turn's number as "current". Tell the user plainly that the Groww feed is down and that ` +
    `you are BLIND. You may re-check with the market_feed_status tool.`;
  return { content: [{ type: "text" as const, text }], details: { feedDown: true, tool: name } };
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

// Pull an enum list for an array-of-enum field out of a raw JSON schema, if present.
function enumForArrayField(schema: any, field: string): Set<string> | null {
  try {
    const items = schema?.properties?.[field]?.items;
    const en = items?.enum || items?.anyOf?.flatMap((a: any) => a?.enum || []);
    if (Array.isArray(en) && en.length) return new Set(en.map(String));
  } catch { /* fall through */ }
  return null;
}

// Drop invalid enum values before the call so one bad stat doesn't nuke the request.
function sanitizeArgs(name: string, args: any, schema: any): any {
  if (name === 'fetch_stocks_fundamental_data' && args && Array.isArray(args.stats)) {
    const valid = enumForArrayField(schema, 'stats') || VALID_FUND_STATS;
    const filtered = args.stats.filter((s: any) => valid.has(String(s)));
    // If everything was invalid, omit `stats` entirely and let the server default.
    return { ...args, stats: filtered.length ? filtered : undefined };
  }
  return args;
}

// ---- connection -----------------------------------------------------------
async function resolveGrowwToken(): Promise<string> {
  if (process.env.GROWW_API_TOKEN) return process.env.GROWW_API_TOKEN;
  try {
    const stored = await new Entry('overwatch', 'growwToken').getPassword();
    if (stored) return stored;
  } catch { /* keychain unavailable */ }
  return '';
}

function makeClient(token: string): Client {
  const transport = new StreamableHTTPClientTransport(new URL(GROWW_MCP_URL), {
    requestInit: { headers: { 'Authorization': `Bearer ${token}` } },
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
        console.warn("[i] Groww MCP notification channel idle-dropped (harmless; data tool calls unaffected).");
      }
      return;
    }
    console.error("Groww MCP Client Error:", error);
  };
  // Bind the transport by connecting later; store it via a closure on the client.
  (client as any).__transport = transport;
  return client;
}

async function connectClient(token: string): Promise<Client> {
  const client = makeClient(token);
  await withTimeout(client.connect((client as any).__transport), CONNECT_TIMEOUT_MS, 'Groww MCP connect');
  return client;
}

async function connectWithRetry(token: string): Promise<Client> {
  let err: any;
  for (let i = 1; i <= CONNECT_ATTEMPTS; i++) {
    try {
      return await connectClient(token);
    } catch (e: any) {
      err = e;
      lastError = e.message;
      if (i < CONNECT_ATTEMPTS) {
        console.warn(`[!] Groww MCP connect attempt ${i}/${CONNECT_ATTEMPTS} failed (${e.message}). Retrying…`);
        await new Promise(r => setTimeout(r, RECONNECT_BACKOFF_MS * i));
      }
    }
  }
  throw err;
}

// Rebuild the client mid-session after a call failure. One shot; returns success.
async function reconnect(): Promise<boolean> {
  const token = await resolveGrowwToken();
  if (!token) { mcpReady = false; lastError = 'no Groww token'; return false; }
  try {
    if (mcpClient) { try { await withTimeout(mcpClient.close(), 3000, 'close'); } catch { /* ignore */ } }
    mcpClient = await connectClient(token);
    mcpReady = true; connectedAt = Date.now(); lastError = null;
    console.warn('[+] Groww MCP reconnected.');
    return true;
  } catch (e: any) {
    mcpReady = false; lastError = e.message;
    console.error(`[!] Groww MCP reconnect failed: ${e.message}`);
    return false;
  }
}

// Raw call: timeout-guarded, throws on error/transport failure.
async function callRaw(name: string, args: any): Promise<string> {
  if (!mcpClient) throw new Error('Groww MCP not connected');
  const result: any = await withTimeout(mcpClient.callTool({ name, arguments: args }), CALL_TIMEOUT_MS, `Groww ${name}`);
  if (result.isError) throw new Error(`MCP tool ${name} error: ${JSON.stringify(result.content)}`);
  return (result.content as Array<any>).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

// External reuse (e.g. a helper outside the agent loop). Kept for compatibility.
export async function callGroww(name: string, args: any): Promise<any> {
  return JSON.parse(await callRaw(name, args));
}

// ---- status self-check tool ------------------------------------------------
function registerStatusTool(api: ExtensionAPI) {
  if (statusToolRegistered) return;
  statusToolRegistered = true;
  api.registerTool({
    name: "market_feed_status",
    label: "Market Feed Status",
    description:
      "Verify whether the LIVE Groww market-data feed actually works RIGHT NOW. " +
      "Call this whenever you are about to state a live price and are not certain the last " +
      "data call in THIS turn succeeded, or after any GROWW_FEED_DOWN result. It runs a real " +
      "probe (not just a connection flag) and reports whether you are BLIND.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!growwReady()) await reconnect();
      let probeOk = false, probeMsg = '';
      try { await callRaw('resolve_market_time_and_calendar', {}); probeOk = true; }
      catch (e: any) {
        probeMsg = e.message;
        if (isConnError(e.message) && await reconnect()) {
          try { await callRaw('resolve_market_time_and_calendar', {}); probeOk = true; }
          catch (e2: any) { probeMsg = e2.message; }
        }
      }
      const st = growwStatus();
      const monAlive = monitordAlive();
      const text = [
        probeOk
          ? '✅ FEED STATUS: LIVE — Groww data path verified by a real probe this call. Live prices are OK to quote.'
          : `🚫 FEED STATUS: BLIND — live Groww data is NOT reachable (${probeMsg}). Do NOT state or estimate any price/level; tell the user the feed is down.`,
        `connected=${st.ready} tools=${st.toolCount}${st.lastError ? ` lastError="${st.lastError}"` : ''}`,
        `monitord daemon: ${monAlive ? 'running' : 'NOT running'}`,
      ].join('\n');
      return { content: [{ type: "text", text }], details: { blind: !probeOk, connected: st.ready, monitordAlive: monAlive } };
    },
  });
}

// ---- main entry: connect + register (called per query; guarded) ------------
export async function setupGrowwMCP(api: ExtensionAPI): Promise<GrowwStatus> {
  // The status tool must exist even when the feed is down, so always register it.
  registerStatusTool(api);

  if (mcpReady && mcpClient) return growwStatus();

  const growwToken = await resolveGrowwToken();
  if (!growwToken) {
    lastError = 'GROWW_API_TOKEN missing';
    console.warn("\n[!] GROWW_API_TOKEN is missing. Groww MCP tools will not be available. Please restart and provide the token.");
    return growwStatus();
  }

  try {
    console.log("\nConnecting to Groww MCP via Streamable HTTP…");
    mcpClient = await connectWithRetry(growwToken);

    const { tools } = await withTimeout(mcpClient.listTools(), CALL_TIMEOUT_MS, 'listTools');
    toolCount = tools.length;
    console.log(`[+] Connected! Found ${tools.length} Groww MCP tools.`);

    // Register the data tools with Pi exactly once. Each wraps callRaw with
    // arg-sanitizing (P2), a timeout, ONE reconnect-and-retry on transport
    // failure, and a loud feed-down result otherwise (P1 — never vanish silently).
    if (!dataToolsRegistered) {
      for (const tool of tools) {
        const schema = tool.inputSchema ? Type.Unsafe<any>(tool.inputSchema) : Type.Object({});
        const rawSchema = tool.inputSchema;
        api.registerTool({
          name: tool.name,
          label: `Groww: ${tool.name}`,
          description: tool.description || `Groww MCP Tool: ${tool.name}`,
          parameters: schema,
          execute: async (_toolCallId: string, args: any) => {
            const clean = sanitizeArgs(tool.name, args, rawSchema);
            try {
              const text = await callRaw(tool.name, clean);
              return { content: [{ type: "text", text }], details: {} };
            } catch (e1: any) {
              if (isConnError(e1.message) && await reconnect()) {
                try {
                  const text = await callRaw(tool.name, clean);
                  return { content: [{ type: "text", text }], details: {} };
                } catch (e2: any) {
                  return feedDownResult(tool.name, e2.message);
                }
              }
              return feedDownResult(tool.name, e1.message);
            }
          },
        });
      }
      dataToolsRegistered = true;
    }

    mcpReady = true; connectedAt = Date.now(); lastError = null;
    return growwStatus();
  } catch (error: any) {
    mcpReady = false;
    lastError = error.message;
    console.error(`\n[!] Failed to connect to Groww MCP after ${CONNECT_ATTEMPTS} attempts: ${error.message}`);
    if (error.code === 401) console.error("[!] Authentication failed. Your GROWW_API_TOKEN might be expired.");
    // NOTE: we intentionally return a not-ready status (rather than throwing) so
    // index.ts injects a BLIND banner into the system prompt for this turn.
    return growwStatus();
  }
}
