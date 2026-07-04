import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { UserContext } from '@overwatch/core';
import { buildUserSession } from './session-builder.js';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('');
  return '';
}

// Build a compact transcript (user + assistant prose only) for titling, capped so the
// title call stays cheap. Each message trimmed; overall length bounded.
export function buildTranscript(messages: Array<{ role: string; content: unknown }>, cap = 2500): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const t = extractText(m.content).trim().replace(/\s+/g, ' ');
    if (!t) continue;
    lines.push(`${m.role === 'user' ? 'User' : 'Overwatch'}: ${t.slice(0, 400)}`);
    if (lines.join('\n').length > cap) break;
  }
  return lines.join('\n').slice(0, cap);
}

// Generate a concise chat title with the user's own LLM from the WHOLE conversation
// transcript — a cheap doctrine-free/tool-free one-shot. Returns null on failure.
export async function generateTitle(u: UserContext, transcript: string): Promise<string | null> {
  if (!transcript.trim()) return null;
  const titleExt: ExtensionFactory = (api) => {
    api.on('before_agent_start', () => ({
      systemPrompt:
        'You generate concise chat titles. Given a conversation, reply with ONLY a 3 to 6 word ' +
        'title in Title Case that captures its main topic — no quotes, no trailing punctuation, ' +
        'no preamble, no explanation.',
    }));
  };

  let session: Awaited<ReturnType<typeof buildUserSession>>['session'] | undefined;
  try {
    ({ session } = await buildUserSession(u, { noDoctrine: true, extraExtensions: [titleExt] }));
    let resolveEnd: () => void = () => {};
    const ended = new Promise<void>((r) => (resolveEnd = r));
    const unsub = session.subscribe((e) => {
      if (e.type === 'agent_end') resolveEnd();
    });
    const to = setTimeout(() => resolveEnd(), 30000);
    await session.prompt(`Generate a title for this conversation:\n\n${transcript}`);
    await ended;
    clearTimeout(to);
    unsub();

    const last = [...session.messages].reverse().find((m: any) => m.role === 'assistant');
    let text = extractText((last as any)?.content).trim();
    text = text.replace(/^["']+|["']+$/g, '').replace(/[.\s]+$/, '').split('\n')[0].trim().slice(0, 60);
    return text || null;
  } catch {
    return null;
  } finally {
    try {
      session?.dispose();
    } catch {
      /* ignore */
    }
  }
}
