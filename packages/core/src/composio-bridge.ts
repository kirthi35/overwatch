import { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Composio } from '@composio/core';
import {
  PiProvider,
  createPiComposioSystemPrompt,
  denyPiToolCall,
  type PiRemoteBashHookContext,
  type PiExecuteHookContext,
  type PiAuthLinkContext,
  type PiHookNext,
} from '@composio/experimental';

// ComposioBridge — a PER-USER instance that owns one Composio Tool-Router session
// built from that user's Firebase uid (Composio's `userId` = entity). Mirrors
// GrowwMcpBridge: one instance per agent session, lazy guarded setup(), registers
// the Pi helper tools once. Composio holds the user's connected-app OAuth tokens
// keyed by userId — we store none, and a wrong userId would cross tenants, so the
// uid is ALWAYS the caller-supplied verified Firebase uid, never model/client input.

const CONNECT_TIMEOUT_MS = 20000;

// Toolkits the general assistant can reach. The model still discovers exact tool
// slugs at runtime via composio_search_tools; this scopes what's connectable.
export const DEFAULT_TOOLKITS = ['gmail', 'googlecalendar', 'github', 'slack', 'notion'];

// Destructive shell the sandbox must refuse even though it is off-box (defense in
// depth — a poisoned instruction shouldn't nuke the user's sandbox workspace).
const DESTRUCTIVE_BASH =
  /\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bshutdown\b|\breboot\b|>\s*\/dev\/sd|\bcurl\b[^\n|]*\|\s*(sh|bash)\b|\bwget\b[^\n|]*\|\s*(sh|bash)\b/i;

/** True if a sandbox bash command matches the destructive-command denylist. Pure; exported for tests. */
export function isDestructiveBash(command: string): boolean {
  return DESTRUCTIVE_BASH.test(command || '');
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

export interface ComposioStatus {
  ready: boolean;
  toolCount: number;
  sessionId: string | null;
  lastError: string | null;
}

export class ComposioBridge {
  private composio: Composio<any> | null = null;
  private session: any = null; // ToolRouterSession — satisfies PiComposioSessionLike
  private ready = false;
  private lastError: string | null = null;
  private registeredToolNames = new Set<string>();
  private systemPromptCache: string | null = null;

  constructor(
    private readonly userId: string,
    private readonly apiKey: string,
    private readonly callbackUrl?: string,
  ) {}

  status(): ComposioStatus {
    return {
      ready: this.ready,
      toolCount: this.registeredToolNames.size,
      sessionId: this.session?.sessionId ?? null,
      lastError: this.lastError,
    };
  }

  /** The Pi helper tool names this bridge registered — the active-tool subset for general turns. */
  toolNames(): string[] {
    return [...this.registeredToolNames];
  }

  /** The Composio-authored general-assistant system prompt (built once per session). */
  systemPrompt(): string {
    if (this.systemPromptCache) return this.systemPromptCache;
    this.systemPromptCache = createPiComposioSystemPrompt(this.session?.sessionId, { includeWorkbenchTools: true });
    return this.systemPromptCache;
  }

  // Lazy, guarded, idempotent — called from before_agent_start ONLY on a general turn,
  // so a market-only user never pays the session-create round-trip.
  async setup(api: ExtensionAPI): Promise<ComposioStatus> {
    if (this.ready && this.session) return this.status();
    if (!this.apiKey) {
      this.lastError = 'COMPOSIO_KEY missing';
      return this.status();
    }
    try {
      this.composio ??= new Composio({ apiKey: this.apiKey, provider: new PiProvider() });
      this.session = await withTimeout(
        this.composio.sessions.create(this.userId, {
          toolkits: DEFAULT_TOOLKITS,
          manageConnections: { enable: true, callbackUrl: this.callbackUrl },
          sandbox: { enable: true },
        } as any),
        CONNECT_TIMEOUT_MS,
        'Composio session create',
      );

      const tools = this.composio.provider.createSessionTools(this.session, {
        callbackUrl: this.callbackUrl,
        includeWorkbenchTools: true,
        hooks: {
          // Sandbox shell: refuse obviously-destructive commands. The sandbox is
          // off our box, so blast radius is the user's own ephemeral workspace,
          // but a poisoned prompt shouldn't be able to wreck even that.
          remoteBash: (ctx: PiRemoteBashHookContext, next: PiHookNext<unknown>) => {
            if (isDestructiveBash(ctx.request.command || '')) {
              return ctx.deny('Destructive shell command blocked by Overwatch policy.');
            }
            return next();
          },
          // Audit every tool execution (uid + slug). Never rewrite args here.
          execute: (ctx: PiExecuteHookContext, next: PiHookNext<unknown>) => {
            console.log(`[composio] ${this.userId} exec ${ctx.request.toolSlug}`);
            return next();
          },
          // Auth links (OAuth connect URLs) stay visible to the model so the
          // assistant surfaces them to the user in-chat. Also logged.
          onAuthLink: (ctx: PiAuthLinkContext, next: PiHookNext<unknown>) => {
            console.log(`[composio] ${this.userId} auth-link ${ctx.toolkit ?? ''}`);
            return next();
          },
        },
      });

      for (const tool of tools) {
        if (this.registeredToolNames.has(tool.name)) continue;
        api.registerTool(tool);
        this.registeredToolNames.add(tool.name);
      }

      this.ready = true;
      this.lastError = null;
      console.log(`[composio] session ${this.session.sessionId} ready for ${this.userId} (${this.registeredToolNames.size} tools)`);
      return this.status();
    } catch (e: any) {
      this.ready = false;
      this.lastError = e?.message ?? String(e);
      console.error(`[composio] setup failed for ${this.userId}: ${this.lastError}`);
      return this.status();
    }
  }
}
