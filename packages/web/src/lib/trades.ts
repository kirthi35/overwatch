// Pure trade-lifecycle logic for the Trades tab. No React, no Firebase — kept pure so it
// is unit-testable (see trades.test.ts) and so the tab stays a thin renderer.
//
// The doctrine skills emit MULTIPLE symbol-keyed docs per trade (the existing grain):
//   <sym>                  -> thesis root   (WATCHING)
//   <sym>-card            -> trade card    (CARDED)
//   <sym>-active-position -> open position (OPEN)
// plus an append-only users/{uid}/journal of CLOSED records. This module reads those and
// correlates them by symbol — no migration, no new doc model. See docs/adr/0004.

export type LifecycleStatus = 'WATCHING' | 'CARDED' | 'OPEN';

export interface ThesisDoc {
  id: string;
  symbol?: string;
  [k: string]: unknown;
}

export interface JournalRow {
  id: string;
  symbol?: string;
  entry?: number | null;
  exit_price?: number | null;
  realized_R?: number | null;
  shares?: number | null;
  mode?: string | null;
  exit_date?: string | null;
  hold_days?: number | null;
  gates_overridden?: string[];
  adherence_score?: number | null;
  one_line_lesson?: string;
  status?: string;
  ts?: string;
  [k: string]: unknown;
}

export interface LiveTrade {
  symbol: string;
  status: LifecycleStatus;
  thesis?: ThesisDoc;
  card?: ThesisDoc;
  position?: ThesisDoc;
}

export interface Expectancy {
  closedCount: number;
  wins: number;
  losses: number;
  winRate: number | null; // null when no closed-with-R trades
  avgWinR: number | null;
  avgLossR: number | null; // positive magnitude
  expectancy: number | null; // R per trade
  avgAdherence: number | null;
  overrides: number; // closed trades with a non-empty gates_overridden
}

const CARD_SUFFIX = '-card';
const POS_SUFFIX = '-active-position';

/** Base symbol for a thesis doc: prefer an explicit `symbol` field, else derive from the
 *  doc id by stripping the -card / -active-position suffix. Always upper-cased. */
export function baseSymbol(doc: { id: string; symbol?: string }): string {
  if (doc.symbol && String(doc.symbol).trim()) return String(doc.symbol).trim().toUpperCase();
  let id = doc.id;
  if (id.endsWith(POS_SUFFIX)) id = id.slice(0, -POS_SUFFIX.length);
  else if (id.endsWith(CARD_SUFFIX)) id = id.slice(0, -CARD_SUFFIX.length);
  return id.toUpperCase();
}

function docKind(id: string): 'position' | 'card' | 'thesis' {
  if (id.endsWith(POS_SUFFIX)) return 'position';
  if (id.endsWith(CARD_SUFFIX)) return 'card';
  return 'thesis';
}

/** Correlate the flat theses docs into one live trade per symbol, bucketed by lifecycle.
 *  A symbol with an active-position doc is OPEN; else with a card is CARDED; else WATCHING. */
export function correlateTrades(theses: ThesisDoc[]): LiveTrade[] {
  const bySymbol = new Map<string, LiveTrade>();
  for (const doc of theses) {
    const sym = baseSymbol(doc);
    if (!sym) continue;
    let t = bySymbol.get(sym);
    if (!t) {
      t = { symbol: sym, status: 'WATCHING' };
      bySymbol.set(sym, t);
    }
    const kind = docKind(doc.id);
    if (kind === 'position') t.position = doc;
    else if (kind === 'card') t.card = doc;
    else t.thesis = doc;
  }
  for (const t of bySymbol.values()) {
    t.status = t.position ? 'OPEN' : t.card ? 'CARDED' : 'WATCHING';
  }
  // Stable order: OPEN, then CARDED, then WATCHING; alphabetical within.
  const rank: Record<LifecycleStatus, number> = { OPEN: 0, CARDED: 1, WATCHING: 2 };
  return [...bySymbol.values()].sort(
    (a, b) => rank[a.status] - rank[b.status] || a.symbol.localeCompare(b.symbol),
  );
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Rolling expectancy + adherence over CLOSED journal records. A record only counts toward
 *  expectancy when realized_R is a finite number — OPEN/backfilled rows (realized_R null)
 *  are skipped, which is why the panel never renders NaN. */
export function computeExpectancy(journal: JournalRow[]): Expectancy {
  const closed = journal.filter(
    (r) => typeof r.realized_R === 'number' && Number.isFinite(r.realized_R),
  );
  const empty: Expectancy = {
    closedCount: 0, wins: 0, losses: 0, winRate: null, avgWinR: null,
    avgLossR: null, expectancy: null, avgAdherence: null, overrides: 0,
  };
  const overrides = journal.filter((r) => (r.gates_overridden?.length ?? 0) > 0).length;
  const adh = journal
    .map((r) => r.adherence_score)
    .filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
  if (closed.length === 0) return { ...empty, overrides, avgAdherence: adh.length ? mean(adh) : null };

  const winRs = closed.filter((r) => (r.realized_R as number) > 0).map((r) => r.realized_R as number);
  const lossRs = closed.filter((r) => (r.realized_R as number) <= 0).map((r) => Math.abs(r.realized_R as number));
  const winRate = winRs.length / closed.length;
  const avgWinR = winRs.length ? mean(winRs) : 0;
  const avgLossR = lossRs.length ? mean(lossRs) : 0;
  const expectancy = winRate * avgWinR - (1 - winRate) * avgLossR;
  return {
    closedCount: closed.length,
    wins: winRs.length,
    losses: lossRs.length,
    winRate,
    avgWinR,
    avgLossR,
    expectancy,
    avgAdherence: adh.length ? mean(adh) : null,
    overrides,
  };
}
