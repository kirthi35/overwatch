import { useMemo } from 'react';
import { useCollection } from '../lib/useFirestore';
import {
  correlateTrades,
  computeExpectancy,
  type ThesisDoc,
  type JournalRow,
  type LiveTrade,
  type LifecycleStatus,
} from '../lib/trades';

// Trades tab — the per-user trade lifecycle, correlated by symbol from the docs the
// doctrine skills already emit (<sym> / <sym>-card / <sym>-active-position) + the
// append-only journal. Read-only: it surfaces trades, it never places an order (D1).
// See docs/adr/0004.

const STATUS_STYLE: Record<LifecycleStatus | 'CLOSED', string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-500',
  CARDED: 'bg-sky-500/15 text-sky-500',
  WATCHING: 'bg-muted/15 text-muted',
  CLOSED: 'bg-zinc-500/15 text-zinc-400',
};

function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-IN') : '—';
}
function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(0)}%`;
}
function r2(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

// Merge a trade's docs (thesis < card < position precedence) so the summary can read
// whatever fields exist without caring which doc carried them.
function mergedFields(t: LiveTrade): Record<string, unknown> {
  return { ...(t.thesis ?? {}), ...(t.card ?? {}), ...(t.position ?? {}) };
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-semibold ${alert ? 'text-red-500' : ''}`}>{value}</div>
    </div>
  );
}

function LiveCard({ t }: { t: LiveTrade }) {
  const f = mergedFields(t);
  const zone = Array.isArray(f.entry_zone) ? (f.entry_zone as unknown[]).join('–') : undefined;
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{t.symbol}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[t.status]}`}>{t.status}</span>
        {typeof f.mode === 'string' && <span className="text-[10px] text-muted">{f.mode}</span>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted">
        {zone && <><dt>zone</dt><dd className="text-right text-fg">₹{zone}</dd></>}
        {f.entry != null && <><dt>entry</dt><dd className="text-right text-fg">₹{num(f.entry)}</dd></>}
        {f.stop != null && <><dt>stop</dt><dd className="text-right text-fg">₹{num(f.stop)}</dd></>}
        {f.T1 != null && <><dt>T1</dt><dd className="text-right text-fg">₹{num(f.T1)}</dd></>}
        {f.T2 != null && <><dt>T2</dt><dd className="text-right text-fg">₹{num(f.T2)}</dd></>}
        {f.shares != null && <><dt>shares</dt><dd className="text-right text-fg">{num(f.shares)}</dd></>}
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted hover:text-fg">raw docs</summary>
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[10px] text-muted">
{JSON.stringify({ thesis: t.thesis, card: t.card, position: t.position }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function ClosedCard({ r }: { r: JournalRow }) {
  const overrides = r.gates_overridden?.length ?? 0;
  const win = typeof r.realized_R === 'number' && r.realized_R > 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{r.symbol}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE.CLOSED}`}>CLOSED</span>
        {typeof r.realized_R === 'number' && (
          <span className={`ml-auto text-sm font-semibold ${win ? 'text-emerald-500' : 'text-red-500'}`}>{r2(r.realized_R)}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
        {r.entry != null && <span>entry ₹{num(r.entry)}</span>}
        {r.exit_price != null && <span>exit ₹{num(r.exit_price)}</span>}
        {r.hold_days != null && <span>{num(r.hold_days)}d</span>}
        {r.exit_date && <span>{r.exit_date}</span>}
      </div>
      {overrides > 0 && (
        <p className="mt-1 text-[11px] text-red-500">⚠ {overrides} gate{overrides === 1 ? '' : 's'} overridden — adherence failure</p>
      )}
      {r.one_line_lesson && <p className="mt-1 text-[11px] italic text-muted">{r.one_line_lesson}</p>}
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        {title}
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">{count}</span>
      </h3>
      {count === 0 ? <p className="text-xs text-muted">—</p> : children}
    </section>
  );
}

export function TradesTab({ uid }: { uid: string }) {
  const thesesRaw = useCollection<Record<string, unknown>>(`users/${uid}/theses`);
  const journal = useCollection<JournalRow>(`users/${uid}/journal`, 'ts', 'desc');

  const live = useMemo(() => correlateTrades(thesesRaw as unknown as ThesisDoc[]), [thesesRaw]);
  const exp = useMemo(() => computeExpectancy(journal as unknown as JournalRow[]), [journal]);

  const open = live.filter((t) => t.status === 'OPEN');
  const carded = live.filter((t) => t.status === 'CARDED');
  const watching = live.filter((t) => t.status === 'WATCHING');

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Trades</h2>
        <span className="text-xs text-muted">the trade lifecycle from your doctrine pipeline · read-only</span>
      </div>

      {/* Expectancy / adherence — the feedback loop over CLOSED trades */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Closed" value={String(exp.closedCount)} />
        <Stat label="Win rate" value={pct(exp.winRate)} />
        <Stat label="Expectancy" value={r2(exp.expectancy)} />
        <Stat label="Avg adherence" value={pct(exp.avgAdherence)} />
        <Stat label="Gate overrides" value={String(exp.overrides)} alert={exp.overrides > 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Column title="Open" count={open.length}>{open.map((t) => <LiveCard key={t.symbol} t={t} />)}</Column>
        <Column title="Carded" count={carded.length}>{carded.map((t) => <LiveCard key={t.symbol} t={t} />)}</Column>
        <Column title="Watching" count={watching.length}>{watching.map((t) => <LiveCard key={t.symbol} t={t} />)}</Column>
        <Column title="Closed" count={journal.length}>{journal.map((r) => <ClosedCard key={r.id} r={r as unknown as JournalRow} />)}</Column>
      </div>

      {live.length === 0 && journal.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          No trades yet. As the doctrine pipeline runs — a thesis, then a trade card, then a
          fill, then a close — trades appear here across the four stages.
        </p>
      )}
    </div>
  );
}
