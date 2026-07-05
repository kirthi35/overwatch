// Pure trade-audit logic for the Trades tab (ADR 0005). No React/Firebase — unit-tested
// in trades.test.ts. The tab reads the `trades` collection (the audit spine): each trade
// carries its thesis (why), card, position, gates, and — once closed — a verdict.
// journal = trades where status == CLOSED.

export type TradeStatus = 'WATCHING' | 'CARDED' | 'OPEN' | 'CLOSED' | 'ABANDONED';
export type ThesisVerdict = 'RIGHT' | 'WRONG' | 'PARTIAL';

export interface TradeClose {
  exit_price?: number | null;
  exit_date?: string | null;
  realized_R?: number | null;
  hold_days?: number | null;
  thesis_verdict?: ThesisVerdict;
  adherent?: boolean;
  one_line_lesson?: string;
}

export interface Trade {
  id: string; // firestore doc id
  tradeId?: string;
  symbol?: string;
  conversationId?: string;
  status?: TradeStatus;
  reentryOf?: string;
  thesis?: Record<string, any>;
  card?: Record<string, any>;
  position?: Record<string, any>;
  gates?: { passed?: string[]; overridden?: string[] };
  close?: TradeClose;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/** Lifecycle status from what the trade HOLDS (mirrors core/trade.ts) — a trade that holds
 *  a live position is OPEN even if it was written as a card. This is the column source of
 *  truth and fixes the Open-vs-Carded mis-bucketing. */
export function effectiveStatus(t: Trade): TradeStatus {
  if (t.status === 'CLOSED' || t.status === 'ABANDONED') return t.status;
  if (t.close && (t.close.exit_price != null || t.close.exit_date)) return 'CLOSED';
  const held = !!(t.position && (((t.position.shares as number) ?? 0) > 0 || t.position.entry != null));
  if (held || t.status === 'OPEN') return 'OPEN';
  if (t.card) return 'CARDED';
  return 'WATCHING';
}

export interface Audit {
  closed: number;
  wins: number;
  winRate: number | null;
  /** Expectancy when the rules were FOLLOWED — the "is the doctrine right?" number. */
  expAdherent: number | null;
  /** Expectancy when the rules were BROKEN — the "is my discipline right?" number. */
  expRuleBreak: number | null;
  /** Closed trades that overrode a gate (adherence failures). */
  overrides: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Expectancy = win% × avg_win_R − loss% × avg_loss_R over a set of realized-R values. */
export function expectancy(rs: number[]): number | null {
  if (!rs.length) return null;
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0).map(Math.abs);
  const wr = wins.length / rs.length;
  return wr * mean(wins) - (1 - wr) * mean(losses);
}

/** Rolling audit over CLOSED trades. Skips trades with no realized_R (never NaN). Splits
 *  expectancy by adherence so a rule-break loss (PARAS/RUBICON) doesn't indict the doctrine. */
export function computeAudit(trades: Trade[]): Audit {
  const closed = trades.filter((t) => effectiveStatus(t) === 'CLOSED');
  const withR = closed
    .map((t) => ({ r: t.close?.realized_R, adherent: t.close?.adherent }))
    .filter((x): x is { r: number; adherent: boolean | undefined } => typeof x.r === 'number' && Number.isFinite(x.r));
  const rAll = withR.map((x) => x.r);
  const rAdh = withR.filter((x) => x.adherent === true).map((x) => x.r);
  const rBreak = withR.filter((x) => x.adherent === false).map((x) => x.r);
  const wins = rAll.filter((r) => r > 0).length;
  const overrides = closed.filter(
    (t) => t.close?.adherent === false || (t.gates?.overridden?.length ?? 0) > 0,
  ).length;
  return {
    closed: closed.length,
    wins,
    winRate: rAll.length ? wins / rAll.length : null,
    expAdherent: expectancy(rAdh),
    expRuleBreak: expectancy(rBreak),
    overrides,
  };
}
