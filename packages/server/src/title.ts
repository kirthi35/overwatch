import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { UserContext } from '@overwatch/core';
import { buildUserSession } from './session-builder.js';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('');
  return '';
}

// Generate a concise chat title with the user's own LLM — a cheap one-shot with NO
// doctrine, Groww, or tools. Returns null on any failure (caller keeps the interim
// first-message title). Uses the user's default model (GLM or Claude).
export async function generateTitle(u: UserContext, seed: string): Promise<string | null> {
  const titleExt: ExtensionFactory = (api) => {
    api.on('before_agent_start', () => ({
      systemPrompt:
        'You generate concise chat titles. Reply with ONLY a 3 to 6 word title in Title Case — ' +
        'no quotes, no trailing punctuation, no preamble, no explanation.',
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
    await session.prompt(`Title this conversation. The first message was: "${seed.slice(0, 300)}"`);
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
