// Profitability metrics — trader-edge-validation Stage C (task 6; design R4).
//
// Net-of-cost performance derived SOLELY from Trade_Ledger rows (R3.4): no
// summary is computed by a path that bypasses the ledger. The headline measure
// of edge is Net_Expectancy AFTER costs (in pips AND R-multiples), NOT directional
// accuracy (R4.6). Every figure is net with the gross retained for comparison
// (R4.5); the `ambiguous` and `expired` shares are always reported so the
// headline cannot hide unresolved trades (R4.4). Breakdowns by pair / horizon /
// direction / confidence band expose concentration of profit (R4.3).
//
// Pure, deterministic, LLM-free. A separate read-only consumer; never on the
// live firing / scoring path.

import type { TradeLedgerRow } from "../trade-ledger/types.js";

/** The aggregate performance summary for a set of ledger rows (R4.1, R4.2, R4.4). */
export interface PerformanceSummary {
  readonly strategyId: string;
  /** Net-of-cost mean pips per SIMULATED trade — the headline (R4.6). */
  readonly netExpectancyPips: number;
  /** Net-of-cost mean R-multiple per simulated trade with a defined R (R4.1). */
  readonly netExpectancyR: number;
  /** Gross (pre-cost) mean pips, retained for comparison (R4.5). */
  readonly grossExpectancyPips: number;
  readonly winRate: number;
  readonly avgWinPips: number;
  readonly avgLossPips: number;
  /** Sum of wins / |sum of losses|; Infinity when there are wins but no losses. */
  readonly profitFactor: number;
  /** Largest peak-to-trough drawdown of the cumulative net-pip equity curve. */
  readonly maxDrawdownPips: number;
  readonly longestLosingStreak: number;
  /** Count of SIMULATED trades (actionable rows), excludes non-simulated rows. */
  readonly tradeCount: number;
  /** Sum of horizons of simulated trades (a proxy for days in market). */
  readonly timeInMarketDays: number;
  /** Share of simulated trades that resolved `ambiguous` (R4.4). */
  readonly ambiguousShare: number;
  /** Share of simulated trades that `expired` (R4.4). */
  readonly expiredShare: number;
}

/**
 * A row is a SIMULATED trade iff it actually took a position: it fired, is
 * directional, has an entry fill (`entryPrice !== 0`), and a definite win/loss
 * side OR a reported ambiguity. Non-simulated placeholder rows (suppressed /
 * no-entry) are kept in the ledger for selection-rule evaluation but are NOT
 * counted as trades in the profitability summary.
 */
function isSimulated(row: TradeLedgerRow): boolean {
  return row.fired && row.direction !== "FLAT" && row.entryDate !== row.decisionDate;
}

/** A decided win/loss row (ambiguous and expired-flat are neither). */
function isWin(row: TradeLedgerRow): boolean {
  return isSimulated(row) && row.outcome !== "ambiguous" && row.netPips > 0;
}
function isLoss(row: TradeLedgerRow): boolean {
  return isSimulated(row) && row.outcome !== "ambiguous" && row.netPips < 0;
}

