import { getDb } from '@overwatch/server';
import { MonitorWorker } from './worker.js';

// Entry point for the Overwatch monitor worker (the multi-tenant poller).
// Env: OVERWATCH_FIREBASE_KEY (service account), OVERWATCH_SECRET_KEY (to decrypt
// each user's Groww token). Runs one always-on process; ticks every 60s during NSE hours.
async function main() {
  const db = getDb();
  const worker = new MonitorWorker(db);
  worker.start();

  const shutdown = async () => {
    try {
      await worker.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('worker failed to start:', e);
  process.exit(1);
});
