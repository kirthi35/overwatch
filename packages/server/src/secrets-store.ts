import type { Firestore } from 'firebase-admin/firestore';
import { encryptSecret, decryptSecret } from './crypto.js';

// Per-user BYOK credentials. Stored ENCRYPTED at users/{uid}/secrets/creds and
// never client-readable (Firestore rules deny; only the Admin SDK reads them).
// Decrypted in memory per session/tick, never persisted or logged in the clear.
export interface UserCreds {
  growwToken: string;
  anthropicKey?: string;
  ollamaKey?: string;
  ollamaBaseUrl?: string;
  glmModels?: string[];
  glmModelId?: string;
  telegram?: { botToken: string; chatId: string; minSeverity?: string };
}

export class SecretsStore {
  constructor(private readonly db: Firestore, private readonly uid: string) {}

  private doc() {
    return this.db.doc(`users/${this.uid}/secrets/creds`);
  }

  /** Encrypt + store this user's creds. `updatedAt` is written; `enc` is the ciphertext. */
  async put(creds: UserCreds): Promise<void> {
    await this.doc().set({
      enc: encryptSecret(JSON.stringify(creds)),
      updatedAt: new Date().toISOString(),
    });
  }

  /** Fetch + decrypt this user's creds, or null if none stored. */
  async get(): Promise<UserCreds | null> {
    const snap = await this.doc().get();
    if (!snap.exists) return null;
    const enc = (snap.data() as { enc?: string }).enc;
    if (!enc) return null;
    return JSON.parse(decryptSecret(enc)) as UserCreds;
  }
}
