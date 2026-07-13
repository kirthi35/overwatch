import { useEffect, useState, type FormEvent } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useCollection } from '../lib/useFirestore';
import { listComposioConnections, connectComposio, disconnectComposio, type ComposioConnection } from '../lib/api';

type Category = 'constitution' | 'skill' | 'shared' | 'lesson';

interface Skill {
  id: string;
  name?: string;
  category?: Category;
  description?: string;
  superseded_by?: string | null;
  body?: string;
}

export function SettingsTab({ uid }: { uid: string }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h2 className="text-sm font-semibold">Settings</h2>
      <CapitalCard uid={uid} />
      <IntegrationsCard />
      <SectorMapCard uid={uid} />
      <DoctrineViewer />
      <p className="text-xs text-muted">
        LLM + Groww keys and the active model are configured in <code className="rounded bg-surface-2 px-1 text-fg">.env</code> (dev mode).
      </p>
    </div>
  );
}

// ── Doctrine viewer (read-only): Constitution / Skills / Shared / Lessons ──────────
const GROUPS: { category: Category; title: string; blurb: string }[] = [
  { category: 'constitution', title: 'Constitution', blurb: 'Standing orders — outrank every skill.' },
  { category: 'skill', title: 'Doctrine skills', blurb: 'The staged analysis pipeline.' },
  { category: 'shared', title: 'Shared protocols', blurb: 'Read by the analytical stages.' },
  { category: 'lesson', title: 'Lessons', blurb: 'Graded case evidence doctrine cites (evidence: L-*).' },
];

