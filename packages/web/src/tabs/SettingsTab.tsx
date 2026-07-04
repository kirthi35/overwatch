import { useEffect, useState, type FormEvent } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useCollection } from '../lib/useFirestore';

interface Skill {
  id: string;
  name?: string;
  description?: string;
  superseded_by?: string | null;
  body?: string;
}

export function SettingsTab({ uid }: { uid: string }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h2 className="text-sm font-semibold">Settings</h2>
      <SkillsViewer />
      <CapitalCard uid={uid} />
      <p className="text-xs text-muted">
        LLM + Groww keys and the active model are configured in <code className="rounded bg-surface-2 px-1 text-fg">.env</code> (dev mode).
      </p>
    </div>
  );
}

function SkillsViewer() {
  const skills = useCollection<Skill>('skills');
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = [...skills].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">Doctrine skills <span className="text-muted">({skills.length})</span></h3>
      <div className="space-y-1">
        {sorted.map((s) => (
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
    </section>
  );
}

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
