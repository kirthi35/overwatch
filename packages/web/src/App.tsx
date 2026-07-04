import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { onAuthChange, signInGoogle, signInEmail, registerEmail, signOutUser, auth } from './firebase';
import { listModels, saveSecrets, createConversation, type ModelInfo } from './lib/api';
import { makeChatAdapter } from './lib/runtime';
import { MonitorsTab } from './tabs/MonitorsTab';
import { AlertsTab } from './tabs/AlertsTab';
import { SettingsTab } from './tabs/SettingsTab';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthChange(setUser), []);

  if (user === undefined) return <Centered>Loading…</Centered>;
  if (!user) return <AuthGate />;
  return <MainApp />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-gray-400">{children}</div>;
}

function AuthGate() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await (mode === 'in' ? signInEmail(email, pw) : registerEmail(email, pw));
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-80 rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h1 className="mb-1 text-xl font-semibold text-emerald-400">OVERWATCH</h1>
        <p className="mb-5 text-xs text-gray-500">NSE trading assistant — scout &amp; analyst, never a shooter.</p>
        <button onClick={() => signInGoogle().catch((e) => setErr(e.message))} className="mb-4 w-full rounded-lg bg-white py-2 text-sm font-medium text-gray-900 hover:bg-gray-200">
          Continue with Google
        </button>
        <div className="mb-4 text-center text-xs text-gray-600">or</div>
        <form onSubmit={submit} className="space-y-3">
          <input className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm" placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm" placeholder="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium hover:bg-emerald-500">{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="mt-3 text-xs text-gray-500 hover:text-gray-300" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}

type Tab = 'chat' | 'monitors' | 'alerts' | 'settings';
const TABS: Tab[] = ['chat', 'monitors', 'alerts', 'settings'];

function MainApp() {
  // onboarded === null: checking; false: needs creds; ModelInfo[]: ready
  const [onboarded, setOnboarded] = useState<ModelInfo[] | null | false>(null);
  const [chatKey, setChatKey] = useState(0);
  const [tab, setTab] = useState<Tab>('chat');
  const uid = auth.currentUser?.uid ?? '';

  const check = async () => {
    try {
      setOnboarded(await listModels());
    } catch {
      setOnboarded(false);
    }
  };
  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-emerald-400">OVERWATCH</span>
          {onboarded && (
            <nav className="flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-2.5 py-1 text-xs capitalize ${tab === t ? 'bg-gray-800 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  {t}
                </button>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {onboarded && tab === 'chat' && (
            <button onClick={() => setChatKey((k) => k + 1)} className="rounded border border-gray-700 px-2 py-1 hover:bg-gray-800">
              + New chat
            </button>
          )}
          <span>{auth.currentUser?.email}</span>
          <button onClick={() => signOutUser()} className="hover:text-gray-200">Sign out</button>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {onboarded === null && <Centered>Checking credentials…</Centered>}
        {onboarded === false && <Onboarding onDone={check} />}
        {onboarded && tab === 'chat' && <ChatArea key={chatKey} />}
        {onboarded && tab === 'monitors' && <MonitorsTab uid={uid} />}
        {onboarded && tab === 'alerts' && <AlertsTab uid={uid} />}
        {onboarded && tab === 'settings' && <SettingsTab uid={uid} />}
      </main>
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [groww, setGroww] = useState('');
  const [anthropic, setAnthropic] = useState('');
  const [ollama, setOllama] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!anthropic.trim() && !ollama.trim()) {
      setErr('Provide at least one LLM key (Anthropic or Ollama Cloud/GLM).');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await saveSecrets({
        growwToken: groww.trim(),
        anthropicKey: anthropic.trim() || undefined,
        ollamaKey: ollama.trim() || undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <form onSubmit={submit} className="w-96 rounded-xl border border-gray-800 bg-gray-900/60 p-6 space-y-3">
        <h2 className="text-lg font-semibold">Connect your keys</h2>
        <p className="text-xs text-gray-500">Stored encrypted, per-user. Groww token must be read-only (no trade scope). Provide at least one LLM key.</p>
        <input className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm" placeholder="Groww read-only token" value={groww} onChange={(e) => setGroww(e.target.value)} />
        <input className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm" placeholder="Anthropic API key (sk-ant-…) — optional" value={anthropic} onChange={(e) => setAnthropic(e.target.value)} />
        <input className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm" placeholder="Ollama Cloud key (GLM-5.2) — optional" value={ollama} onChange={(e) => setOllama(e.target.value)} />
        <button disabled={busy || !groww.trim()} className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save & continue'}
        </button>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </form>
    </div>
  );
}

function ChatArea() {
  const [cid, setCid] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    createConversation('New chat').then(setCid).catch((e) => setErr(e.message));
  }, []);
  if (err) return <Centered>Error: {err}</Centered>;
  if (!cid) return <Centered>Starting conversation…</Centered>;
  return <ChatThread cid={cid} />;
}

function ChatThread({ cid }: { cid: string }) {
  const adapter = useMemo(() => makeChatAdapter(cid), [cid]);
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <ThreadPrimitive.Empty>
              <div className="mt-20 text-center text-sm text-gray-600">
                Ask about a stock, a theme, or arm a monitor. e.g. “Is the Groww feed live?” or “Analyse Paras Defence.”
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </div>
        </ThreadPrimitive.Viewport>
        <div className="border-t border-gray-800 px-4 py-3">
          <ComposerPrimitive.Root className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-gray-800 bg-gray-950 px-3 py-2">
            <ComposerPrimitive.Input rows={1} autoFocus placeholder="Message Overwatch…" className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-gray-600" />
            <ComposerPrimitive.Send className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500">Send</ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-emerald-700/80 px-4 py-2 text-sm">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-gray-800/80 px-4 py-2 text-sm">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}
