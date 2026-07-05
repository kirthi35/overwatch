// Pure helpers for the trade audit spine (ADR 0005). No IO — shared by the store, the
// tools, and (re-implemented) the web tab. Keeps "what status is this trade" and "were
// the rules followed" in one place so the audit stays honest.
import { Trade, TradeGates, TradeStatus } from './types.js';

/** Rules were followed iff no gate was overridden. */
export function isAdherent(gates?: TradeGates): boolean {
  return !(gates?.overridden && gates.overridden.length > 0);
}

/** Lifecycle status inferred from what the trade actually HOLDS — the source of truth for
 *  the Trades columns. A doc that already holds a live position is OPEN even if it was
 *  written as a "card" (fixes the Open-vs-Carded mis-bucketing). Explicit CLOSED /
 *  ABANDONED are respected; otherwise derive from data. */
export function effectiveStatus(t: Trade): TradeStatus {
  if (t.status === 'CLOSED' || t.status === 'ABANDONED') return t.status;
  if (t.close && (t.close.exit_price != null || t.close.exit_date)) return 'CLOSED';
  const held = !!(t.position && ((t.position.shares ?? 0) > 0 || t.position.entry != null));
  if (held || t.status === 'OPEN') return 'OPEN';
  if (t.card) return 'CARDED';
  return 'WATCHING';
}

/** Merge one partial into an existing trade; sub-objects merge one level deep (so a
 *  card write doesn't wipe the thesis). Empty sub-objects are dropped. */
export function mergeTrade(prev: Trade | null, patch: Partial<Trade> & { tradeId: string }): Trade {
  const base: Trade =
    prev ?? { tradeId: patch.tradeId, symbol: patch.symbol ?? 'UNKNOWN', status: patch.status ?? 'WATCHING' };
  const merged: Trade = { ...base, ...patch };
  merged.thesis = { ...(base.thesis ?? {}), ...(patch.thesis ?? {}) };
  merged.card = { ...(base.card ?? {}), ...(patch.card ?? {}) };
  merged.position = { ...(base.position ?? {}), ...(patch.position ?? {}) };
  merged.gates = { ...(base.gates ?? {}), ...(patch.gates ?? {}) };
  merged.close = { ...(base.close ?? {}), ...(patch.close ?? {}) };
  for (const k of ['thesis', 'card', 'position', 'gates', 'close'] as const) {
    const v = merged[k] as Record<string, unknown> | undefined;
    if (v && Object.keys(v).length === 0) delete (merged as unknown as Record<string, unknown>)[k];
  }
  return merged;
}

/** Throw if the explicit status contradicts the data — OPEN needs a position, CLOSED
 *  needs a close. Keeps a written status from lying to the audit. */
export function assertTradeConsistent(t: Trade): void {
  if (t.status === 'OPEN' && !(t.position && (t.position.entry != null || (t.position.shares ?? 0) > 0))) {
    throw new Error(`trade ${t.tradeId}: status OPEN requires a position (entry/shares)`);
  }
  if (t.status === 'CLOSED' && !(t.close && (t.close.exit_price != null || t.close.exit_date))) {
    throw new Error(`trade ${t.tradeId}: status CLOSED requires a close (exit_price/exit_date)`);
  }
}
