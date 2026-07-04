import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Minimal raw Groww MCP client for NON-agent contexts (the monitor worker), where we
// only need to call a couple of read-only data tools — not register them with Pi.
// Mirrors the seeded daemon's connect/call: StreamableHTTP + Bearer, timeout-guarded,
// parses the first text content block as JSON.

const GROWW_MCP_URL = 'https://mcp.groww.in/mcp/'; // trailing slash: /mcp 307-redirects here
const CALL_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);
}

export class GrowwDataClient {
  private client: Client | null = null;

  constructor(private readonly token: string) {}

  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(GROWW_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      reconnectionOptions: { initialReconnectionDelay: 1000, maxReconnectionDelay: 30000, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 },
    });
    const client = new Client({ name: 'overwatch-worker', version: '1.0.0' }, { capabilities: {} });
    client.onerror = () => { /* transport SSE idle-drops are harmless; POST calls are separate */ };
    await withTimeout(client.connect(transport), CALL_TIMEOUT_MS, 'connect');
    this.client = client;
  }

  async call<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client) throw new Error('GrowwDataClient not connected');
    const res: any = await withTimeout(this.client.callTool({ name, arguments: args }), CALL_TIMEOUT_MS, name);
    return JSON.parse(res.content[0].text) as T;
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await withTimeout(this.client.close(), 5000, 'close');
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }
}
