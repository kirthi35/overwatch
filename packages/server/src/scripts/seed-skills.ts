import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../firebase.js';

// Mirror the version-controlled doctrine (runtime/skills/*.md, runtime/skills/_shared/*.md,
// and theses/lessons/*.md) into a GLOBAL read-only `skills` Firestore collection that powers
// the Settings > Doctrine viewer. Everything stays authored in git (view-only in v1); this
// just publishes it for display, tagged with a `category` so the viewer can group it.
// Run: OVERWATCH_FIREBASE_KEY=/abs/key.json npm run seed-skills -w @overwatch/server

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/scripts -> repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'runtime', 'skills');
const SHARED_DIR = path.join(SKILLS_DIR, '_shared');
const LESSONS_DIR = path.join(REPO_ROOT, 'theses', 'lessons');

type Category = 'constitution' | 'skill' | 'shared' | 'lesson';

// Minimal YAML-frontmatter reader (name, description, triggers, superseded_by).
function parseFrontmatter(text: string): { name?: string; description?: string; triggers: string[]; superseded_by?: string } {
  const out: { name?: string; description?: string; triggers: string[]; superseded_by?: string } = { triggers: [] };
  if (!text.startsWith('---')) return out;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return out;
  const lines = text.slice(3, end).split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let val = m[2];
    if (key === 'triggers') {
      if (val.trim().startsWith('[')) {
        out.triggers = val.trim().replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else if (key === 'description') {
      // Folded block (>) — gather following more-indented lines.
      if (val === '>' || val === '|') {
        const parts: string[] = [];
        i++;
        while (i < lines.length && /^\s+\S/.test(lines[i])) { parts.push(lines[i].trim()); i++; }
        out.description = parts.join(' ');
        continue;
      }
      out.description = val.trim();
    } else if (key === 'name') {
      out.name = val.trim();
    } else if (key === 'superseded_by') {
      out.superseded_by = val.trim();
    }
    i++;
  }
  return out;
}

function listMd(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // dir may not exist (e.g. no lessons yet)
  }
}

async function seedDir(
  db: ReturnType<typeof getDb>,
  dir: string,
  categoryFor: (file: string) => Category,
): Promise<number> {
  let n = 0;
  for (const file of listMd(dir)) {
    const body = readFileSync(path.join(dir, file), 'utf8');
    const fm = parseFrontmatter(body);
    const id = fm.name || file.replace(/\.md$/, '');
    const category = categoryFor(file);
    await db.doc(`skills/${id}`).set({
      name: id,
      category,
      description: fm.description || '',
      triggers: fm.triggers,
      superseded_by: fm.superseded_by || null,
      body,
      updatedAt: new Date().toISOString(),
    });
    n++;
    console.log(`  mirrored skills/${id} (${category})`);
  }
  return n;
}

async function main() {
  const db = getDb();
  // Top-level doctrine skills. (No frontmatter-less files live here.)
  let n = await seedDir(db, SKILLS_DIR, () => 'skill');
  // Shared protocols + the constitution live under _shared/.
  n += await seedDir(db, SHARED_DIR, (f) => (f.startsWith('standing-orders') ? 'constitution' : 'shared'));
  // Evidence lesson library (theses/lessons/) — cited by doctrine via `evidence: L-*`.
  n += await seedDir(db, LESSONS_DIR, () => 'lesson');
  console.log(`Seeded ${n} doctrine docs into the global 'skills' collection.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error('seed-skills failed:', e.message); process.exit(1); },
);
