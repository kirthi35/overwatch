import { useEffect, useMemo, useState } from 'react';
import { useCollection, deleteMonitorDoc, fetchTheses } from '../lib/useFirestore';

interface MonState {
  fired?: boolean;
  blindLevel?: string | null;
  lastLtp?: number;
  lastRatio?: number;
  lastGreen?: boolean;
  lastPoll?: number;
  confirmedAt?: string;
}
interface Monitor {
  id: string;
  name: string;
  symbol: string;
  search_query?: string;
  segment?: string;
  poll_minutes?: number;
  time_gate_ist?: number;
  conversationId?: string;
  disabled?: boolean;
  gates?: Record<string, unknown>;
  state?: MonState;
}

function statusOf(m: Monitor): { label: string; cls: string } {
  if (m.state?.fired) return { label: 'FIRED', cls: 'bg-red-500/20 text-red-300 border-red-500/40' };
  if (m.state?.blindLevel) return { label: `BLIND (${m.state.blindLevel})`, cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40' };
  if (m.disabled) return { label: 'PAUSED', cls: 'bg-gray-600/20 text-gray-400 border-gray-600/40' };
  return { label: 'ARMED', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
}

function gateSummary(g?: Record<string, unknown>): string {
  if (!g) return '—';
  return Object.entries(g)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' · ');
}

export function MonitorsTab({ uid }: { uid: string }) {
  const monitors = useCollection<Monitor>(`users/${uid}/monitors`);
  const [selId, setSelId] = useState<string | null>(null);
  const selected = monitors.find((m) => m.id === selId) ?? null;

  return (
    <div className="flex h-full">
      <div className="w-96 shrink-0 overflow-y-auto border-r border-gray-800">
        {monitors.length === 0 && <p className="p-4 text-sm text-gray-600">No monitors armed. Ask in chat: “watch PARAS, alert if it breaks 1075”.</p>}
        {monitors.map((m) => {
          const s = statusOf(m);
          return (
            <button key={m.id} onClick={() => setSelId(m.id)} className={`block w-full border-b border-gray-800/60 px-4 py-3 text-left hover:bg-gray-800/40 ${selId === m.id ? 'bg-gray-800/60' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.symbol}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${s.cls}`}>{s.label}</span>
              </div>
              <div className="mt-1 truncate text-xs text-gray-500">{gateSummary(m.gates)}</div>
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {!selected ? <p className="text-sm text-gray-600">Select a monitor.</p> : <MonitorDetail uid={uid} m={selected} />}
      </div>
    </div>
  );
}

function MonitorDetail({ uid, m }: { uid: string; m: Monitor }) {
  const s = statusOf(m);
  const [theses, setTheses] = useState<Array<Record<string, any> & { id: string }>>([]);
  useEffect(() => {
    fetchTheses(uid).then(setTheses).catch(() => {});
  }, [uid]);
  const linked = useMemo(
    () => theses.filter((t) => String(t.symbol || '').toUpperCase() === m.symbol.toUpperCase() || t.id.includes(m.symbol.toLowerCase())),
    [theses, m.symbol],
  );
  const polled = m.state?.lastPoll ? new Date(m.state.lastPoll).toLocaleString() : '—';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{m.symbol}</h2>
          <p className="text-xs text-gray-500">{m.name} · poll {m.poll_minutes ?? 1}m{m.time_gate_ist ? ` · after ${m.time_gate_ist} IST` : ''}</p>
        </div>
        <span className={`rounded border px-2 py-1 text-xs ${s.cls}`}>{s.label}</span>
      </div>

      <Section title="Gates">
        <pre className="whitespace-pre-wrap text-xs text-gray-300">{JSON.stringify(m.gates ?? {}, null, 2)}</pre>
      </Section>

      <Section title="Live state (last polled — STALE, not a live quote)">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field k="Last LTP" v={m.state?.lastLtp ?? '—'} />
          <Field k="Sell:Buy" v={m.state?.lastRatio != null ? `${m.state.lastRatio}:1` : '—'} />
          <Field k="Last green candle" v={String(m.state?.lastGreen ?? '—')} />
          <Field k="Last polled" v={polled} />
          {m.state?.confirmedAt && <Field k="Fired at" v={new Date(m.state.confirmedAt).toLocaleString()} />}
        </div>
      </Section>

      <Section title="Thesis">
        {linked.length === 0 ? (
          <p className="text-xs text-gray-600">No thesis document linked for {m.symbol}.</p>
        ) : (
          linked.map((t) => (
            <pre key={t.id} className="mb-2 whitespace-pre-wrap rounded bg-gray-950 p-3 text-xs text-gray-300">
              <span className="text-emerald-400">{t.id}</span>
              {'\n'}
              {JSON.stringify(t, null, 2)}
            </pre>
          ))
        )}
      </Section>

      {m.conversationId && <p className="text-xs text-gray-600">Armed from conversation <span className="text-gray-400">{m.conversationId}</span></p>}

      <button
        onClick={() => { void deleteMonitorDoc(uid, m.id); }}
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20"
      >
        Disarm monitor
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  );
}
function Field({ k, v }: { k: string; v: unknown }) {
  return (
    <div className="rounded bg-gray-950 px-2 py-1.5">
      <div className="text-[10px] uppercase text-gray-600">{k}</div>
      <div className="text-gray-200">{String(v)}</div>
    </div>
  );
}
