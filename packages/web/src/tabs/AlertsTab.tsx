import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useCollection } from '../lib/useFirestore';

interface Alert {
  id: string;
  ts?: string;
  severity?: string;
  label?: string;
  message?: string;
  monitorName?: string;
  conversationId?: string;
  terminal?: boolean;
}

const SEV: Record<string, string> = { CRITICAL: 'text-red-500', WARNING: 'text-orange-500', INFO: 'text-sky-500' };
const DOT: Record<string, string> = { CRITICAL: 'bg-red-500', WARNING: 'bg-orange-500', INFO: 'bg-sky-500' };

export function AlertsTab({ uid, onOpenChat }: { uid: string; onOpenChat?: (cid: string) => void }) {
  const alerts = useCollection<Alert>(`users/${uid}/alerts`, 'ts', 'desc');
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
  const shown = alerts.filter((a) => filter === 'ALL' || (a.severity || '').toUpperCase() === filter);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="mr-2 text-sm font-semibold">Alerts</h2>
        {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-accent/40 bg-[var(--accent-soft)] text-accent' : 'border-border text-muted hover:bg-surface-2'}`}>
            {f}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">{shown.length} alert{shown.length === 1 ? '' : 's'}</span>
      </div>

      {shown.length === 0 && <p className="text-sm text-muted">No alerts yet. Fires from your monitors show up here.</p>}

      <div className="space-y-2">
        {shown.map((a) => {
          const sev = (a.severity || 'INFO').toUpperCase();
          return (
            <div key={a.id} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[sev] ?? 'bg-muted'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${SEV[sev] ?? 'text-muted'}`}>{sev}</span>
                  {a.label && <span className="text-fg">{a.label}</span>}
                  {a.terminal && <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-500">terminal</span>}
                  <span className="ml-auto text-muted">{a.ts ? new Date(a.ts).toLocaleString() : ''}</span>
                </div>
                <p className="mt-1 text-sm">{a.message}</p>
                {a.monitorName && <p className="mt-0.5 text-[11px] text-muted">monitor: {a.monitorName}</p>}
                {a.conversationId && onOpenChat && (
                  <button
                    onClick={() => onOpenChat(a.conversationId!)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <MessageSquare size={12} /> Discuss in chat
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
