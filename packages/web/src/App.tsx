import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, ComposerPrimitive, MessagePrimitive, ActionBarPrimitive, useMessagePartText, type ThreadMessageLike } from '@assistant-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Flame, MessageSquare, Radar, Bell, Settings as SettingsIcon, Sun, Moon, Plus, Trash2, LogOut, ArrowUp, Copy, Check, LineChart, Square, Menu } from 'lucide-react';
import { onAuthChange, signInGoogle, signInEmail, registerEmail, signOutUser, auth } from './firebase';
import { listModels, createConversation, deleteConversation, type ModelInfo } from './lib/api';
import { makeChatAdapter } from './lib/runtime';
import { useCollection, fetchMessages } from './lib/useFirestore';
import { useTheme } from './lib/theme';
import { MonitorsTab } from './tabs/MonitorsTab';
import { AlertsTab } from './tabs/AlertsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { TradesTab } from './tabs/TradesTab';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthChange(setUser), []);
  if (user === undefined) return <Centered>Loading…</Centered>;
  if (!user) return <AuthGate />;
  return <MainApp />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">{children}</div>;
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
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <div className="w-[360px] rounded-2xl border border-border bg-surface p-7 shadow-xl shadow-black/5">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg"><Flame size={18} /></span>
          <div>
            <div className="text-lg font-semibold tracking-tight">Overwatch</div>
            <div className="text-xs text-muted">NSE scout &amp; analyst — never a shooter</div>
          </div>
        </div>
        <button onClick={() => signInGoogle().catch((e) => setErr(e.message))} className="mb-4 w-full rounded-xl border border-border bg-surface-2 py-2.5 text-sm font-medium hover:bg-border/40">
          Continue with Google
        </button>
        <div className="mb-4 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <form onSubmit={submit} className="space-y-3">
          <input className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent" placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent" placeholder="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-accent-fg hover:opacity-90">{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="mt-3 text-xs text-muted hover:text-fg" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        {err && <p className="mt-3 text-xs text-red-500">{err}</p>}
      </div>
    </div>
  );
}

type Tab = 'chat' | 'trades' | 'monitors' | 'alerts' | 'settings';
const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={17} /> },
  { id: 'trades', label: 'Trades', icon: <LineChart size={17} /> },
  { id: 'monitors', label: 'Monitors', icon: <Radar size={17} /> },
  { id: 'alerts', label: 'Alerts', icon: <Bell size={17} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={17} /> },
];

function MainApp() {
  const [onboarded, setOnboarded] = useState<ModelInfo[] | null | false>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const { dark, toggle } = useTheme();
  const uid = auth.currentUser?.uid ?? '';

  useEffect(() => {
    listModels().then(setOnboarded).catch(() => setOnboarded(false));
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TopBar tab={tab} setTab={setTab} dark={dark} toggle={toggle} />
      <main className="min-h-0 min-w-0 flex-1">
        {onboarded === null && <Centered>Checking configuration…</Centered>}
        {onboarded === false && <Centered>No LLM key found. Set ANTHROPIC_API_KEY or OLLAMA_API_KEY in .env and restart the server.</Centered>}
        {onboarded && tab === 'chat' && <ChatArea uid={uid} />}
        {onboarded && tab === 'trades' && <TradesTab uid={uid} />}
        {onboarded && tab === 'monitors' && <MonitorsTab uid={uid} />}
        {onboarded && tab === 'alerts' && <AlertsTab uid={uid} />}
        {onboarded && tab === 'settings' && <SettingsTab uid={uid} />}
      </main>
    </div>
  );
}

// Top navbar: logo · horizontal tabs (icon-only on mobile, +label on md) · theme · account.
// Tabs scroll horizontally if the viewport is very narrow.
function TopBar({ tab, setTab, dark, toggle }: { tab: Tab; setTab: (t: Tab) => void; dark: boolean; toggle: () => void }) {
  const email = auth.currentUser?.email ?? '?';
  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 py-1.5 sm:px-3">
      <span className="mr-1 flex shrink-0 items-center gap-2 pl-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg"><Flame size={15} /></span>
        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Overwatch</span>
      </span>
      <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            title={n.label}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
              tab === n.id ? 'bg-[var(--accent-soft)] font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            {n.icon}
            <span className="hidden md:inline">{n.label}</span>
          </button>
        ))}
      </nav>
      <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'} className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg">
        {dark ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <span className="ml-1 hidden max-w-[180px] truncate text-xs text-muted lg:inline">{email}</span>
      <span className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg lg:hidden" title={email}>{email[0]?.toUpperCase()}</span>
      <button onClick={() => signOutUser()} title="Sign out" className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"><LogOut size={15} /></button>
    </header>
  );
}

