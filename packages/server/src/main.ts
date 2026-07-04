import { loadDotenv } from './env.js';
import { getDb } from './firebase.js';
import { SessionPool } from './pool.js';
import { createServer } from './server.js';

// Load repo-root .env into process.env before anything reads config (Firebase key,
// secret key, CORS, port) — so dev needs no manual exports.
loadDotenv();

// Entry point for the Overwatch agent server (the Fastify + SSE + POST API).
// Env: OVERWATCH_FIREBASE_KEY (service account), OVERWATCH_SECRET_KEY (secrets
// master key), PORT (default 8787), OVERWATCH_CORS_ORIGIN.
async function main() {
  const db = getDb();
  const pool = new SessionPool(db);
  const app = await createServer({
    db,
    pool,
    corsOrigin: process.env.OVERWATCH_CORS_ORIGIN || true,
  });
  const port = Number(process.env.PORT || 8787);
  await app.listen({ port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`[overwatch-server] listening on :${port}`);

  const shutdown = async () => {
    try {
      await pool.disposeAll();
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('server failed to start:', e);
  process.exit(1);
});
