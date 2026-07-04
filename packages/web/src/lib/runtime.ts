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
        let acc = '';
        const tools = new Map<string, { toolName: string; args: unknown; result?: unknown; isError?: boolean }>();
        const build = (): any[] => {
          const parts: any[] = [];
          if (acc) parts.push({ type: 'text', text: acc });
          for (const [toolCallId, t] of tools) {
            parts.push({ type: 'tool-call', toolCallId, toolName: t.toolName, args: t.args ?? {}, result: t.result, isError: t.isError });
          }
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
              const t = partsToText(evt.message?.content);
              if (t) acc = t;
              if (evt.type === 'message_end' && evt.message?.stopReason === 'error') {
                acc = acc || `⚠️ ${evt.message?.errorMessage ?? 'model error'}`;
              }
              if (build().length) yield { content: build() };
            } else if (evt.type === 'tool_execution_start') {
              tools.set(evt.toolCallId, { toolName: evt.toolName, args: evt.args });
              yield { content: build() };
            } else if (evt.type === 'tool_execution_end') {
              const t = tools.get(evt.toolCallId);
              if (t) { t.result = evt.result; t.isError = evt.isError; }
              yield { content: build() };
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
