import { useMemo, useState } from 'react';
import { useCollection } from '../lib/useFirestore';
import { effectiveStatus, computeAudit, type Trade, type TradeStatus } from '../lib/trades';

// Trades = the audit spine (ADR 0005). Every trade carries its thesis (why), plan, gates,
// and — once closed — a verdict (thesis right? rules followed?). Monitors + alerts link by
// tradeId. Read-only: it surfaces trades, it never places an order (D1).

interface MonitorRow { id: string; name?: string; symbol?: string; tradeId?: string }
interface AlertRow { id: string; ts?: string; severity?: string; message?: string; tradeId?: string }

const STATUS_STYLE: Record<TradeStatus, string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-500',
  CARDED: 'bg-sky-500/15 text-sky-500',
  WATCHING: 'bg-zinc-500/15 text-zinc-400',
  CLOSED: 'bg-zinc-500/15 text-zinc-400',
  ABANDONED: 'bg-zinc-500/15 text-zinc-500',
};

// User-facing labels — internal status stays CARDED (the pre-trade-commit domain term),
// but "Planned" reads clearly: the plan is set, the trade isn't entered yet.
const STATUS_LABEL: Record<TradeStatus, string> = {
  OPEN: 'Open',
  CARDED: 'Planned',
  WATCHING: 'Watching',
  CLOSED: 'Closed',
  ABANDONED: 'Abandoned',
};

