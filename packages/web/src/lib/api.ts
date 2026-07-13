import { idToken } from '../firebase';

export const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:8787';

async function authHeaders(): Promise<Record<string, string>> {
  const t = await idToken();
  if (!t) throw new Error('not signed in');
  return { Authorization: `Bearer ${t}` };
}

export interface UserCredsInput {
  growwToken: string;
  anthropicKey?: string;
  ollamaKey?: string;
  telegram?: { botToken: string; chatId: string };
}

export async function saveSecrets(creds: UserCredsInput): Promise<void> {
  const res = await fetch(`${API_URL}/secrets`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  if (!res.ok) throw new Error(`saveSecrets failed: ${res.status} ${await res.text()}`);
}

export interface ComposioConnection {
  toolkit: string;
  name: string;
  connected: boolean;
  status: string;
}

export async function listComposioConnections(): Promise<{ enabled: boolean; connections: ComposioConnection[] }> {
  const res = await fetch(`${API_URL}/composio/connections`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`connections failed: ${res.status}`);
  return res.json();
}

export async function connectComposio(toolkit: string): Promise<{ redirectUrl: string }> {
  const res = await fetch(`${API_URL}/composio/connect`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolkit }),
  });
  if (!res.ok) throw new Error(`connect failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function disconnectComposio(toolkit: string): Promise<void> {
  const res = await fetch(`${API_URL}/composio/connections/${encodeURIComponent(toolkit)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
}

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API_URL}/models`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`listModels failed: ${res.status}`);
  return (await res.json()).models as ModelInfo[];
}

export async function createConversation(title?: string, model?: { provider: string; id: string }): Promise<string> {
  const res = await fetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, model }),
  });
  if (!res.ok) throw new Error(`createConversation failed: ${res.status}`);
  return (await res.json()).cid as string;
}

export async function deleteConversation(cid: string): Promise<void> {
  const res = await fetch(`${API_URL}/conversations/${cid}`, { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) throw new Error(`deleteConversation failed: ${res.status}`);
}

export { authHeaders };
