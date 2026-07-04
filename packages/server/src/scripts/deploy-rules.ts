import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { initFirebase } from '../firebase.js';

// Deploy firestore.rules to the live project using the Admin SDK's Security Rules
// API — no firebase-tools login required (uses the same service account).
// Run: OVERWATCH_FIREBASE_KEY=/abs/key.json npm run deploy-rules -w @overwatch/server

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const RULES = path.join(REPO_ROOT, 'firestore.rules');

async function main() {
  const app = initFirebase();
  const source = readFileSync(RULES, 'utf8');
  await getSecurityRules(app).releaseFirestoreRulesetFromSource(source);
  console.log('Deployed firestore.rules to the live project.');
}

main().then(
  () => process.exit(0),
  (e) => { console.error('deploy-rules failed:', e.message); process.exit(1); },
);