function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-IN') : '—';
}
function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(0)}%`;
}
function r2(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-500' : tone === 'bad' ? 'text-red-500' : '';
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function AuditCard({ t, monitors, alerts }: { t: Trade; monitors: MonitorRow[]; alerts: AlertRow[] }) {
  const st = effectiveStatus(t);
  const c = t.close;
  const plan = { ...(t.card ?? {}), ...(t.position ?? {}) } as Record<string, any>;
  const zone = Array.isArray(plan.entry_zone) ? plan.entry_zone.join('–') : undefined;
  const overridden = t.gates?.overridden ?? [];
  const followed = overridden.length === 0;
  const linkedMon = monitors.filter((m) => t.tradeId && m.tradeId === t.tradeId);
  const linkedAlerts = alerts.filter((a) => t.tradeId && a.tradeId === t.tradeId);
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{t.symbol ?? t.tradeId}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[st]}`}>{STATUS_LABEL[st]}</span>
        {st === 'CLOSED' && typeof c?.realized_R === 'number' && (
          <span className={`ml-auto text-sm font-semibold ${c.realized_R >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{r2(c.realized_R)}</span>
        )}
      </div>

      {/* WHY — the thesis, carried to the close */}
      {t.thesis?.why && <p className="mt-2 text-xs text-fg"><span className="text-muted">why: </span>{t.thesis.why}</p>}

      {/* PLAN */}
      {(zone || plan.entry != null || plan.stop != null) && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
          {zone && <span>zone ₹{zone}</span>}
          {plan.entry != null && <span>entry ₹{num(plan.entry)}</span>}
          {plan.stop != null && <span>stop ₹{num(plan.stop)}</span>}
          {plan.T1 != null && <span>T1 ₹{num(plan.T1)}</span>}
          {plan.shares != null && <span>{num(plan.shares)} sh</span>}
        </div>
      )}

      {/* GATES — rules followed or overridden */}
      <p className={`mt-1 text-[11px] ${followed ? 'text-emerald-500' : 'text-red-500'}`}>
        {followed ? '✓ rules followed' : `✗ overridden: ${overridden.join(', ')}`}
      </p>

      {/* CLOSED verdict */}
      {st === 'CLOSED' && c && (
        <div className="mt-1 text-[11px] text-muted">
          {c.exit_price != null && <span>exit ₹{num(c.exit_price)} · </span>}
          thesis <span className={c.thesis_verdict === 'RIGHT' ? 'text-emerald-500' : c.thesis_verdict === 'WRONG' ? 'text-red-500' : ''}>{c.thesis_verdict ?? '?'}</span>
          {c.one_line_lesson && <p className="mt-0.5 italic">{c.one_line_lesson}</p>}
        </div>
      )}

      {/* LINKS — the audit trail: conversation, monitors, alerts */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
        {t.conversationId && <span className="rounded bg-surface-2 px-1.5 py-0.5">💬 conv {String(t.conversationId).slice(0, 6)}</span>}
        <span className="rounded bg-surface-2 px-1.5 py-0.5">📡 {linkedMon.length} monitor{linkedMon.length === 1 ? '' : 's'}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5">🔔 {linkedAlerts.length} alert{linkedAlerts.length === 1 ? '' : 's'}</span>
        <button onClick={() => setOpen((o) => !o)} className="ml-auto hover:text-fg">{open ? 'hide' : 'audit'}</button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2 text-[11px]">
          {linkedMon.length > 0 && (
            <div><span className="text-muted">monitors: </span>{linkedMon.map((m) => m.name).join(', ')}</div>
          )}
          {linkedAlerts.length > 0 && (
            <div>
              <span className="text-muted">alerts:</span>
              {linkedAlerts.slice(0, 5).map((a) => (
                <div key={a.id} className="text-muted">· [{(a.severity || '').toUpperCase()}] {a.message}</div>
              ))}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-muted hover:text-fg">raw</summary>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[10px] text-muted">{JSON.stringify(t, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function Column({ title, hint, items, monitors, alerts }: { title: string; hint: string; items: Trade[]; monitors: MonitorRow[]; alerts: AlertRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        {title}
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">{items.length}</span>
      </h3>
      <p className="-mt-1 text-[10px] text-muted">{hint}</p>
      {items.length === 0 ? <p className="text-xs text-muted">—</p> : items.map((t) => <AuditCard key={t.id} t={t} monitors={monitors} alerts={alerts} />)}
    </section>
  );
}

export function TradesTab({ uid }: { uid: string }) {
  const tradesRaw = useCollection<Trade>(`users/${uid}/trades`, 'updatedAt', 'desc');
  const monitors = useCollection<MonitorRow>(`users/${uid}/monitors`);
  const alerts = useCollection<AlertRow>(`users/${uid}/alerts`, 'ts', 'desc');
  const trades = tradesRaw as unknown as Trade[];

  const audit = useMemo(() => computeAudit(trades), [trades]);
  const byStatus = (s: TradeStatus) => trades.filter((t) => effectiveStatus(t) === s);
  const open = byStatus('OPEN');
  const carded = byStatus('CARDED');
  const watching = byStatus('WATCHING');
  const closed = byStatus('CLOSED');

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Trades</h2>
        <span className="text-xs text-muted">the trade lifecycle + audit · read-only</span>
      </div>

      {/* Scorecard — expectancy split by adherence answers "is the doctrine right?" */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Closed" value={String(audit.closed)} />
        <Stat label="Win rate" value={pct(audit.winRate)} />
        <Stat label="Expectancy · rules followed" value={r2(audit.expAdherent)} tone={audit.expAdherent != null ? (audit.expAdherent >= 0 ? 'good' : 'bad') : undefined} />
        <Stat label="Expectancy · rule-breaks" value={r2(audit.expRuleBreak)} tone={audit.expRuleBreak != null ? (audit.expRuleBreak >= 0 ? 'good' : 'bad') : undefined} />
        <Stat label="Gate overrides" value={String(audit.overrides)} tone={audit.overrides > 0 ? 'bad' : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Column title="Open" hint="in the position" items={open} monitors={monitors} alerts={alerts} />
        <Column title="Planned" hint="plan set · not entered yet" items={carded} monitors={monitors} alerts={alerts} />
        <Column title="Watching" hint="analysing · no plan yet" items={watching} monitors={monitors} alerts={alerts} />
        <Column title="Closed" hint="exited · with verdict" items={closed} monitors={monitors} alerts={alerts} />
      </div>

      {trades.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          No trades yet. As the pipeline runs — a thesis, a trade card, a fill, a close — each
          trade appears here with its why, plan, gates, linked monitors/alerts, and (on close)
          a verdict. "Expectancy · rules followed" is the number that tells you the doctrine works.
        </p>
      )}
    </div>
  );
}
