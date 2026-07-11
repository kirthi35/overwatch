import { istClock } from './monitor-gates.js';

// IST time formatting + the per-turn clock banner. All functions take nowMs
// explicitly (injectable for tests). The audit found the model had NO date
// signal at all — wrong weekdays, "market is closed" during hours, 2-day-old
// alerts narrated as "just triggered" — because nothing ever told it what
// "now" is. These helpers are that signal.

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number): string => String(n).padStart(2, '0');

// IST calendar-day ordinal (for today/yesterday labels across the IST midnight
// boundary — NOT the UTC one).
function istDayNumber(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / 86400000);
}

/** "just now" | "5m ago" | "18h ago" | "2d ago" — age of a timestamp vs nowMs. */
export function relativeAge(ts: string | number, nowMs: number): string {
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return 'unknown age';
  const min = Math.floor(Math.max(0, nowMs - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "2026-07-09 15:30 IST (yesterday, 18h ago)" — absolute IST stamp + day label + age. */
export function formatIst(ts: string | number, nowMs: number): string {
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return String(ts);
  const d = new Date(ms + IST_OFFSET_MS);
  const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} IST`;
  const dayDiff = istDayNumber(nowMs) - istDayNumber(ms);
  const dayLabel = dayDiff <= 0 ? 'today' : dayDiff === 1 ? 'yesterday' : `${dayDiff} days ago`;
  return `${stamp} (${dayLabel}, ${relativeAge(ms, nowMs)})`;
}

/**
 * The per-turn system-prompt clock: IST weekday/date/time + NSE session state.
 * Weekday/date derive from the same +5.5h shift as istClock (no TZ-database
 * dependence). Holidays are NOT known here — the banner says so explicitly,
 * otherwise it would become a new source of "market is open" false claims.
 */
export function istNowBanner(nowMs: number): string {
  const c = istClock(nowMs);
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const weekday = WEEKDAYS[c.dow];
  const date = `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
  let session: string;
  if (c.dow === 0 || c.dow === 6) session = 'CLOSED (weekend)';
  else if (c.num >= 900 && c.num < 915) session = 'PRE-OPEN (regular trading starts 09:15 IST)';
  else if (c.num >= 915 && c.num <= 1530) session = 'OPEN (closes 15:30 IST)';
  else session = 'CLOSED (regular hours 09:15–15:30 IST, Mon–Fri)';
  return (
    `## CLOCK (server-verified)\n` +
    `Now: ${weekday}, ${date}, ${pad(c.h)}:${c.m} IST — NSE session: ${session}.\n` +
    `Exchange holidays are NOT checked here; if a holiday is plausible, confirm with resolve_market_time_and_calendar.\n` +
    `Trust THIS clock over any date/weekday you infer yourself.`
  );
}