interface Convo { id: string; title?: string; updatedAt?: string }

function ChatArea({ uid }: { uid: string }) {
  const convos = useCollection<Convo>(`users/${uid}/conversations`, 'updatedAt', 'desc');
  const [activeCid, setActiveCid] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState(false); // mobile conversation drawer

  useEffect(() => {
    if (!activeCid && convos.length > 0) setActiveCid(convos[0].id);
  }, [convos, activeCid]);

  const newChat = async () => {
    setCreating(true);
    try {
      setActiveCid(await createConversation('New chat'));
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const activeTitle = convos.find((c) => c.id === activeCid)?.title || 'New chat';

  return (
    <div className="relative flex h-full">
      {/* Conversation list — static column on md+, slide-in drawer on mobile. */}
      <aside
        className={`absolute inset-y-0 left-0 z-20 flex w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform md:static md:z-auto md:translate-x-0 ${
          drawer ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        }`}
      >
        <div className="p-3">
          <button onClick={newChat} disabled={creating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
            <Plus size={16} /> New chat
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {convos.length === 0 && <p className="px-2 py-2 text-xs text-muted">No conversations yet.</p>}
          {convos.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-lg ${activeCid === c.id ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}>
              <button onClick={() => { setActiveCid(c.id); setDrawer(false); }} className="min-w-0 flex-1 px-3 py-2 text-left">
                <div className="truncate text-sm">{c.title || 'New chat'}</div>
                <div className="text-[10px] text-muted">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ''}</div>
              </button>
              <button
                title="Delete"
                onClick={async () => { try { await deleteConversation(c.id); if (activeCid === c.id) setActiveCid(null); } catch (e) { console.error(e); } }}
                className="mr-1.5 rounded-md p-1 text-muted opacity-0 hover:bg-border/50 hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      {/* Mobile backdrop when the drawer is open. */}
      {drawer && <div onClick={() => setDrawer(false)} className="fixed inset-0 z-10 bg-black/40 md:hidden" />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile chat header: open conversations drawer + new chat. */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <button onClick={() => setDrawer(true)} title="Conversations" className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><Menu size={18} /></button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{activeTitle}</span>
          <button onClick={newChat} title="New chat" className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><Plus size={18} /></button>
        </div>
        <div className="min-h-0 flex-1">
          {activeCid ? <ChatThread key={activeCid} cid={activeCid} uid={uid} /> : <Centered>Start a new chat.</Centered>}
        </div>
      </div>
    </div>
  );
}

function cleanMonitor(text: string): string {
  return `🔔 ${text.split('ACT NOW')[0].trim()}`;
}

function ChatThread({ cid, uid }: { cid: string; uid: string }) {
  const [initial, setInitial] = useState<ThreadMessageLike[] | null>(null);
  useEffect(() => {
    fetchMessages(uid, cid)
      .then((ms) =>
        setInitial(
          ms
            .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'custom')
            .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.role === 'custom' ? cleanMonitor(m.content) : m.content }))
            .filter((m) => m.content.trim() !== ''),
        ),
      )
      .catch(() => setInitial([]));
  }, [cid, uid]);
  if (initial === null) return <Centered>Loading…</Centered>;
  return <ChatRuntime cid={cid} initialMessages={initial} />;
}

