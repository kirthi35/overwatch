import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Firestore } from 'firebase-admin/firestore';
import {
  FirestoreStore,
} from './firestore-store.js';
import { SecretsStore, type UserCreds } from './secrets-store.js';
import { DEFAULT_GLM_MODEL, DEFAULT_GLM_MODELS, DEFAULT_OLLAMA_BASE_URL, type UserContext } from '@overwatch/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/ -> repo root is three levels up (packages/server/dist).
const REPO_ROOT = path.resolve(__dirname, '../../..');
export const SKILLS_DIR = path.join(REPO_ROOT, 'runtime', 'skills');

/** Map decrypted BYOK creds into the doctrine's UserContext.llm shape. */
export function credsToLlm(creds: UserCreds): UserContext['llm'] {
  return {
    // Default provider: Claude if an Anthropic key exists, else GLM. Per-conversation
    // model choice overrides this at session build via BuildSessionOptions.model.
    provider: creds.anthropicKey ? 'claude' : 'glm',
    anthropicKey: creds.anthropicKey,
    ollama: creds.ollamaKey
      ? {
          apiKey: creds.ollamaKey,
          baseUrl: creds.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
          models: creds.glmModels && creds.glmModels.length ? creds.glmModels : DEFAULT_GLM_MODELS,
          modelId: creds.glmModelId || DEFAULT_GLM_MODEL,
        }
      : undefined,
  };
}

/** Build a per-user (and optionally per-conversation) UserContext from stored creds.
 *  Throws if the user hasn't onboarded credentials yet. */
export async function buildUserContext(
  db: Firestore,
  uid: string,
  conversationId?: string,
): Promise<UserContext> {
  const creds = await new SecretsStore(db, uid).get();
  if (!creds || !creds.growwToken) {
    throw new Error('no credentials onboarded for this user');
  }
  return {
    uid,
    conversationId,
    growwToken: creds.growwToken,
    llm: credsToLlm(creds),
    telegram: creds.telegram
      ? {
          botToken: creds.telegram.botToken,
          chatId: creds.telegram.chatId,
          minSeverity: (creds.telegram.minSeverity || 'WARNING').toUpperCase() as 'INFO' | 'WARNING' | 'CRITICAL',
        }
      : undefined,
    store: new FirestoreStore(db, uid),
    skillsDir: SKILLS_DIR,
  };
}
