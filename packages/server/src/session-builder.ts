import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSessionServices,
  createAgentSessionFromServices,
  type AgentSession,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import { makeOverwatchExtension, type UserContext } from '@overwatch/core';

// Build ONE headless AgentSession for ONE user, in-process. Credentials are scoped
// to this session via an in-memory AuthStorage + a fresh ModelRegistry — NEVER
// process.env, so concurrent users can't clobber each other. The Overwatch doctrine
// is injected as an extension factory (same path main() uses). Built-in shell tools
// (read/bash/edit/write) are disabled with noTools:'builtin' on the shared host;
// our custom + Groww tools stay enabled.

export interface BuildSessionOptions {
  /** Desired model (from the conversation's saved choice); falls back to the user's provider default. */
  model?: { provider: string; id: string };
  /** Server-owned Pi config dir (kept clean so no stray on-disk extensions/skills load). */
  agentDir?: string;
  /** Per-session scratch cwd. Defaults to a temp dir. */
  cwd?: string;
  /** Extra extension factories to attach alongside the doctrine (e.g. alert injection, diagnostics). */
  extraExtensions?: ExtensionFactory[];
  /** Skip the Overwatch doctrine extension (no master prompt, Groww, or custom tools).
   *  Used for cheap side tasks like title generation. */
  noDoctrine?: boolean;
  /** Prior conversation to seed into the (in-memory) session so the model has full
   *  context on resume — from the durable store, in seq order. `msg` is the verbatim
   *  Pi message (full tool context); `content` is a text fallback for older data. */
  seedMessages?: Array<{ role: string; content: string; msg?: unknown }>;
}

const GLM_MODEL_DEFAULTS = { reasoning: false, input: ['text'] as ('text' | 'image')[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 };

// Built-in filesystem/shell tools that must NOT be offered on the shared multi-tenant
// host. noTools:'builtin' already deactivates these; excludeTools is belt-and-suspenders,
// and the per-session temp cwd means even an invoked built-in hits a throwaway dir.
const SHELL_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

function buildAuthAndRegistry(u: UserContext): { auth: AuthStorage; registry: ModelRegistry } {
  const auth = AuthStorage.inMemory();
  if (u.llm.anthropicKey) auth.setRuntimeApiKey('anthropic', u.llm.anthropicKey);
  const registry = ModelRegistry.create(auth);
  // Register the GLM provider whenever the user supplied Ollama creds — regardless of
  // which provider is the default — so BOTH Claude and GLM models are pickable in-chat.
  if (u.llm.ollama) {
    registry.registerProvider('ollama-cloud', {
      name: 'Ollama Cloud',
      baseUrl: u.llm.ollama.baseUrl,
      api: 'openai-completions',
      apiKey: u.llm.ollama.apiKey,
      models: u.llm.ollama.models.map((id) => ({ id, name: `Ollama Cloud (${id})`, ...GLM_MODEL_DEFAULTS })),
    });
  }
  return { auth, registry };
}

/** List the models this user can pick (auth-filtered), without building a session. */
export function listAvailableModels(u: UserContext): Array<{ provider: string; id: string; name: string }> {
  const { registry } = buildAuthAndRegistry(u);
  return availableModels(registry);
}

/** Which models this user can pick (auto-filtered by configured auth). */
export function availableModels(registry: ModelRegistry): Array<{ provider: string; id: string; name: string }> {
  return registry.getAvailable().map((m: any) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id }));
}

// Preferred current Claude defaults (Pi's bundled catalog also lists stale/EOL ids;
// never default to the first-in-catalog, which is an old model). First match wins.
const ANTHROPIC_DEFAULT_ORDER = ['claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-opus-4-8', 'claude-haiku-4-5'];

function pickModel(registry: ModelRegistry, u: UserContext, desired?: { provider: string; id: string }): Model<any> | undefined {
  const avail = registry.getAvailable();
  if (desired) {
    const m = registry.find(desired.provider, desired.id);
    if (m) return m;
  }
  if (u.llm.provider === 'glm' && u.llm.ollama) {
    const m = registry.find('ollama-cloud', u.llm.ollama.modelId);
    if (m) return m;
  }
  for (const id of ANTHROPIC_DEFAULT_ORDER) {
    const m = registry.find('anthropic', id);
    if (m) return m;
  }
  return (avail as any[]).find((m) => m.provider === 'anthropic') ?? avail[0];
}

function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return d;
}

export async function buildUserSession(u: UserContext, opts: BuildSessionOptions = {}): Promise<{ session: AgentSession; registry: ModelRegistry }> {
  const { auth, registry } = buildAuthAndRegistry(u);
  const cwd = opts.cwd ?? tmpDir('ow-cwd-');
  const agentDir = opts.agentDir ?? tmpDir('ow-agent-');

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    authStorage: auth,
    modelRegistry: registry,
    resourceLoaderOptions: {
      // The doctrine, parameterized for this user. alertBridge:false — the server
      // surfaces monitor fires via its own Firestore listener (phase 5), not file-tailing.
      extensionFactories: opts.noDoctrine
        ? [...(opts.extraExtensions ?? [])]
        : [makeOverwatchExtension(u, { alertBridge: false, shellTools: false }), ...(opts.extraExtensions ?? [])],
    },
  });

  const model = pickModel(services.modelRegistry, u, opts.model);
  const sessionManager = SessionManager.inMemory(cwd);

  // Seed prior conversation so the model has FULL context on resume (incl. tool
  // calls + results), box-independent. Replay each stored Pi message verbatim (`msg`);
  // fall back to a text-only reconstruction for messages saved before full-message
  // persistence (older/imported data).
  if (opts.seedMessages?.length) {
    const now = Date.now();
    const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const mm: any = model;
    for (const s of opts.seedMessages) {
      try {
        if (s.msg) {
          sessionManager.appendMessage(s.msg as any); // verbatim — full tool context
        } else if (s.role === 'user') {
          sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: s.content }], timestamp: now } as any);
        } else if (s.role === 'assistant' && s.content.trim()) {
          sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: s.content }], api: mm?.api ?? 'anthropic-messages', provider: mm?.provider ?? 'anthropic', model: mm?.id ?? 'unknown', usage: zeroUsage, stopReason: 'stop', timestamp: now } as any);
        }
        // else (toolResult/custom without a verbatim msg) — skip; can't reconstruct safely.
      } catch {
        /* skip a message that won't replay rather than fail the whole session */
      }
    }
  }

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model,
    noTools: 'builtin', // shell tools OFF on the shared host; keep extension + custom tools
    excludeTools: SHELL_TOOLS, // belt-and-suspenders denylist
  });
  return { session, registry: services.modelRegistry };
}
