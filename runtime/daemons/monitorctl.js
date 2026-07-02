#!/usr/bin/env node
// Overwatch — monitorctl: manage background monitors from one place.
//
// WHY THIS EXISTS: monitors are standalone node daemons spawned via nohup/pm2.
// There was no way to (a) see what's running, (b) read their output in plain
// language, or (c) stop / pause / delete one. Output lived in three places
// (alerts.log + daemons/*.out + logs/*.log) in a terse machine format. This
// tool is the single front door.
//
// SELF-CONTAINED & ZERO-DEP: it discovers monitors from `ps` + the filesystem,
// so it works on EVERY monitor — including legacy hand-rolled daemons that
// predate the shared runtime and write no pidfile. No restart required.
//
// Usage:
//   node monitorctl.js list
//   node monitorctl.js logs <name> [-n 40] [-f] [--raw]
//   node monitorctl.js alerts [-n 40] [-f]
//   node monitorctl.js pause <name>      (SIGSTOP — freezes, no restart)
//   node monitorctl.js resume <name>     (SIGCONT)
//   node monitorctl.js stop <name>       (SIGTERM)
//   node monitorctl.js delete <name> -y  (stop + remove its files)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const OW = path.join(os.homedir(), '.overwatch');
const DAEMON_DIR = path.join(OW, 'daemons');
const LOG_DIR = path.join(OW, 'logs');
const STATE_DIR = path.join(OW, 'thesis');
const MON_DIR = path.join(OW, 'monitors');   // armed in-session monitors (JSON)
const ALERTS = path.join(OW, 'alerts.log');

// launchd persistence for the always-on monitor daemon (macOS). Makes monitord
// survive reboot/logout, not just the CLI closing.
const LAUNCHD_LABEL = 'com.overwatch.monitord';
const LAUNCHD_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
const MONITORD_JS = path.join(DAEMON_DIR, 'overwatch-monitord.js');

// Shared infra that is NEVER a monitor and must never be deleted.
const SHARED = new Set([
  'monitor-runtime.js', 'thesis-monitor.js', 'test-monitor-runtime.js',
  'monitorctl.js', 'start-monitors.sh',
]);

// ---- tiny ANSI helpers ----------------------------------------------------
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m', mag: '\x1b[35m',
};
const useColor = process.stdout.isTTY;
const c = (color, s) => (useColor ? C[color] + s + C.reset : s);

