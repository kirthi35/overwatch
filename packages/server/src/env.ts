import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Entry } from '@napi-rs/keyring';
import {
  resolveLlmProvider,
  DEFAULT_GLM_MODEL,
  DEFAULT_GLM_MODELS,
  DEFAULT_OLLAMA_BASE_URL,
} from '@overwatch/core';
import type { UserCreds } from './secrets-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/ -> repo root is three levels up (packages/server/dist).
const REPO_ROOT = path.resolve(__dirname, '../../..');

// Load the repo-root .env into process.env (only keys not already set), so the
// server/worker don't need manual `export`s in dev. No dependency; mirrors the CLI.
export function loadDotenv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      out[k] = v;
      if (process.env[k] === undefined && v) process.env[k] = v;
    }
  } catch {
    /* no .env — fine in prod */
  }
  return out;
}

function keychain(account: string): string {
  try {
    return new Entry('overwatch', account).getPassword() || '';
  } catch {
    return '';
  }
}

// DEV single-operator convenience: assemble creds from the same places the CLI uses
// (.env + OS keychain) so you skip the browser onboarding. Only used when
// OVERWATCH_DEV_CREDS_FROM_ENV=1 AND the user has no stored creds. Returns null if
// no usable creds are found. Never used in a real multi-tenant deployment.
export function devCredsFromEnv(dotenv: Record<string, string>): UserCreds | null {
  const growwToken = process.env.GROWW_API_TOKEN || dotenv.groww_api_key || keychain('growwToken');
  if (!growwToken) return null;

  const provider = resolveLlmProvider(dotenv); // reads OVERWATCH_LLM ('glm' | 'claude')
  const anthropicKey = process.env.ANTHROPIC_API_KEY || dotenv.ANTHROPIC_API_KEY || keychain('llmKey') || undefined;
  const ollamaKey = process.env.OLLAMA_API_KEY || dotenv.ollama_api_key || keychain('ollamaKey') || undefined;

  const creds: UserCreds = { growwToken };
  // Honour OVERWATCH_LLM: if glm, prefer the Ollama key (and drop anthropic so the
  // default model resolves to GLM); otherwise keep anthropic as the default.
  if (provider === 'glm' && ollamaKey) {
    creds.ollamaKey = ollamaKey;
    creds.ollamaBaseUrl = dotenv.ollama_base_url || DEFAULT_OLLAMA_BASE_URL;
    creds.glmModels = (dotenv.overwatch_glm_models || DEFAULT_GLM_MODELS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
    creds.glmModelId = dotenv.overwatch_glm_model || DEFAULT_GLM_MODEL;
  } else {
    if (anthropicKey) creds.anthropicKey = anthropicKey;
    if (ollamaKey) {
      creds.ollamaKey = ollamaKey;
      creds.ollamaBaseUrl = dotenv.ollama_base_url || DEFAULT_OLLAMA_BASE_URL;
      creds.glmModels = (dotenv.overwatch_glm_models || DEFAULT_GLM_MODELS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
      creds.glmModelId = dotenv.overwatch_glm_model || DEFAULT_GLM_MODEL;
    }
  }
  if (!creds.anthropicKey && !creds.ollamaKey) return null;
  return creds;
}

export const DEV_CREDS_ENABLED = () => process.env.OVERWATCH_DEV_CREDS_FROM_ENV === '1';
