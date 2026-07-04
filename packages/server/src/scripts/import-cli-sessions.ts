import { readFileSync, readdirSync, existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../env.js';
import { getDb, getAuthAdmin } from '../firebase.js';
import { buildUserContext } from '../user-context.js';
import { generateTitle, buildTranscript } from '../title.js';

// Import the CLI's past Pi conversations (~/.pi/agent/sessions/**.jsonl) into a web
// user's Firestore conversation list, titled from the whole conversation. Idempotent
// (conversation id derived from the session file, so re-runs overwrite, not duplicate).
// Usage: OVERWATCH_FIREBASE_KEY=... npm run import-cli -w @overwatch/server [uid]

loadDotenv();

const SESSIONS_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions');

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('');
  return '';
}

function listSessionFiles(): string[] {
  if (!existsSync(SESSIONS_ROOT)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(SESSIONS_ROOT)) {
    const d = path.join(SESSIONS_ROOT, dir);
    try {
      for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) out.push(path.join(d, f));
    } catch {
      /* not a dir */
    }
  }
  return out;
}

interface ParsedSession {
  cid: string;
  createdAt: string;
  messages: Array<{ role: string; content: string; msg: unknown; ts: string }>;
}

function parseSession(file: string): ParsedSession | null {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let createdAt = new Date(0).toISOString();
  const messages: ParsedSession['messages'] = [];
  for (const l of lines) {
    let e: any;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (e.type === 'session' && e.timestamp) createdAt = e.timestamp;
    if (e.type === 'message' && e.message) {
      // Store the FULL message (all roles, incl. toolResult) so the imported
      // conversation resumes with complete tool context, just like the JSONL.
      const ms = e.message.timestamp;
      messages.push({
        role: e.message.role ?? 'assistant',
        content: extractText(e.message.content),
        msg: e.message,
        ts: ms ? new Date(ms).toISOString() : e.timestamp || createdAt,
      });
    }
  }
  if (!messages.some((m) => m.role === 'user' || m.role === 'assistant')) return null;
  // cid from the session-file uuid (after the last '_'); deterministic -> idempotent.
  const base = path.basename(file, '.jsonl');
  const uuid = base.includes('_') ? base.slice(base.lastIndexOf('_') + 1) : base;
  return { cid: 'cli-' + uuid.replace(/[^a-z0-9-]/gi, ''), createdAt, messages };
}

async function resolveUid(argUid?: string): Promise<string> {
  if (argUid) return argUid;
  const res = await getAuthAdmin().listUsers(1000);
  if (res.users.length === 0) throw new Error('no Firebase users found; pass a uid arg');
  if (res.users.length > 1) {
    throw new Error(`multiple users (${res.users.length}); pass a uid arg. First few: ${res.users.slice(0, 3).map((u) => u.uid).join(', ')}`);
  }
  return res.users[0].uid;
}

async function main() {
  const db = getDb();
  const uid = await resolveUid(process.argv[2]);
  const u = await buildUserContext(db, uid);
  const files = listSessionFiles();
  console.log(`Importing ${files.length} CLI session file(s) into user ${uid}…`);

  let imported = 0;
  for (const file of files) {
    const s = parseSession(file);
    if (!s) {
      console.log('  skip (empty):', path.basename(file));
      continue;
    }
    const title = (await generateTitle(u, buildTranscript(s.messages))) || s.messages[0].content.slice(0, 60);
    const convoRef = db.doc(`users/${uid}/conversations/${s.cid}`);
    await convoRef.set({ title, model: null, createdAt: s.createdAt, updatedAt: s.createdAt, source: 'cli-import' });
    const batch = db.batch();
    s.messages.forEach((m, i) => {
      batch.set(convoRef.collection('messages').doc(String(i).padStart(6, '0')), { seq: i, role: m.role, content: m.content, msg: m.msg, ts: m.ts });
    });
    await batch.commit();
    imported++;
    console.log(`  imported ${s.cid} (${s.messages.length} msgs) -> ${JSON.stringify(title)}`);
  }
  console.log(`Done. Imported ${imported} conversation(s).`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error('import failed:', e.message); process.exit(1); },
);