// ---- time helpers ---------------------------------------------------------
function toIST(d) {
  try {
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', hour12: false,
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return d.toISOString(); }
}
function istTimeOnly(d) {
  try {
    return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  } catch { return d.toISOString().slice(11, 19); }
}
function humanDuration(ms) {
  if (!isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d${h % 24}h`;
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

// ---- discovery ------------------------------------------------------------
//
// A monitor is identified by a stable `name`: the daemon script basename
// without .js (e.g. "paras-scenario-a"), or "thesis:<SYMBOL>" for instances of
// the generic thesis-monitor.js (disambiguated by the THESIS env var).

function psList() {
  // pid, state, start time, full command — one row per process.
  let out = '';
  try {
    out = execSync('ps -axww -o pid=,stat=,lstart=,command=', { encoding: 'utf8' });
  } catch { return []; }
  const rows = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // node ... <something>/daemons/<script>.js   (skip monitorctl itself)
    if (!/\bnode\b/.test(line)) continue;
    const m = line.match(/daemons\/([\w.-]+\.js)/);
    if (!m) continue;
    if (m[1] === 'monitorctl.js') continue;
    const parts = line.split(/\s+/);
    const pid = parts[0];
    const stat = parts[1];
    // lstart = next 5 whitespace tokens: "Wed Jun 25 11:48:31 2026"
    const lstart = parts.slice(2, 7).join(' ');
    rows.push({ pid: parseInt(pid, 10), stat, lstart, script: m[1], cmd: line });
  }
  return rows;
}

// Best-effort: read a process's environment to pull THESIS=... (macOS `ps -E`).
function envOf(pid) {
  try {
    const out = execSync(`ps -wwwE -o command= -p ${pid}`, { encoding: 'utf8' });
    const env = {};
    for (const tok of out.split(/\s+/)) {
      const eq = tok.indexOf('=');
      if (eq > 0) env[tok.slice(0, eq)] = tok.slice(eq + 1);
    }
    return env;
  } catch { return {}; }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Find the state file for a monitor name. Conventions seen in the wild:
//   <name>.state.json            (hand-rolled daemons)
//   .state_<SYMBOL>.json         (thesis-monitor)
function findStateFile(name, symbol) {
  let files = [];
  try { files = fs.readdirSync(STATE_DIR); } catch { return null; }
  const wantBase = `${name}.state.json`;
  if (files.includes(wantBase)) return path.join(STATE_DIR, wantBase);
  if (symbol) {
    const sym = symbol.toLowerCase();
    const cand = files.find(f => f.toLowerCase() === `.state_${sym}.json` || f.toLowerCase() === `${sym}.state.json`);
    if (cand) return path.join(STATE_DIR, cand);
  }
  // loose: any state file whose stem appears in the name
  const cand = files.find(f => /state/i.test(f) && name.includes(f.replace(/\.(state\.)?json$/i, '').replace(/^\.state_/, '')));
  return cand ? path.join(STATE_DIR, cand) : null;
}

// Locate the tick-log file for a monitor (stdout dump from nohup).
function findLogFile(name) {
  const cands = [
    path.join(DAEMON_DIR, `${name}.out`),
    path.join(LOG_DIR, `${name}.log`),
    path.join(DAEMON_DIR, `${name}.log`),
  ];
  return cands.find(p => fs.existsSync(p)) || null;
}

// Status label from process state + persisted monitor state.
function statusOf(m) {
  const proc = m.proc, state = m.state;
  // In-session monitors have no process — status comes from the armed file.
  if (m.kind === 'in-session') {
    if (m.armed && m.armed.disabled) return { txt: 'PAUSED', color: 'yellow' };
    if (state && state.fired) return { txt: 'FIRED', color: 'cyan' };
    if (state && state.blindAlerted) return { txt: 'BLIND', color: 'red' };
    return { txt: 'WATCHING', color: 'green' };
  }
  if (proc && proc.stat && proc.stat.includes('T')) return { txt: 'PAUSED', color: 'yellow' };
  if (proc) {
    if (state && state.blindLevel) return { txt: `BLIND(${state.blindLevel})`, color: 'red' };
    if (state && (state.consecutiveFails || 0) > 0) return { txt: 'DEGRADED', color: 'yellow' };
    return { txt: 'RUNNING', color: 'green' };
  }
  if (state && state.fired) return { txt: 'FIRED', color: 'cyan' };
  return { txt: 'STOPPED', color: 'gray' };
}

// Build the full monitor inventory: running (ps) ∪ known (files), deduped by name.
function discover() {
  const byName = new Map();

  // 1) running processes
  for (const p of psList()) {
    let name = p.script.replace(/\.js$/, '');
    let symbol = null;
    if (p.script === 'thesis-monitor.js') {
      const env = envOf(p.pid);
      const tpath = (env.THESIS || '').replace(/^~/, os.homedir());
      const thesis = tpath ? readJSON(tpath) : null;
      symbol = thesis && thesis.symbol ? thesis.symbol : null;
      name = symbol ? `thesis:${symbol}` : 'thesis-monitor';
    }
    const stateFile = findStateFile(name, symbol);
    const state = stateFile ? readJSON(stateFile) : null;
    byName.set(name, {
      name, symbol, proc: p, script: p.script,
      daemonFile: path.join(DAEMON_DIR, p.script),
      stateFile, state, logFile: findLogFile(name),
    });
  }

  for (const m of byName.values()) m.kind = 'daemon';

  // 2) known-but-stopped: daemon scripts on disk that aren't shared infra
  let scripts = [];
  try { scripts = fs.readdirSync(DAEMON_DIR).filter(f => f.endsWith('.js') && !SHARED.has(f)); } catch {}
  for (const s of scripts) {
    const name = s.replace(/\.js$/, '');
    if (byName.has(name)) continue;
    const stateFile = findStateFile(name, null);
    byName.set(name, {
      name, symbol: null, proc: null, script: s, kind: 'daemon',
      daemonFile: path.join(DAEMON_DIR, s),
      stateFile, state: stateFile ? readJSON(stateFile) : null,
      logFile: findLogFile(name),
    });
  }

  // 3) armed in-session monitors (~/.overwatch/monitors/*.json). These have no
  // process — the in-app watcher polls them. State lives inside the file.
  let armed = [];
  try { armed = fs.readdirSync(MON_DIR).filter(f => f.endsWith('.json')); } catch {}
  for (const f of armed) {
    const mon = readJSON(path.join(MON_DIR, f));
    if (!mon) continue;
    const name = mon.name || f.replace(/\.json$/, '');
    const kind = (mon.mode === 'daemon') ? 'daemon' : 'in-session';
    if (byName.has(name)) { byName.get(name).armedFile = path.join(MON_DIR, f); byName.get(name).armed = mon; continue; }
    byName.set(name, {
      name, symbol: mon.symbol || null, proc: null, kind,
      armedFile: path.join(MON_DIR, f), armed: mon,
      daemonFile: null, stateFile: null, state: mon.state || null,
      logFile: findLogFile(name),
    });
  }

  return [...byName.values()];
}

// ---- commands -------------------------------------------------------------

function cmdList() {
  const mons = discover();
  if (!mons.length) {
    console.log(c('gray', 'No monitors found (none running, no daemon scripts in ~/.overwatch/daemons).'));
    return;
  }
  // last tick + last LTP from the tail of the log file
  for (const m of mons) {
    m._last = lastTick(m.logFile);
  }
  console.log('');
  console.log(c('bold', '  OVERWATCH MONITORS'));
  console.log(c('gray', '  ' + '-'.repeat(94)));
  const head = `  ${'NAME'.padEnd(22)}${'MODE'.padEnd(12)}${'PID'.padEnd(8)}${'STATUS'.padEnd(14)}${'UPTIME'.padEnd(9)}${'LAST'.padEnd(10)}PRICE`;
  console.log(c('dim', head));
  for (const m of mons) {
    const st = statusOf(m);
    const pid = m.proc ? String(m.proc.pid) : '-';
    let uptime = '-';
    if (m.proc && m.proc.lstart) {
      const t = new Date(m.proc.lstart);
      if (!isNaN(t)) uptime = humanDuration(Date.now() - t.getTime());
    }
    const lastTickT = m._last && m._last.time ? istTimeOnly(m._last.time) : '-';
    // in-session monitors keep last price/poll in their armed-file state
    let lastPx = m._last && m._last.ltp != null ? `₹${m._last.ltp}` : '-';
    if (lastPx === '-' && m.state && m.state.lastLtp != null) lastPx = `₹${m.state.lastLtp}`;
    const row = `  ${m.name.padEnd(22)}${c('dim', m.kind.padEnd(12))}${pid.padEnd(8)}${c(st.color, st.txt.padEnd(14))}${uptime.padEnd(9)}${lastTickT.padEnd(10)}${lastPx}`;
    console.log(row);
  }
  console.log(c('gray', '  ' + '-'.repeat(94)));
  const live = mons.filter(m => m.proc || (m.kind === 'in-session' && !(m.armed && m.armed.disabled) && !(m.state && m.state.fired))).length;
  console.log(c('dim', `  ${live} active · ${mons.length} total`));
  console.log(c('dim', "  logs: monitorctl logs <name> -f   ·   stop/pause/resume/delete <name>"));
  console.log('');
}

// Pull the most recent tick line (time + LTP) from a log tail.
function lastTick(logFile) {
  if (!logFile || !fs.existsSync(logFile)) return null;
  const lines = tailLines(logFile, 60);
  for (let i = lines.length - 1; i >= 0; i--) {
    const p = parseTick(lines[i]);
    if (p && p.ltp != null) return p;
  }
  return null;
}

// Read last N lines of a file without loading the whole thing into memory twice.
function tailLines(file, n) {
  try {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split('\n').filter(l => l.length);
    return lines.slice(-n);
  } catch { return []; }
}

// ---- log parsing & pretty rendering ---------------------------------------

// Tick line emitted each poll, e.g.:
//   [15:28] LTP 1232 | zone[1090-1140]:false | green15m:true | sell:buy 4.55:1(<3:false)
function parseTick(line) {
  const m = line.match(/^\[(\d{1,2}):(\d{2})\]\s+LTP\s+([\d.]+)\s+\|\s+zone\[([\d.-]+)\]:(\w+)\s+\|\s+green(\w+):(\w+)\s+\|\s+sell:buy\s+([\d.]+):1/);
  if (!m) return null;
  return {
    raw: line, kind: 'tick',
    hh: m[1], mm: m[2], ltp: parseFloat(m[3]),
    zone: m[4], inZone: m[5] === 'true',
    candleTf: m[6], green: m[7] === 'true',
    ratio: parseFloat(m[8]),
    time: istDateFromHM(m[1], m[2]),
  };
}

// Build a Date for today (IST) at HH:MM — used only for display ordering/labels.
function istDateFromHM(hh, mm) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  ist.setUTCHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600 * 1000);
}

// Alert/notice line: [ISO] [SEV] [LABEL?] message
function parseAlert(line) {
  const m = line.match(/^\[([^\]]+)\]\s+\[(\w+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/);
  if (!m) return null;
  const t = new Date(m[1]);
  return { raw: line, kind: 'alert', time: isNaN(t) ? null : t, sev: m[2], label: m[3] || null, msg: m[4] };
}

// Generic console lines from the runtime (pre-gate, poll fail, etc.)
function parseNote(line) {
  const m = line.match(/^\[(\d{1,2}):(\d{2})\]\s+(.*)$/);
  if (!m) return null;
  return { raw: line, kind: 'note', hh: m[1], mm: m[2], text: m[3], time: istDateFromHM(m[1], m[2]) };
}

const SEV_ICON = { INFO: 'ℹ️ ', WARNING: '⚠️ ', CRITICAL: '🔴', RECOVERED: '🟢' };
const SEV_COLOR = { INFO: 'blue', WARNING: 'yellow', CRITICAL: 'red' };

function renderTick(t) {
  const time = c('gray', istTimeOnly(t.time).padEnd(9));
  const px = c('bold', `₹${t.ltp}`.padEnd(10));
  const zone = t.inZone ? c('green', `in zone ${t.zone}`) : c('dim', `outside zone ${t.zone}`);
  const candle = t.green ? c('green', `${t.candleTf} green ✓`) : c('dim', `${t.candleTf} red ✗`);
  const heavy = t.ratio >= 3;
  const book = (heavy ? c('red', `book ${t.ratio.toFixed(2)}:1 heavy sell`) : c('green', `book ${t.ratio.toFixed(2)}:1 healthy`));
  return `${time}${px}  ${zone}  ·  ${candle}  ·  ${book}`;
}

function renderAlert(a) {
  const icon = SEV_ICON[a.sev] || '  ';
  const time = a.time ? istTimeOnly(a.time) : '--:--:--';
  const tag = a.label ? c('mag', `[${a.label}] `) : '';
  const sev = c(SEV_COLOR[a.sev] || 'reset', `${a.sev}`);
  return `${icon} ${c('gray', time)}  ${sev}  ${tag}${a.msg}`;
}

function renderNote(n) {
  return `${c('gray', istTimeOnly(n.time).padEnd(9))}${c('dim', n.text)}`;
}

function prettyLine(line, raw) {
  if (raw) return line;
  const a = parseAlert(line); if (a) return renderAlert(a);
  const t = parseTick(line);  if (t) return renderTick(t);
  const n = parseNote(line);  if (n) return renderNote(n);
  return c('dim', line);
}

function cmdLogs(name, opts) {
  const mon = resolve(name);
  if (!mon) return;
  // A monitor's story = its tick log (per-monitor) + its alert lines (global).
  // alerts.log is free-text, so match on the monitor's name tokens (e.g.
  // "paras-scenario-a" -> ["PARAS","SCENARIO","A"]) plus the symbol; an alert
  // is relevant if its label or message contains all the multi-char tokens.
  const tickLines = mon.logFile ? tailLines(mon.logFile, opts.n) : [];
  const tokens = (mon.symbol ? [mon.symbol] : mon.name.split(/[^a-z0-9]+/i))
    .map(t => t.toUpperCase()).filter(t => t.length >= 2);
  const alertLines = tailLines(ALERTS, 400)
    .filter(l => {
      const a = parseAlert(l);
      if (!a) return false;
      const hay = `${a.label || ''} ${a.msg || ''}`.toUpperCase();
      return tokens.length > 0 && tokens.every(t => hay.includes(t));
    })
    .slice(-opts.n);

  console.log('');
  console.log(c('bold', `  LOGS — ${mon.name}`) + c('dim', mon.logFile ? `  (${path.relative(OW, mon.logFile)})` : '  (no tick log file)'));
  console.log(c('gray', '  ' + '-'.repeat(70)));
  if (alertLines.length) {
    console.log(c('bold', '  Alerts & events:'));
    for (const l of alertLines) console.log('  ' + prettyLine(l, opts.raw));
    console.log('');
  }
  console.log(c('bold', '  Recent ticks:'));
  if (!tickLines.length) console.log(c('gray', '  (no ticks logged yet)'));
  for (const l of tickLines) console.log('  ' + prettyLine(l, opts.raw));
  console.log('');

  if (opts.follow && mon.logFile) followFile(mon.logFile, opts.raw);
}

function cmdAlerts(opts) {
  console.log('');
  console.log(c('bold', '  OVERWATCH ALERTS') + c('dim', `  (${path.relative(OW, ALERTS)})`));
  console.log(c('gray', '  ' + '-'.repeat(70)));
  const lines = tailLines(ALERTS, opts.n);
  if (!lines.length) console.log(c('gray', '  (empty)'));
  for (const l of lines) console.log('  ' + prettyLine(l, opts.raw));
  console.log('');
  if (opts.follow) followFile(ALERTS, opts.raw);
}

// tail -f: poll the file for growth and pretty-print new lines.
function followFile(file, raw) {
  console.log(c('dim', '  …following (Ctrl-C to stop)'));
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  let buf = '';
  setInterval(() => {
    let st; try { st = fs.statSync(file); } catch { return; }
    if (st.size <= size) { size = st.size; return; }
    const fd = fs.openSync(file, 'r');
    const len = st.size - size;
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, size);
    fs.closeSync(fd);
    size = st.size;
    buf += b.toString('utf8');
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const l of parts) if (l.length) console.log('  ' + prettyLine(l, raw));
  }, 1000);
}

// ---- lifecycle: pause / resume / stop / delete ----------------------------

function resolve(name) {
  const mons = discover();
  let hits = mons.filter(m => m.name === name);
  if (!hits.length) hits = mons.filter(m => m.name.includes(name) || (m.symbol && m.symbol.toLowerCase() === name.toLowerCase()));
  if (!hits.length) {
    console.log(c('red', `No monitor matches "${name}".`));
    console.log(c('dim', '  Known: ' + (mons.map(m => m.name).join(', ') || 'none')));
    return null;
  }
  if (hits.length > 1) {
    console.log(c('yellow', `"${name}" is ambiguous: ${hits.map(m => m.name).join(', ')}. Be specific.`));
    return null;
  }
  return hits[0];
}

function signal(mon, sig, verb) {
  if (!mon.proc) { console.log(c('yellow', `${mon.name} is not running — nothing to ${verb}.`)); return false; }
  try {
    process.kill(mon.proc.pid, sig);
    console.log(c('green', `${verb} ${mon.name} (pid ${mon.proc.pid}) [${sig}].`));
    return true;
  } catch (e) {
    console.log(c('red', `Failed to ${verb} ${mon.name}: ${e.message}`));
    return false;
  }
}

// In-session monitors have no process — pause/resume/stop flip a flag in the
// armed JSON file; the in-app watcher honors `disabled` on its next tick.
function setArmed(mon, patch, verb) {
  try {
    const cur = JSON.parse(fs.readFileSync(mon.armedFile, 'utf8'));
    Object.assign(cur, patch);
    fs.writeFileSync(mon.armedFile, JSON.stringify(cur, null, 2));
    console.log(c('green', `${verb} ${mon.name} (in-session).`));
  } catch (e) { console.log(c('red', `Failed to ${verb} ${mon.name}: ${e.message}`)); }
}

function cmdPause(name)  { const m = resolve(name); if (!m) return; m.kind === 'in-session' ? setArmed(m, { disabled: true },  'Paused')  : signal(m, 'SIGSTOP', 'Paused'); }
function cmdResume(name) { const m = resolve(name); if (!m) return; m.kind === 'in-session' ? setArmed(m, { disabled: false }, 'Resumed') : signal(m, 'SIGCONT', 'Resumed'); }
function cmdStop(name)   { const m = resolve(name); if (!m) return; m.kind === 'in-session' ? setArmed(m, { disabled: true },  'Stopped') : signal(m, 'SIGTERM', 'Stopped'); }

function cmdDelete(name, yes) {
  const m = resolve(name);
  if (!m) return;
  if (!yes) {
    console.log(c('yellow', `Delete ${m.name} — this STOPS it and REMOVES its files:`));
    if (m.proc) console.log(`  · kill pid ${m.proc.pid}`);
    if (m.daemonFile && fs.existsSync(m.daemonFile) && !SHARED.has(path.basename(m.daemonFile)))
      console.log(`  · ${path.relative(OW, m.daemonFile)}`);
    if (m.armedFile && fs.existsSync(m.armedFile)) console.log(`  · ${path.relative(OW, m.armedFile)}`);
    if (m.stateFile && fs.existsSync(m.stateFile)) console.log(`  · ${path.relative(OW, m.stateFile)}`);
    if (m.logFile && fs.existsSync(m.logFile)) console.log(`  · ${path.relative(OW, m.logFile)}`);
    console.log(c('bold', `\n  Re-run with -y to confirm:  monitorctl delete ${m.name} -y`));
    return;
  }
  if (m.proc) { try { process.kill(m.proc.pid, 'SIGTERM'); console.log(c('green', `Killed pid ${m.proc.pid}.`)); } catch (e) { console.log(c('red', `kill failed: ${e.message}`)); } }
  const rm = (p, why) => {
    if (!p || !fs.existsSync(p)) return;
    if (SHARED.has(path.basename(p))) { console.log(c('yellow', `  skipped shared file ${path.basename(p)}`)); return; }
    try { fs.unlinkSync(p); console.log(c('gray', `  removed ${why}: ${path.relative(OW, p)}`)); } catch (e) { console.log(c('red', `  rm ${why} failed: ${e.message}`)); }
  };
  rm(m.daemonFile, 'daemon');
  rm(m.armedFile, 'armed');
  rm(m.stateFile, 'state');
  rm(m.logFile, 'log');
  console.log(c('green', `Deleted ${m.name}.`));
}

// ---- launchd persistence (macOS) ------------------------------------------
//
// arm_monitor spawns monitord detached, so a watch survives the CLI closing —
// but NOT a reboot/logout. A LaunchAgent makes launchd own the daemon: start it
// at login and relaunch it if it crashes. KeepAlive is scoped to SuccessfulExit
// =false so monitord's clean singleton-exit(0) (when another copy is already
// running) is NOT fought, only real crashes are relaunched.

function plistXml() {
  const logOut = path.join(LOG_DIR, 'monitord.out');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${MONITORD_JS}</string>
  </array>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key> <integer>30</integer>
  <key>WorkingDirectory</key> <string>${OW}</string>
  <key>StandardOutPath</key>  <string>${logOut}</string>
  <key>StandardErrorPath</key><string>${logOut}</string>
</dict>
</plist>
`;
}

function launchdLoaded() {
  try { execSync(`launchctl list ${LAUNCHD_LABEL}`, { stdio: 'pipe' }); return true; } catch { return false; }
}

function cmdDaemonInstall() {
  if (process.platform !== 'darwin') {
    console.log(c('yellow', 'launchd install is macOS-only. On Linux use systemd --user or pm2 to run:'));
    console.log(c('dim', `  ${process.execPath} ${MONITORD_JS}`));
    return;
  }
  if (!fs.existsSync(MONITORD_JS)) { console.log(c('red', `monitord not found at ${MONITORD_JS} — run \`npm run seed\` first.`)); return; }
  try {
    fs.mkdirSync(path.dirname(LAUNCHD_PLIST), { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LAUNCHD_PLIST, plistXml());
    // Reload cleanly: unload if already present, then load -w (enable).
    if (launchdLoaded()) { try { execSync(`launchctl unload ${LAUNCHD_PLIST}`, { stdio: 'pipe' }); } catch {} }
    execSync(`launchctl load -w ${LAUNCHD_PLIST}`, { stdio: 'pipe' });
    console.log(c('green', `Installed + loaded ${LAUNCHD_LABEL}.`));
    console.log(c('dim', `  plist: ${LAUNCHD_PLIST}`));
    console.log(c('dim', `  monitord now starts at login and relaunches on crash. Token read from ~/.overwatch/groww.json.`));
    console.log(c('dim', `  Check:  monitorctl daemon status`));
  } catch (e) {
    console.log(c('red', `Install failed: ${e.message}`));
  }
}

function cmdDaemonUninstall() {
  if (process.platform !== 'darwin') { console.log(c('yellow', 'launchd is macOS-only; nothing to uninstall.')); return; }
  try {
    if (fs.existsSync(LAUNCHD_PLIST)) {
      try { execSync(`launchctl unload ${LAUNCHD_PLIST}`, { stdio: 'pipe' }); } catch {}
      fs.unlinkSync(LAUNCHD_PLIST);
      console.log(c('green', `Uninstalled ${LAUNCHD_LABEL} (plist removed, unloaded).`));
    } else {
      console.log(c('gray', `${LAUNCHD_LABEL} not installed.`));
    }
    console.log(c('dim', 'A monitord already spawned by the CLI keeps running until it exits; stop it with: monitorctl stop overwatch-monitord'));
  } catch (e) {
    console.log(c('red', `Uninstall failed: ${e.message}`));
  }
}

function cmdDaemonStatus() {
  const pidfile = path.join(OW, 'monitord.pid');
  const pinfo = readJSON(pidfile);
  const running = pinfo && pinfo.pid && (() => { try { process.kill(pinfo.pid, 0); return true; } catch { return false; } })();
  console.log('');
  console.log(c('bold', '  MONITORD DAEMON'));
  console.log(c('gray', '  ' + '-'.repeat(50)));
  console.log(`  process:        ${running ? c('green', `running (pid ${pinfo.pid}, since ${pinfo.startedAt || '?'})`) : c('red', 'NOT running')}`);
  if (process.platform === 'darwin') {
    console.log(`  launchd:        ${launchdLoaded() ? c('green', 'installed (starts at login, relaunch on crash)') : c('yellow', 'not installed — run: monitorctl daemon install')}`);
    console.log(c('dim', `  plist:          ${fs.existsSync(LAUNCHD_PLIST) ? LAUNCHD_PLIST : '(none)'}`));
  }
  const armedN = (() => { try { return fs.readdirSync(MON_DIR).filter(f => f.endsWith('.json')).length; } catch { return 0; } })();
  console.log(`  armed monitors: ${armedN}`);
  console.log('');
}

function cmdDaemon(sub) {
  switch (sub) {
    case 'install': case 'enable': return cmdDaemonInstall();
    case 'uninstall': case 'disable': return cmdDaemonUninstall();
    case 'status': case undefined: return cmdDaemonStatus();
    default: console.log(c('red', `unknown daemon subcommand: ${sub}`)); console.log(c('dim', '  use: daemon install | uninstall | status'));
  }
}

// ---- arg parsing & dispatch -----------------------------------------------

function parseOpts(argv) {
  const o = { n: 40, follow: false, raw: false, yes: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-n' || a === '--lines') o.n = parseInt(argv[++i], 10) || 40;
    else if (a === '-f' || a === '--follow') o.follow = true;
    else if (a === '--raw') o.raw = true;
    else if (a === '-y' || a === '--yes') o.yes = true;
    else o._.push(a);
  }
  return o;
}

function usage() {
  console.log(`
${c('bold', 'monitorctl')} — manage Overwatch monitors

  ${c('cyan', 'list')}                      show all monitors + status
  ${c('cyan', 'logs')} <name> [-n N] [-f] [--raw]   human-readable logs (-f follow)
  ${c('cyan', 'alerts')} [-n N] [-f]         global alert feed (all monitors)
  ${c('cyan', 'pause')} <name>               freeze it (SIGSTOP) — no restart needed
  ${c('cyan', 'resume')} <name>              unfreeze it (SIGCONT)
  ${c('cyan', 'stop')} <name>                terminate it (SIGTERM)
  ${c('cyan', 'delete')} <name> -y           stop + remove its files
  ${c('cyan', 'daemon')} install|uninstall|status   persist monitord via launchd (macOS)
`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseOpts(rest);
  const name = o._[0];
  switch (cmd) {
    case 'list': case 'ls': case undefined: return cmdList();
    case 'logs': case 'log': if (!name) return console.log(c('red', 'usage: monitorctl logs <name>')); return cmdLogs(name, o);
    case 'alerts': return cmdAlerts(o);
    case 'pause': if (!name) return console.log(c('red', 'usage: monitorctl pause <name>')); return cmdPause(name);
    case 'resume': case 'unpause': if (!name) return console.log(c('red', 'usage: monitorctl resume <name>')); return cmdResume(name);
    case 'stop': case 'kill': if (!name) return console.log(c('red', 'usage: monitorctl stop <name>')); return cmdStop(name);
    case 'delete': case 'rm': if (!name) return console.log(c('red', 'usage: monitorctl delete <name> -y')); return cmdDelete(name, o.yes);
    case 'daemon': return cmdDaemon(name);
    case 'help': case '-h': case '--help': return usage();
    default: console.log(c('red', `unknown command: ${cmd}`)); return usage();
  }
}

main();
