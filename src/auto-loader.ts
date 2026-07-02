import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Overwatch — doctrine auto-loader (transformContext interceptor, idea.md §9).
//
// Routes the user prompt to the right doctrine skill(s) and injects their text
// before the LLM turn — the "it just knows" effect. Pi does NOT auto-load skills.
//
// DESIGN: routing is DATA-DRIVEN, not a hardcoded keyword→filename table. Each
// skill declares how it's triggered in its own frontmatter, so new skills join
// routing just by being seeded:
//   - `triggers: [phrase, ...]`  — curated match phrases (substring, best signal)
//   - `name:` / filename tokens  — always matched
//   - `description:`             — salient tokens, used only when no triggers
// Skills marked `superseded_by:` (deprecated redirects) are NEVER injected.
// When an injected skill depends on _shared/multi-timeframe-protocol.md, that
// shared protocol is injected alongside it.

const SKILLS_DIR = path.join(os.homedir(), '.overwatch', 'skills');
const SHARED_PROTOCOL = path.join('_shared', 'multi-timeframe-protocol.md');
const MAX_SKILLS = 3;           // bound injected token cost
const STOP = new Set([
  'this','that','when','with','from','into','skill','stock','stocks','operator','use',
  'the','and','for','over','specific','how','what','which','not','output','next','using',
  'via','consumes','decide','decides','estimate','before','first','pull','trigger','bet',
]);

interface SkillMeta { name?: string; description?: string; triggers: string[]; superseded_by?: string; }

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9+&]{2,}/g) || []);
}

// Minimal YAML-frontmatter reader (no dep). Handles folded `description: >`,
// inline `triggers: [a, b]`, and block `- a` lists. Good enough for our schema.
function parseFrontmatter(text: string): SkillMeta {
  const meta: SkillMeta = { triggers: [] };
  if (!text.startsWith('---')) return meta;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return meta;
  const lines = text.slice(3, end).split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1]; const val = m[2];
    if (key === 'triggers') {
      if (val.trim().startsWith('[')) {
        meta.triggers = val.replace(/^\s*\[|\]\s*$/g, '').split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        i++;
      } else {
        i++;
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
          meta.triggers.push(lines[i].replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
          i++;
        }
      }
    } else if (key === 'description') {
      let desc = (val === '>' || val === '|' || val === '') ? '' : val;
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^[a-zA-Z_]+:\s/.test(lines[i])) {
        desc += (desc ? ' ' : '') + lines[i].trim();
        i++;
      }
      meta.description = desc;
    } else if (key === 'name') { meta.name = val.trim(); i++; }
    else if (key === 'superseded_by') { meta.superseded_by = val.trim(); i++; }
    else { i++; }
  }
  return meta;
}

interface Route { file: string; score: number; }

export function scoreSkills(prompt: string): Route[] {
  let files: string[] = [];
  try { files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')); } catch { return []; }

  const promptLc = prompt.toLowerCase();
  const promptTokens = new Set(tokenize(prompt));
  const routes: Route[] = [];

  for (const file of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf8'); } catch { continue; }
    const meta = parseFrontmatter(text);
    if (meta.superseded_by) continue;   // deprecated redirect — never inject

    const nameTokens = new Set([
      ...tokenize(meta.name || ''),
      ...tokenize(file.replace(/\.md$/, '').replace(/[-_]/g, ' ')),
    ]);

    const triggerHit = meta.triggers.some(t => t && promptLc.includes(t.toLowerCase()));
    let nameHit = false;
    for (const t of nameTokens) if (promptTokens.has(t)) { nameHit = true; break; }

    let descHits = 0;
    if (meta.triggers.length === 0 && meta.description) {
      const seen = new Set<string>();
      for (const t of tokenize(meta.description)) {
        if (STOP.has(t) || seen.has(t)) continue;
        seen.add(t);
        if (promptTokens.has(t)) descHits++;
      }
    }

    const inject = triggerHit || nameHit || descHits >= 2;
    if (!inject) continue;
    routes.push({ file, score: (triggerHit ? 3 : 0) + (nameHit ? 2 : 0) + descHits });
  }

  return routes.sort((a, b) => b.score - a.score).slice(0, MAX_SKILLS);
}

export function setupAutoLoader(api: ExtensionAPI) {
  api.on("context", async (event) => {
    const messages = event.messages;
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') return;

    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : Array.isArray(lastMessage.content)
        ? lastMessage.content.map((c: any) => c.text || '').join(' ')
        : '';
    if (!content.trim()) return;

    const routes = scoreSkills(content);
    if (routes.length === 0) return;

    // Pull in the shared multi-timeframe protocol if any injected skill needs it.
    const chosen = routes.map(r => r.file);
    const bodies: Array<{ label: string; text: string }> = [];
    let needsShared = false;
    for (const file of chosen) {
      try {
        const text = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf8');
        bodies.push({ label: file, text });
        if (/_shared\/multi-timeframe-protocol/.test(text)) needsShared = true;
      } catch { /* skip unreadable */ }
    }
    if (needsShared) {
      try {
        const text = fs.readFileSync(path.join(SKILLS_DIR, SHARED_PROTOCOL), 'utf8');
        bodies.unshift({ label: SHARED_PROTOCOL, text });
      } catch { /* shared protocol not seeded yet */ }
    }
    if (bodies.length === 0) return;

    let injected = "### AUTO-LOADED SKILLS (DOCTRINE)\n\n";
    for (const b of bodies) {
      injected += `--- BEGIN ${b.label} ---\n${b.text}\n--- END ${b.label} ---\n\n`;
    }

    const newMessages = [...messages];
    newMessages.splice(newMessages.length - 1, 0, {
      role: "system",
      content: injected,
    } as any);

    return { messages: newMessages };
  });
}
