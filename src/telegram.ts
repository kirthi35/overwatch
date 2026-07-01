// Overwatch — Telegram delivery sink (CLI realm, ESM/TS).
//
// Mirror of runtime/daemons/lib/telegram.js for the in-process side (the
// in-session watcher and the console_log_alert tool). The two realms can't
// share a module (compiled ESM in dist/ vs seeded CJS in ~/.overwatch/daemons),
// so this is a deliberate small twin. Same config resolution, same wire format,
// so an alert looks identical whether it came from a daemon or in-session.
//
// Config (first hit wins): env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, then
// ~/.overwatch/telegram.json. Unconfigured = no-op. Never throws.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CFG = path.join(os.homedir(), '.overwatch', 'telegram.json');
const RANK: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

interface TgConfig { botToken: string; chatId: string; minSeverity: string; }

function loadConfig(): TgConfig {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';
  let minSeverity = process.env.TELEGRAM_MIN_SEVERITY || '';
  if (!botToken || !chatId) {
    try {
      const f = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      botToken = botToken || f.botToken || '';
      chatId = chatId || f.chatId || '';
      minSeverity = minSeverity || f.minSeverity || '';
    } catch { /* unconfigured — Telegram disabled */ }
  }
  return { botToken, chatId, minSeverity: (minSeverity || 'WARNING').toUpperCase() };
}

export function telegramEnabled(): boolean {
  const c = loadConfig();
  return !!(c.botToken && c.chatId);
}

// Fire-and-forget alert delivery. Always resolves; never throws.
export async function notifyTelegram(opts: { label?: string; message: string; severity?: string }): Promise<void> {
  const c = loadConfig();
  if (!c.botToken || !c.chatId) return;

  const sev = (opts.severity || 'INFO').toUpperCase();
  if ((RANK[sev] ?? 0) < (RANK[c.minSeverity] ?? 1)) return;

  const icon = sev === 'CRITICAL' ? '\u{1F534}' : sev === 'WARNING' ? '\u{1F7E0}' : '\u{1F535}';
  const text = `${icon} OVERWATCH ${sev}${opts.label ? ` — ${opts.label}` : ''}\n${opts.message}`;
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
    }
  } catch (e: any) {
    console.error(`[telegram] delivery error: ${e.message}`);
  }
}
