import { useState } from 'react';
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

const SEV: Record<string, string> = {
  CRITICAL: 'text-red-400',
  WARNING: 'text-orange-400',
  INFO: 'text-sky-400',
};
const DOT: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  WARNING: 'bg-orange-500',
  INFO: 'bg-sky-500',
};

export function AlertsTab({ uid }: { uid: string }) {
  const alerts = useCollection<Alert>(`users/${uid}/alerts`, 'ts', 'desc');
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
  const shown = alerts.filter((a) => filter === 'ALL' || (a.severity || '').toUpperCase() === filter);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center gap-2">
        {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
            {f}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600">{shown.length} alert{shown.length === 1 ? '' : 's'}</span>
      </div>

      {shown.length === 0 && <p className="text-sm text-gray-600">No alerts yet. Fires from your monitors show up here.</p>}

      <div className="space-y-2">
        {shown.map((a) => {
          const sev = (a.severity || 'INFO').toUpperCase();
          return (
            <div key={a.id} className="flex gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[sev] ?? 'bg-gray-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${SEV[sev] ?? 'text-gray-400'}`}>{sev}</span>
                  {a.label && <span className="text-gray-300">{a.label}</span>}
                  {a.terminal && <span className="rounded bg-red-500/20 px-1 text-[10px] text-red-300">terminal</span>}
                  <span className="ml-auto text-gray-600">{a.ts ? new Date(a.ts).toLocaleString() : ''}</span>
                </div>
                <p className="mt-1 text-sm text-gray-200">{a.message}</p>
                {a.monitorName && <p className="mt-0.5 text-[11px] text-gray-600">monitor: {a.monitorName}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