function ChatRuntime({ cid, initialMessages }: { cid: string; initialMessages: ThreadMessageLike[] }) {
  const adapter = useMemo(() => makeChatAdapter(cid), [cid]);
  const runtime = useLocalRuntime(adapter, { initialMessages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto w-full max-w-none space-y-5">
            <ThreadPrimitive.Empty>
              <div className="mt-24 text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-accent"><Flame size={22} /></span>
                <div className="text-sm text-muted">Ask about a stock, a theme, or arm a monitor.<br />e.g. “Is the Groww feed live?” · “Analyse Paras Defence.”</div>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <RunningIndicator />
          </div>
        </ThreadPrimitive.Viewport>
        <div className="px-4 pb-4">
          <ComposerPrimitive.Root className="mx-auto flex w-full max-w-none items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 shadow-sm focus-within:border-accent">
            <ComposerPrimitive.Input rows={1} autoFocus placeholder="Message Overwatch…" className="flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted" />
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-fg hover:opacity-90" title="Send"><ArrowUp size={16} /></ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-2 text-fg hover:bg-border" title="Stop"><Square size={14} /></ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </ComposerPrimitive.Root>
          <p className="mx-auto mt-2 w-full max-w-none text-center text-[10px] text-muted">Overwatch is a scout &amp; analyst — it never places orders. Not financial advice.</p>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function RunningIndicator() {
  // "thinking…" while a turn is in flight (before/while the assistant streams).
  return (
    <ThreadPrimitive.If running>
      <div className="flex items-center gap-2 pl-10 text-xs text-muted">
        <span className="flex gap-1 text-muted">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
        </span>
        thinking…
      </div>
    </ThreadPrimitive.If>
  );
}

function MarkdownText() {
  const part = useMessagePartText();
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-table:text-xs prose-pre:bg-surface-2 prose-code:text-accent">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
    </div>
  );
}

function ToolCard({ toolName, args, result, isError }: { toolName: string; args?: unknown; result?: unknown; isError?: boolean }) {
  const done = result !== undefined;
  const badge = isError ? '❌ error' : done ? '✓' : '…';
  const fmt = (v: unknown, n: number) => {
    const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } })();
    return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
  };
  return (
    <details className="my-1 rounded-lg border border-border bg-surface-2/60 text-xs">
      <summary className="cursor-pointer list-none px-2 py-1 text-muted">
        🔧 <span className="font-medium text-fg">{toolName}</span> <span className={isError ? 'text-red-500' : done ? 'text-accent' : 'text-muted'}>· {badge}</span>
      </summary>
      <div className="border-t border-border px-2 py-1.5">
        <div className="text-[10px] uppercase text-muted">args</div>
        <pre className="mb-1 whitespace-pre-wrap text-muted">{fmt(args ?? {}, 600)}</pre>
        {done && (
          <>
            <div className="text-[10px] uppercase text-muted">result</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-muted">{fmt(result, 1500)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function CopyButton() {
  return (
    <ActionBarPrimitive.Copy className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-fg" title="Copy">
      <MessagePrimitive.If copied>
        <Check size={13} />
      </MessagePrimitive.If>
      <MessagePrimitive.If copied={false}>
        <Copy size={13} />
      </MessagePrimitive.If>
    </ActionBarPrimitive.Copy>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="group flex flex-col items-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-fg">
        <MessagePrimitive.Parts />
      </div>
      <MessagePrimitive.If lastOrHover>
        <ActionBarPrimitive.Root className="mt-1 text-xs">
          <CopyButton />
        </ActionBarPrimitive.Root>
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group flex justify-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-accent"><Flame size={14} /></span>
      <div className="flex max-w-[85%] flex-col gap-1">
        <div className="rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-2.5 text-sm">
          <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolCard } }} />
        </div>
        <MessagePrimitive.If lastOrHover>
          <ActionBarPrimitive.Root className="text-xs">
            <CopyButton />
          </ActionBarPrimitive.Root>
        </MessagePrimitive.If>
      </div>
    </MessagePrimitive.Root>
  );
}