function DoctrineViewer() {
  const skills = useCollection<Skill>('skills');
  const [openId, setOpenId] = useState<string | null>(null);
  // Default missing category to 'skill' so docs seeded before categories still render.
  const cat = (s: Skill): Category => s.category ?? 'skill';

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">Doctrine <span className="text-muted">({skills.length})</span> <span className="ml-1 text-xs font-normal text-muted">read-only</span></h3>
      {skills.length === 0 && (
        <p className="text-xs text-muted">No doctrine published yet. Run <code className="rounded bg-surface-2 px-1">seed-skills</code> on the server.</p>
      )}
      <div className="space-y-4">
        {GROUPS.map((g) => {
          const items = skills
            .filter((s) => cat(s) === g.category)
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
          if (items.length === 0) return null;
          return (
            <div key={g.category}>
              <div className="mb-1 flex items-baseline gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-accent">{g.title}</h4>
                <span className="text-[10px] text-muted">{g.blurb}</span>
              </div>
              <div className="space-y-1">
                {items.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border/60">
                    <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-2">
                      <span className="text-sm">
                        <span className={s.superseded_by ? 'text-muted line-through' : 'text-fg'}>{s.name || s.id}</span>
                        {s.superseded_by && <span className="ml-2 text-[10px] text-muted">→ {s.superseded_by}</span>}
                      </span>
                      <span className="text-muted">{openId === s.id ? '−' : '+'}</span>
                    </button>
                    {openId === s.id && (
                      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-border/60 bg-surface-2 p-3 text-xs text-muted">{s.body || s.description || '(no content)'}</pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Integrations (Composio connected apps) ─────────────────────────────────────────
function IntegrationsCard() {
  const [enabled, setEnabled] = useState(true);
  const [conns, setConns] = useState<ComposioConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // toolkit currently connecting/disconnecting
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const r = await listComposioConnections();
      setEnabled(r.enabled);
      setConns(r.connections);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const connect = async (toolkit: string) => {
    setBusy(toolkit); setErr('');
    try {
      const { redirectUrl } = await connectComposio(toolkit);
      // Open Composio-hosted OAuth in a new tab; user returns to the app after consent.
      window.open(redirectUrl, '_blank', 'noopener');
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async (toolkit: string) => {
    setBusy(toolkit); setErr('');
    try {
      await disconnectComposio(toolkit);
      await load();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!loading && !enabled) return null; // Composio not configured on the server — hide the card.

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold">Integrations</h3>
      <p className="mb-3 text-xs text-muted">Connect your apps so the assistant can act on them (email, calendar, GitHub, Slack, Notion). Auth is handled by Composio; tokens never touch Overwatch.</p>
      {loading && <p className="text-xs text-muted">Loading…</p>}
      <div className="space-y-1">
        {conns.map((c) => (
          <div key={c.toolkit} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <span className="text-sm">
              {c.name}
              {c.connected
                ? <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">connected</span>
                : <span className="ml-2 text-[10px] text-muted">not connected</span>}
            </span>
            {c.connected ? (
              <button disabled={busy === c.toolkit} onClick={() => disconnect(c.toolkit)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50">Disconnect</button>
            ) : (
              <button disabled={busy === c.toolkit} onClick={() => connect(c.toolkit)} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">Connect</button>
            )}
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
    </section>
  );
}

// ── Capital book ──────────────────────────────────────────────────────────────────
function CapitalCard({ uid }: { uid: string }) {
  const ref = doc(db, `users/${uid}/settings/capital`);
  const [capital, setCapital] = useState('');
  const [riskPct, setRiskPct] = useState('1.0');
  const [maxHeat, setMaxHeat] = useState('5.0');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(ref).then((s) => {
      const d = s.data() as any;
      if (d) { setCapital(String(d.capital ?? '')); setRiskPct(String(d.risk_pct_per_trade ?? '1.0')); setMaxHeat(String(d.max_open_risk_pct ?? '5.0')); }
    }).catch(() => {});
  }, [uid]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await setDoc(ref, { capital: Number(capital) || 0, risk_pct_per_trade: Number(riskPct) || 1.0, max_open_risk_pct: Number(maxHeat) || 5.0, asof: new Date().toISOString().slice(0, 10) });
      setMsg('Saved.');
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    }
  };

  const input = 'mt-1 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent';
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold">Capital book</h3>
      <p className="mb-3 text-xs text-muted">Drives risk budget + heat cap (portfolio-risk skill).</p>
      <form onSubmit={submit} className="max-w-md space-y-2">
        <label className="block text-xs text-muted">Total capital (₹)
          <input className={input} inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1 text-xs text-muted">Risk %/trade
            <input className={input} inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
          </label>
          <label className="block flex-1 text-xs text-muted">Max open risk %
            <input className={input} inputMode="decimal" value={maxHeat} onChange={(e) => setMaxHeat(e.target.value)} />
          </label>
        </div>
        <button className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90">Save capital</button>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </form>
    </section>
  );
}

// ── Sector → index map (regime-gate Stage 0) ────────────────────────────────────────
interface MapRow { sector: string; index: string }

function SectorMapCard({ uid }: { uid: string }) {
  const ref = doc(db, `users/${uid}/settings/sectorMap`);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(ref).then((s) => {
      const m = (s.data() as any)?.map as Record<string, string> | undefined;
      if (m) setRows(Object.entries(m).map(([sector, index]) => ({ sector, index: String(index) })));
    }).catch(() => {});
  }, [uid]);

  const setRow = (i: number, patch: Partial<MapRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { sector: '', index: '' }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    setMsg('');
    const map: Record<string, string> = {};
    for (const r of rows) {
      const k = r.sector.trim();
      const v = r.index.trim();
      if (k && v) map[k] = v;
    }
    try {
      await setDoc(ref, { map, asof: new Date().toISOString().slice(0, 10) });
      setMsg(`Saved ${Object.keys(map).length} mapping${Object.keys(map).length === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    }
  };

  const input = 'rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent';
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold">Sector → index map</h3>
      <p className="mb-3 text-xs text-muted">Maps a stock's sector to its proxy index for the regime gate. Unmapped sectors fall back to Nifty 500.</p>
      <div className="max-w-xl space-y-2">
        {rows.length === 0 && <p className="text-xs text-muted">No mappings yet.</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={`${input} flex-1`} placeholder="sector (e.g. defence)" value={r.sector} onChange={(e) => setRow(i, { sector: e.target.value })} />
            <span className="text-muted">→</span>
            <input className={`${input} flex-1`} placeholder="index (e.g. NIFTY INDIA DEFENCE)" value={r.index} onChange={(e) => setRow(i, { index: e.target.value })} />
            <button onClick={() => delRow(i)} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-surface-2" aria-label="remove">✕</button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={addRow} className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2">+ Add mapping</button>
          <button onClick={save} className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90">Save map</button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>
    </section>
  );
}
