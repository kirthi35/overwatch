// @overwatch/server — Firebase-backed server foundation (phase 2) + Fastify agent
// server (phase 3). Consumes @overwatch/core.

export { initFirebase, getDb, getAuthAdmin, verifyIdToken } from './firebase.js';
export { encryptSecret, decryptSecret } from './crypto.js';
export { FirestoreStore } from './firestore-store.js';
export { SecretsStore } from './secrets-store.js';
export type { UserCreds } from './secrets-store.js';
export { buildUserSession, availableModels } from './session-builder.js';
export type { BuildSessionOptions } from './session-builder.js';
