import { Composio } from '@composio/core';
import { DEFAULT_TOOLKITS } from './composio-bridge.js';

// Server-side Composio connection management (for the Settings → Integrations REST
// routes). Separate from ComposioBridge (which is per-agent-session and registers
// tools): these are stateless account-ops keyed by userId. The account API key is
// shared; isolation is purely by userId, so callers MUST pass the verified Firebase
// uid — never client-supplied input.

let client: Composio<any> | null = null;
function getClient(apiKey: string): Composio<any> {
  return (client ??= new Composio({ apiKey }));
}

export interface ComposioConnection {
  toolkit: string;
  name: string;
  connected: boolean;
  status: string;
}

/** List the connectable toolkits + this user's connection state. */
export async function listComposioConnections(apiKey: string, userId: string): Promise<ComposioConnection[]> {
  const session = await getClient(apiKey).sessions.create(userId, { toolkits: DEFAULT_TOOLKITS } as any);
  const res = await session.toolkits({ toolkits: DEFAULT_TOOLKITS });
  return res.items.map((i: any) => ({
    toolkit: i.slug,
    name: i.name,
    connected: !!i.connection?.isActive,
    status: i.connection?.connectedAccount?.status ?? 'not_connected',
  }));
}

/** Start OAuth for one toolkit; returns the redirect URL to send the user's browser to. */
export async function initiateComposioConnection(
  apiKey: string,
  userId: string,
  toolkit: string,
  callbackUrl?: string,
): Promise<{ redirectUrl: string }> {
  const session = await getClient(apiKey).sessions.create(userId, { toolkits: [toolkit] } as any);
  const conn = await session.authorize(toolkit, callbackUrl ? { callbackUrl } : undefined);
  return { redirectUrl: (conn as any).redirectUrl };
}

/** Revoke this user's connected account(s) for a toolkit. Best-effort. */
export async function disconnectComposio(apiKey: string, userId: string, toolkit: string): Promise<{ removed: number }> {
  const c = getClient(apiKey);
  const list = await c.connectedAccounts.list({ userIds: [userId], toolkitSlugs: [toolkit] } as any);
  const items: any[] = (list as any).items ?? [];
  let removed = 0;
  for (const acct of items) {
    try {
      await c.connectedAccounts.delete(acct.id);
      removed++;
    } catch {
      /* best-effort */
    }
  }
  return { removed };
}
