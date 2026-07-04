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
      <SkillsViewer />
      <CapitalCard uid={uid} />
      <p className="text-xs text-gray-600">
        LLM + Groww keys and the active model are configured in <code className="text-gray-500">.env</code> (dev mode).
      </p>
    </div>
  );
}

function SkillsViewer() {
  const skills = useCollection<Skill>('skills');
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = [...skills].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold">Doctrine skills <span className="text-gray-600">({skills.length})</span></h3>
      <div className="space-y-1">
        {sorted.map((s) => (
          <div key={s.id} className="rounded border border-gray-800/60">
            <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/40">
              <span className="text-sm">
                <span className={s.superseded_by ? 'text-gray-500 line-through' : 'text-gray-200'}>{s.name || s.id}</span>
                {s.superseded_by && <span className="ml-2 text-[10px] text-gray-600">→ {s.superseded_by}</span>}
              </span>
              <span className="text-gray-600">{openId === s.id ? '−' : '+'}</span>
            </button>
            {openId === s.id && (
              <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-gray-800/60 bg-gray-950 p-3 text-xs text-gray-300">{s.body || s.description || '(no content)'}</pre>
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
      await setDoc(ref, {
        capital: Number(capital) || 0,
        risk_pct_per_trade: Number(riskPct) || 1.0,
        max_open_risk_pct: Number(maxHeat) || 5.0,
        asof: new Date().toISOString().slice(0, 10),
      });
      setMsg('Saved.');
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    }
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="mb-1 text-sm font-semibold">Capital book</h3>
      <p className="mb-3 text-xs text-gray-500">Drives risk budget + heat cap (portfolio-risk skill).</p>
      <form onSubmit={submit} className="space-y-2">
        <label className="block text-xs text-gray-500">Total capital (₹)
          <input className="mt-1 w-full rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-sm" inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1 text-xs text-gray-500">Risk %/trade
            <input className="mt-1 w-full rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-sm" inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
          </label>
          <label className="block flex-1 text-xs text-gray-500">Max open risk %
            <input className="mt-1 w-full rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-sm" inputMode="decimal" value={maxHeat} onChange={(e) => setMaxHeat(e.target.value)} />
          </label>
        </div>
        <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500">Save capital</button>
        {msg && <p className="text-xs text-gray-400">{msg}</p>}
      </form>
    </section>
  );
}
