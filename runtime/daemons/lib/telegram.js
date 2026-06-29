// Overwatch — Telegram delivery sink (daemon realm, CommonJS, zero-dep).
//
// WHY THIS EXISTS: monitors write fires to ~/.overwatch/alerts.log and the
// in-session alert-bridge surfaces them in chat. But with the CLI CLOSED
// (walk-away / overnight) nothing reaches the user — alerts.log just grows
// unread. This pushes every qualifying alert to a Telegram bot so a fire lands
// on the phone whether or not Overwatch is running. This is the piece that
// makes closed-CLI monitoring actionable (idea.md §1.3 / §6).
//
// NO DEPS: uses global fetch (Node 18+). FIRE-AND-FORGET: a delivery failure
// must NEVER crash a monitor, so every error is swallowed (logged to stderr).
//
// CONFIG RESOLUTION (first hit wins) — works both in-process (env set by the
// CLI) and in a daemon spawned in a bare shell (the file fallback):
//   1. env  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (+ optional TELEGRAM_MIN_SEVERITY)
//   2. ~/.overwatch/telegram.json  { botToken, chatId, minSeverity? }   (chmod 600)
// Unconfigured = silently disabled (notify is a no-op). Alerts still hit
// alerts.log either way.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG = path.join(os.homedir(), '.overwatch', 'telegram.json');
const RANK = { INFO: 0, WARNING: 1, CRITICAL: 2 };

function loadConfig() {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';
  let minSeverity = process.env.TELEGRAM_MIN_SEVERITY || '';
  if (!botToken || !chatId) {
    try {
      const f = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      botToken = botToken || f.botToken || '';
      chatId = chatId || f.chatId || '';
      minSeverity = minSeverity || f.minSeverity || '';
    } catch { /* no file — Telegram disabled */ }
  }
  return { botToken, chatId, minSeverity: (minSeverity || 'WARNING').toUpperCase() };
}

function enabled() {
  const c = loadConfig();
  return !!(c.botToken && c.chatId);
}

// Send one alert. ALWAYS resolves (never rejects) so callers can fire-and-forget.
// Returns { ok } | { ok:false, skipped } | { ok:false, status|error }.
async function notifyTelegram({ label, message, severity } = {}) {
  const c = loadConfig();
  if (!c.botToken || !c.chatId) return { ok: false, skipped: 'unconfigured' };

  const sev = (severity || 'INFO').toUpperCase();
  if ((RANK[sev] ?? 0) < (RANK[c.minSeverity] ?? 1)) return { ok: false, skipped: 'below-threshold' };

  // Plain text (no parse_mode): alert bodies contain ':' / '*' / '_' / '[' that
  // would break Markdown parsing and bounce as HTTP 400.
  const icon = sev === 'CRITICAL' ? '\u{1F534}' : sev === 'WARNING' ? '\u{1F7E0}' : '\u{1F535}';
  const text = `${icon} OVERWATCH ${sev}${label ? ` — ${label}` : ''}\n${message}`;
  const url = `https://api.telegram.org/bot${c.botToken}/sendMessage`;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c.chatId, text, disable_web_page_preview: true }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(to));
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[telegram] delivery failed ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[telegram] delivery error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { notifyTelegram, enabled, loadConfig };
