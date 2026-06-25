#!/usr/bin/env node
// Seed the runtime workspace: copy version-controlled doctrine skills + the
// monitor runtime/tools from runtime/ into ~/.overwatch/, and create the empty
// working directories the app expects.
//
// NON-DESTRUCTIVE: it overwrites the skill docs and shared daemon assets (those
// ARE the source of truth, kept in git), but never touches your data —
// alerts.log, theses/, thesis/, monitors/, logs/, and any per-thesis daemon
// scripts you generated are left alone.
//
// Run:  npm run seed   (safe to re-run; idempotent)

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OW = path.join(os.homedir(), '.overwatch');

// Directories the app reads/writes at runtime.
const DIRS = ['skills', 'daemons', 'daemons/lib', 'theses', 'thesis', 'monitors', 'logs'];

// Source trees that ARE source-of-truth (safe to overwrite on every seed).
const COPY = [
  ['runtime/skills', 'skills'],            // doctrine + monitor playbooks (*.md)
  ['runtime/daemons/lib', 'daemons/lib'],  // shared monitor runtime
];
// Individual shared daemon/tool files (NOT per-thesis user daemons).
const FILES = [
  ['runtime/daemons/thesis-monitor.js', 'daemons/thesis-monitor.js'],
  ['runtime/daemons/test-monitor-runtime.js', 'daemons/test-monitor-runtime.js'],
  ['runtime/daemons/monitorctl.js', 'daemons/monitorctl.js'],
];

let copied = 0;
for (const d of DIRS) {
  const p = path.join(OW, d);
  if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); console.log(`  mkdir  ~/.overwatch/${d}`); }
}
for (const [src, dst] of COPY) {
  const from = path.join(REPO, src), to = path.join(OW, dst);
  if (!fs.existsSync(from)) continue;
  for (const f of fs.readdirSync(from)) {
    const sf = path.join(from, f);
    if (!fs.statSync(sf).isFile()) continue;
    fs.copyFileSync(sf, path.join(to, f));
    console.log(`  copy   ${src}/${f} -> ~/.overwatch/${dst}/${f}`);
    copied++;
  }
}
for (const [src, dst] of FILES) {
  const from = path.join(REPO, src);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(OW, dst));
  console.log(`  copy   ${src} -> ~/.overwatch/${dst}`);
  copied++;
}
console.log(`\nSeeded ~/.overwatch (${copied} files). Your data (alerts.log, theses, monitors) untouched.`);
