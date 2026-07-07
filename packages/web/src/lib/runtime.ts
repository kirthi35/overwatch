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
        // Interleave text ↔ tool-calls by EVENT ORDER (works for GLM/OpenAI too, where tool
        // calls are NOT part of message.content). Each tool is stamped with the assistant
        // text length at the moment it fired (`at`); build() slices the text around those
        // marks. A data-fetch tool that fires before any prose lands before it — not at the end.
        let fullText = ''; // accumulated ASSISTANT text only (role-guarded → fixes the echo)
        let errText = '';
        const startedIds = new Set<string>();
        const toolMarks: { id: string; toolName: string; args: unknown; at: number }[] = [];
        const results = new Map<string, { result?: unknown; isError?: boolean }>();
        const build = (): any[] => {
          const parts: any[] = [];
          let cursor = 0;
          for (const m of toolMarks) {
            const seg = fullText.slice(cursor, m.at);
            if (seg) parts.push({ type: 'text', text: seg });
            const r = results.get(m.id) ?? {};
            parts.push({ type: 'tool-call', toolCallId: m.id, toolName: m.toolName, args: m.args ?? {}, result: r.result, isError: r.isError });
            cursor = Math.max(cursor, m.at);
          }
          const tail = fullText.slice(cursor);
          if (tail) parts.push({ type: 'text', text: tail });
          if (!parts.length && errText) parts.push({ type: 'text', text: errText });
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
              // Only the ASSISTANT's own text belongs in this bubble. The stream also
              // replays the user turn (role 'user'); ignoring it fixes the echo where the
              // bubble first showed the just-typed prompt.
              const role = evt.message?.role;
              if (role === undefined || role === 'assistant') {
                fullText = partsToText(evt.message?.content) || fullText;
              }
              if (evt.type === 'message_end' && evt.message?.stopReason === 'error') {
                errText = `⚠️ ${evt.message?.errorMessage ?? 'model error'}`;
              }
              const parts = build();
              if (parts.length) yield { content: parts };
            } else if (evt.type === 'tool_execution_start') {
              // Stamp the tool at the current text length so build() places it where it fired.
              if (!startedIds.has(evt.toolCallId)) {
                startedIds.add(evt.toolCallId);
                toolMarks.push({ id: evt.toolCallId, toolName: evt.toolName, args: evt.args, at: fullText.length });
              }
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
