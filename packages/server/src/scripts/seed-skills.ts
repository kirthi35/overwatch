import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../firebase.js';

// Mirror the version-controlled doctrine skills (runtime/skills/*.md) into a GLOBAL
// read-only `skills` Firestore collection that powers the Settings > Skills viewer.
// Skills stay authored in git (view-only in v1); this just publishes them for display.
// Run: OVERWATCH_FIREBASE_KEY=/abs/key.json npm run seed-skills -w @overwatch/server

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/scripts -> repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'runtime', 'skills');

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

async function main() {
  const db = getDb();
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'));
  let n = 0;
  for (const file of files) {
    const body = readFileSync(path.join(SKILLS_DIR, file), 'utf8');
    const fm = parseFrontmatter(body);
    const id = fm.name || file.replace(/\.md$/, '');
    await db.doc(`skills/${id}`).set({
      name: id,
      description: fm.description || '',
      triggers: fm.triggers,
      superseded_by: fm.superseded_by || null,
      body,
      updatedAt: new Date().toISOString(),
    });
    n++;
    console.log(`  mirrored skills/${id}`);
  }
  console.log(`Seeded ${n} skills into the global 'skills' collection.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error('seed-skills failed:', e.message); process.exit(1); },
);
