// @overwatch/server — Firebase-backed server foundation (phase 2) + Fastify agent
// server (phase 3). Consumes @overwatch/core.

export { initFirebase, getDb, getAuthAdmin, verifyIdToken } from './firebase.js';
export { loadDotenv, devCredsFromEnv, DEV_CREDS_ENABLED } from './env.js';
export { encryptSecret, decryptSecret } from './crypto.js';
export { FirestoreStore } from './firestore-store.js';
export { SecretsStore } from './secrets-store.js';
export type { UserCreds } from './secrets-store.js';
export { buildUserSession, availableModels, listAvailableModels } from './session-builder.js';
export type { BuildSessionOptions } from './session-builder.js';
export { buildUserContext, credsToLlm, SKILLS_DIR } from './user-context.js';
export { SessionPool } from './pool.js';
export type { PoolEntry, PoolOptions, EventSink } from './pool.js';
export { attachPersistence } from './persistence.js';
export type { Persistence } from './persistence.js';
export { attachAlertRouter } from './alert-router.js';
export type { AlertRouter } from './alert-router.js';
export { createServer } from './server.js';
export type { ServerDeps } from './server.js';
