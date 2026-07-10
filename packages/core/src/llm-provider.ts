import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// LLM provider selection for the Pi agent.
//
// Overwatch runs on Pi (@earendil-works/pi-coding-agent), which drives the agent
// loop, tool calls, and streaming itself. Pi picks its model from a registry; the
// default is Anthropic Claude (because ANTHROPIC_API_KEY is set in index.ts).
//
// To run the agent on GLM-5.2 via Ollama Cloud instead, we register Ollama Cloud
// as an OpenAI-completions-compatible provider in ~/.pi/agent/models.json and hand
// Pi `--model ollama-cloud/<id>`. Ollama Cloud speaks the OpenAI API at
// https://ollama.com/v1 with the key as a Bearer token — which Pi's
// "openai-completions" api attaches natively — so NO custom auth header is needed.
//
// This is the ONLY correct way to swap the agent's brain: calling the `ollama` npm
// package directly would bypass Pi's whole agent/tool loop.

export type LlmProvider = 'claude' | 'glm';

const PI_AGENT_DIR = path.join(os.homedir(), '.pi', 'agent');
const MODELS_JSON = path.join(PI_AGENT_DIR, 'models.json');

export const OLLAMA_PROVIDER = 'ollama-cloud';
// The default active Ollama Cloud model when none is set via env. Selectable
// per-deployment via `overwatch_glm_model` (the box pins deepseek-v4-pro:cloud).
export const DEFAULT_GLM_MODEL = 'deepseek-v4-pro:cloud';
// The Ollama Cloud models we register so they're pickable in-session via `/model`.
// ALWAYS use the ":cloud" suffix. The suffix pins the CLOUD-HOSTED model, which is what
// the operator's Ollama key is provisioned for; bare tags (e.g. "glm-5.2") can route to
// a different / local path and cause BILLING issues. Both tags verified to return real
// completions on the OpenAI-compat /v1 endpoint 2026-07-10. NOTE: these are REASONING
// models — reasoning tokens count against the completion budget, so maxTokens is set
// generously in the provider registration. Override with `overwatch_glm_models`.
export const DEFAULT_GLM_MODELS = ['deepseek-v4-pro:cloud', 'glm-5.2:cloud'];
export const DEFAULT_OLLAMA_BASE_URL = 'https://ollama.com/v1';

export interface GlmConfig {
  modelId: string;   // the model handed to Pi's --model at launch (the active one)
  models: string[];  // every GLM tag to register (so `/model` can switch among them)
  baseUrl: string;
}

// Read a config value: process.env (canonical UPPER name) wins, then the .env map
// tried in BOTH upper and lower case. This project mixes casing in .env
// (`groww_api_key` lower vs `OLLAMA_API_KEY` upper), so we accept either and never
// silently miss a key because of case.
function readCfg(dotenv: Record<string, string>, upperName: string): string {
  return (
    process.env[upperName] ||
    dotenv[upperName] ||
    dotenv[upperName.toLowerCase()] ||
    ''
  );
}

// Read OVERWATCH_LLM. 'glm' / 'ollama' -> GLM; anything else (incl. unset) ->
// Claude, the default. Switchable and reversible: unset it (or set OVERWATCH_LLM=
// claude) and the agent is back on Claude with no other change.
export function resolveLlmProvider(dotenv: Record<string, string>): LlmProvider {
  const raw = (readCfg(dotenv, 'OVERWATCH_LLM') || 'claude').trim().toLowerCase();
  return raw === 'glm' || raw === 'ollama' || raw === 'glm-5.2' ? 'glm' : 'claude';
}

export function resolveGlmConfig(dotenv: Record<string, string>): GlmConfig {
  const modelId = readCfg(dotenv, 'OVERWATCH_GLM_MODEL') || DEFAULT_GLM_MODEL;

  const listRaw = readCfg(dotenv, 'OVERWATCH_GLM_MODELS');
  const models = listRaw
    ? listRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_GLM_MODELS];
  // The launch model must be registered, else Pi can't resolve --model.
  if (!models.includes(modelId)) models.unshift(modelId);

  return {
    modelId,
    models,
    baseUrl: readCfg(dotenv, 'OLLAMA_BASE_URL') || DEFAULT_OLLAMA_BASE_URL,
  };
}

// Merge the Ollama Cloud provider into ~/.pi/agent/models.json WITHOUT clobbering
// any other providers the user may have. Idempotent — safe to run every launch.
//
// The API key is stored as the literal reference "$OLLAMA_API_KEY", not the key
// itself: Pi resolves it from the environment at request time, so the secret never
// lands on disk in this file.
export function registerOllamaProvider(cfg: GlmConfig): void {
  fs.mkdirSync(PI_AGENT_DIR, { recursive: true });

  let doc: any = { providers: {} };
  if (fs.existsSync(MODELS_JSON)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(MODELS_JSON, 'utf8'));
      if (parsed && typeof parsed === 'object') doc = parsed;
      if (!doc.providers || typeof doc.providers !== 'object') doc.providers = {};
    } catch {
      // Corrupt/hand-broken file — preserve it as .bak rather than lose it silently.
      try { fs.copyFileSync(MODELS_JSON, `${MODELS_JSON}.bak`); } catch { /* best effort */ }
      doc = { providers: {} };
    }
  }

  doc.providers[OLLAMA_PROVIDER] = {
    name: 'Ollama Cloud',
    baseUrl: cfg.baseUrl,
    api: 'openai-completions',
    apiKey: '$OLLAMA_API_KEY',
    models: cfg.models.map((id) => ({
      id,
      name: `Ollama Cloud (${id})`,
      contextWindow: 128000,
      maxTokens: 16384,
    })),
  };

  fs.writeFileSync(MODELS_JSON, JSON.stringify(doc, null, 2));
}

// The args to hand Pi's main() so it selects the GLM model. Exact-match resolution
// (provider/id) means the colon in a tag like "glm-5.2:cloud" is NOT mistaken for a
// thinking-level suffix.
export function glmPiArgs(modelId: string): string[] {
  return ['--model', `${OLLAMA_PROVIDER}/${modelId}`];
}
