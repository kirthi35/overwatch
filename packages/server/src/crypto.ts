import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Envelope encryption for per-user secrets (Groww token, LLM keys, Telegram).
// AES-256-GCM with a server-held master key. v1: the key comes from the env var
// OVERWATCH_SECRET_KEY (base64-encoded 32 bytes — generate with `npm run gen-secret`).
// The interface hides the key source so this swaps to GCP KMS for Cloud Run without
// touching callers. Secrets are NEVER stored in the clear and NEVER client-readable.

const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const b64 = process.env.OVERWATCH_SECRET_KEY;
  if (!b64) {
    throw new Error('OVERWATCH_SECRET_KEY not set (base64 32-byte key; generate with `npm run gen-secret`).');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error(`OVERWATCH_SECRET_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

/** Encrypt a UTF-8 string. Returns a self-describing packed token: iv:tag:ciphertext (base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a token produced by encryptSecret. Throws on tamper/wrong key. */
export function decryptSecret(packed: string): string {
  const [ivB64, tagB64, ctB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed secret token');
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
