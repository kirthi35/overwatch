import * as os from 'os';
import * as path from 'path';
import { getDb } from './firebase.js';
import { SessionPool } from './pool.js';
import { createServer } from './server.js';

// Entry point for the Overwatch agent server (the Fastify + SSE + POST API).
// Env: OVERWATCH_FIREBASE_KEY (service account), OVERWATCH_SECRET_KEY (secrets
// master key), PORT (default 8787), OVERWATCH_CORS_ORIGIN, OVERWATCH_SESSIONS_ROOT.
async function main() {
  const db = getDb();
  const sessionsRoot = process.env.OVERWATCH_SESSIONS_ROOT || path.join(os.homedir(), '.overwatch-server', 'sessions');
  const pool = new SessionPool(db, { sessionsRoot });
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