/** Longest run of consecutive losing simulated trades, in ledger order. */
function longestLosingStreak(rows: readonly TradeLedgerRow[]): number {
  let longest = 0;
  let current = 0;
  for (const row of rows) {
    if (!isSimulated(row)) continue;
    if (isLoss(row)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** Max peak-to-trough drawdown of the cumulative net-pip curve over simulated trades. */
function maxDrawdownPips(rows: readonly TradeLedgerRow[]): number {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const row of rows) {
    if (!isSimulated(row)) continue;
    equity += row.netPips;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return maxDd;
}

/**
 * Summarise a set of ledger rows into a {@link PerformanceSummary}. All metrics
 * derive solely from these rows (R3.4). Only SIMULATED trades contribute to the
 * trade statistics; `ambiguous`/`expired` shares are over the simulated set.
 */
export function summarize(
  rows: readonly TradeLedgerRow[],
  strategyId = "system",
): PerformanceSummary {
  const simulated = rows.filter(isSimulated);
  const n = simulated.length;

  if (n === 0) {
    return {
      strategyId,
      netExpectancyPips: 0,
      netExpectancyR: 0,
      grossExpectancyPips: 0,
      winRate: 0,
      avgWinPips: 0,
      avgLossPips: 0,
      profitFactor: 0,
      maxDrawdownPips: 0,
      longestLosingStreak: 0,
      tradeCount: 0,
      timeInMarketDays: 0,
      ambiguousShare: 0,
      expiredShare: 0,
    };
  }

  const wins = simulated.filter(isWin);
  const losses = simulated.filter(isLoss);
  const ambiguous = simulated.filter((r) => r.outcome === "ambiguous");
  const expired = simulated.filter((r) => r.outcome === "expired");

  const sumNet = simulated.reduce((s, r) => s + r.netPips, 0);
  const sumGross = simulated.reduce((s, r) => s + r.grossPips, 0);
  const rRows = simulated.filter((r) => r.rMultiple !== null);
  const sumR = rRows.reduce((s, r) => s + (r.rMultiple ?? 0), 0);

  const sumWinPips = wins.reduce((s, r) => s + r.netPips, 0);
  const sumLossPips = losses.reduce((s, r) => s + r.netPips, 0); // ≤ 0
  const grossProfit = sumWinPips;
  const grossLoss = Math.abs(sumLossPips);

  return {
    strategyId,
    netExpectancyPips: sumNet / n,
    netExpectancyR: rRows.length > 0 ? sumR / rRows.length : 0,
    grossExpectancyPips: sumGross / n,
    winRate: wins.length / n,
    avgWinPips: wins.length > 0 ? sumWinPips / wins.length : 0,
    avgLossPips: losses.length > 0 ? sumLossPips / losses.length : 0,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdownPips: maxDrawdownPips(rows),
    longestLosingStreak: longestLosingStreak(rows),
    tradeCount: n,
    timeInMarketDays: simulated.reduce((s, r) => s + r.horizon, 0),
    ambiguousShare: ambiguous.length / n,
    expiredShare: expired.length / n,
  };
}

/** The confidence-band key an earned-confidence value falls into (0.05-wide). */
function confidenceBand(confidence: number): string {
  const lo = Math.floor(confidence * 20) / 20; // 0.05 buckets
  const hi = lo + 0.05;
  return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
}

/** Per-slice performance breakdowns (R4.3). Each value is a full summary. */
export interface SliceBreakdown {
  readonly byPair: Readonly<Record<string, PerformanceSummary>>;
  readonly byHorizon: Readonly<Record<string, PerformanceSummary>>;
  readonly byDirection: Readonly<Record<string, PerformanceSummary>>;
  readonly byConfidenceBand: Readonly<Record<string, PerformanceSummary>>;
}

function groupSummaries(
  rows: readonly TradeLedgerRow[],
  key: (row: TradeLedgerRow) => string,
  strategyId: string,
): Record<string, PerformanceSummary> {
  const groups = new Map<string, TradeLedgerRow[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = groups.get(k);
    if (bucket) bucket.push(row);
    else groups.set(k, [row]);
  }
  const out: Record<string, PerformanceSummary> = {};
  for (const [k, bucket] of groups) out[k] = summarize(bucket, strategyId);
  return out;
}

/** Break a ledger down by pair, horizon, direction, and confidence band (R4.3). */
export function summarizeBySlice(
  rows: readonly TradeLedgerRow[],
  strategyId = "system",
): SliceBreakdown {
  return {
    byPair: groupSummaries(rows, (r) => r.pair, strategyId),
    byHorizon: groupSummaries(rows, (r) => String(r.horizon), strategyId),
    byDirection: groupSummaries(rows, (r) => r.direction, strategyId),
    byConfidenceBand: groupSummaries(rows, (r) => confidenceBand(r.earnedConfidence), strategyId),
  };
}
