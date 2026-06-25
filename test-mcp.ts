import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function test() {
  console.log("Connecting to MCP SSE...");
  // Groww token is optional for listing tools maybe?
  const transport = new SSEClientTransport(new URL("https://mcp.groww.in/mcp"), {
    requestInit: {
      headers: {
        'Authorization': `Bearer fake_token_for_now`
      }
    }
  });
  const client = new Client({ name: 'overwatch', version: '1.0.0' }, { capabilities: {} });
  
  await client.connect(transport);
  console.log("Connected!");
  
  const tools = await client.listTools();
  console.log("Tools:", tools);
  
  await client.close();
}

test().catch(console.error);
