import type { ChatModelAdapter } from '@assistant-ui/react';
import { API_URL, authHeaders } from './api';

function partsToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' ? (p.text ?? '') : '')).join('');
  }
  return '';
}

// A ChatModelAdapter bound to one conversation. Per turn it:
//  1. opens the conversation's SSE stream (attaches a server sink),
//  2. POSTs the user's prompt (fires the turn),
//  3. reads AgentSessionEvents, yielding the accumulated assistant text as it grows,
//  4. stops on agent_end.
// Monitor-event injections (sendCustomMessage/triggerTurn) that arrive on the same
// stream are surfaced by the agent's response like any other turn.
export function makeChatAdapter(cid: string): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const last = messages[messages.length - 1];
      const text = partsToText(last?.content as unknown);
      const headers = await authHeaders();

      // 1. open the SSE stream first so the sink is attached before the turn starts.
      const streamRes = await fetch(`${API_URL}/conversations/${cid}/stream`, { headers, signal: abortSignal });
      if (!streamRes.ok || !streamRes.body) {
        throw new Error(`stream failed: ${streamRes.status}`);
      }
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();

      try {
        // 2. fire the prompt.
        await fetch(`${API_URL}/conversations/${cid}/prompt`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        // 3. read SSE frames. Build content = accumulated text + tool-call parts, so
        // assistant-ui renders both the prose and inline tool cards.
        let buf = '';
        // Render parts in the ORDER the model produced them (Pi's message.content already
        // interleaves text ↔ tool-call), so a tool call shows inline where it happened —
        // not dumped after all the prose. `started`/`results` enrich by toolCallId and act
        // as a fallback if a tool arrives only via execution events (never render at the end
        // of the message when content carried it in the right place).
        let lastContent: any[] = [];
        let errText = '';
        const started = new Map<string, { toolName: string; args: unknown }>();
        const results = new Map<string, { result?: unknown; isError?: boolean }>();
        const TOOL_TYPES = new Set(['tool_use', 'toolCall', 'tool-call', 'toolUse', 'tool_call']);
        const isTool = (p: any) => p && typeof p === 'object' && TOOL_TYPES.has(p.type);
        const setContent = (content: unknown) => {
          if (Array.isArray(content)) lastContent = content as any[];
          else if (typeof content === 'string') lastContent = content ? [{ type: 'text', text: content }] : [];
        };
        const build = (): any[] => {
          const parts: any[] = [];
          const rendered = new Set<string>();
          for (const p of lastContent) {
            if (!p || typeof p !== 'object') continue;
            if (p.type === 'text') {
              if (p.text) parts.push({ type: 'text', text: p.text });
            } else if (isTool(p)) {
              const id = p.toolCallId ?? p.id ?? '';
              const r = results.get(id) ?? {};
              parts.push({ type: 'tool-call', toolCallId: id, toolName: p.toolName ?? p.name ?? 'tool', args: p.args ?? p.arguments ?? p.input ?? {}, result: r.result, isError: r.isError });
              if (id) rendered.add(id);
            }
          }
          // Fallback only: tools seen via execution events but absent from message.content.
          for (const [id, t] of started) {
            if (rendered.has(id)) continue;
            const r = results.get(id) ?? {};
            parts.push({ type: 'tool-call', toolCallId: id, toolName: t.toolName, args: t.args ?? {}, result: r.result, isError: r.isError });
          }
          if (errText && !parts.some((p) => p.type === 'text')) parts.push({ type: 'text', text: errText });
          return parts;
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue; // heartbeat / comment
            let evt: any;
            try {
              evt = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }
            if (evt.type === 'message_update' || evt.type === 'message_end') {
              setContent(evt.message?.content);
              if (evt.type === 'message_end' && evt.message?.stopReason === 'error') {
                errText = `⚠️ ${evt.message?.errorMessage ?? 'model error'}`;
              }
              const parts = build();
              if (parts.length) yield { content: parts };
            } else if (evt.type === 'tool_execution_start') {
              started.set(evt.toolCallId, { toolName: evt.toolName, args: evt.args });
              const parts = build();
              if (parts.length) yield { content: parts };
            } else if (evt.type === 'tool_execution_end') {
              results.set(evt.toolCallId, { result: evt.result, isError: evt.isError });
              const parts = build();
              if (parts.length) yield { content: parts };
            } else if (evt.type === 'agent_end') {
              return;
            }
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
