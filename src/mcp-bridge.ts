import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@sinclair/typebox";
import { Entry } from "@napi-rs/keyring";

const GROWW_MCP_URL = "https://mcp.groww.in/mcp";

let mcpClient: Client | null = null;
// Guard: before_agent_start fires once PER QUERY, so connect + register only once
// per process. Set true only after a successful connect+listTools+register.
let mcpReady = false;

// Resolve the Groww token from the same coordinates index.ts writes to.
// Priority: process.env (set by index.ts from the keychain at startup),
// then the keychain entry directly (service 'overwatch', account 'growwToken').
async function resolveGrowwToken(): Promise<string> {
  if (process.env.GROWW_API_TOKEN) {
    return process.env.GROWW_API_TOKEN;
  }
  try {
    const entry = new Entry('overwatch', 'growwToken');
    const stored = await entry.getPassword();
    if (stored) return stored;
  } catch {
    // keychain unavailable — fall through
  }
  return '';
}

export async function setupGrowwMCP(api: ExtensionAPI) {
  if (mcpReady) return; // already connected + tools registered this process
  try {
    const growwToken = await resolveGrowwToken();

    if (!growwToken) {
      console.warn("\n[!] GROWW_API_TOKEN is missing. Groww MCP tools will not be available. Please restart and provide the token.");
      return;
    }

    console.log("\nConnecting to Groww MCP via Streamable HTTP...");
    const transport = new StreamableHTTPClientTransport(new URL(GROWW_MCP_URL), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${growwToken}`
        }
      },
      // The MCP SDK opens an OPTIONAL server->client SSE notification stream. Groww's
      // server drops it when idle (undici "TypeError: terminated"), and the SDK's
      // default reconnect resets its attempt counter every cycle -> infinite retry loop
      // that spams onerror. Tool calls use the separate POST path and don't need this
      // stream, so disable reconnection entirely.
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    });

    mcpClient = new Client({ name: 'overwatch-mcp-bridge', version: '1.0.0' }, { capabilities: {} });

    // Swallow benign notification-stream churn; surface only real errors (401, refused, etc).
    let noticeLogged = false;
    mcpClient.onerror = (error: any) => {
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

    await mcpClient.connect(transport);
    
    const { tools } = await mcpClient.listTools();
    console.log(`[+] Connected! Found ${tools.length} Groww MCP tools.`);

    for (const tool of tools) {
      // We map the JSON Schema returned by MCP to a Typebox schema
      // Since Pi Agent uses Typebox for strict validation
      const schema = tool.inputSchema ? Type.Unsafe<any>(tool.inputSchema) : Type.Object({});
      
      api.registerTool({
        name: tool.name,
        label: `Groww: ${tool.name}`,
        description: tool.description || `Groww MCP Tool: ${tool.name}`,
        parameters: schema,
        execute: async (toolCallId: string, args: any) => {
          if (!mcpClient) {
             throw new Error("MCP Client is not connected");
          }
          // The CallToolResult contains `content` array of messages
          const result = await mcpClient.callTool({
            name: tool.name,
            arguments: args
          });
          
          if (result.isError) {
             throw new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
          }
          
          // Map MCP text content back to Pi tool return type
          const textContents = (result.content as Array<any>)
              .filter(c => c.type === 'text')
              .map(c => c.text);
              
          return {
             content: [
               { type: "text", text: textContents.join("\n") }
             ],
             details: {}
          };
        }
      });
    }

    mcpReady = true; // connected + all tools registered; skip on subsequent queries

  } catch (error: any) {
    console.error(`\n[!] Failed to connect to Groww MCP: ${error.message}`);
    if (error.code === 401) {
        console.error("[!] Authentication failed. Your GROWW_API_TOKEN might be expired.");
    }
  }
}
