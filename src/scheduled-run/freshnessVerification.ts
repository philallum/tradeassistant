// Freshness verification — Design Component 8 (Requirements 6.1, 6.2, 6.3).
//
// A READ-ONLY check that proves the Candle_Freshness_Stage actually feeds the
// dashboard and future evaluations. It performs NO write, touches NO decision
// path, and does NOT reach into the recorded Evaluation_Report path or the
// Measurement_Engine (R6.3). It only READS:
//
//   1. The per-pair latest stored candle date (via
//      `candleStore.getCoverageSummary()`), compared against
//      `mostRecentCompletedTradingDay(decisionDate)` (R6.2). A pair is "fresh"
//      when its latest stored date equals (or is at/after) the target —
//      "modulo provider availability", a residual gap is reported, not an error.
//
//   2. The published `dashboard.json` snapshot's `decisionDate`, confirming it
//      reflects a run whose history includes the most recent
//      Completed_Trading_Day (R6.1): the snapshot's Decision_Date must be at or
//      after the verification's Decision_Date (a run computed over fresh
//      history), i.e. the snapshot is not stale relative to the target.
//
// The helper is fully injectable (a `CandleStore`, a provided snapshot object,
// and the Decision_Date) so tests need NO network and NO filesystem. It never
// mutates its inputs — the `candleStore` is only queried, the snapshot is only
// read.

import { compareTradingDates } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import type { CandleStore, Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

/** The minimal, read-only shape of a snapshot this check inspects. */
export interface VerifiableSnapshot {
  /** The Decision_Date the snapshot was generated for. */
  readonly decisionDate: TradingDate;
}

/** Injectable collaborators so the check is unit-testable with no I/O. */
export interface FreshnessVerificationDeps {
  readonly decisionDate: TradingDate;
  /** READ-ONLY: only `getCoverageSummary` / `getCandles` are queried. */
  readonly candleStore: CandleStore;
  /** The published snapshot object (already read); only `decisionDate` is used. */
  readonly snapshot: VerifiableSnapshot;
}

/** The per-pair freshness finding (all fields secret-free). */
export interface PairFreshnessResult {
  readonly pair: Pair;
  /** The latest stored candle date for the pair, or `null` when none stored. */
  readonly latestDate: TradingDate | null;
  /** The target (most recent Completed_Trading_Day). */
  readonly target: TradingDate;
  /** True when the latest stored date is at/after the target (fresh). */
  readonly fresh: boolean;
  /** True when the latest stored date is null or strictly before the target. */
  readonly residualGap: boolean;
}

/** The overall read-only verification result. */
export interface FreshnessVerificationResult {
  /** The Decision_Date the check ran for. */
  readonly decisionDate: TradingDate;
  /** The most recent Completed_Trading_Day the stored dates are compared to. */
  readonly target: TradingDate;
  /** Per-pair freshness findings, in {@link PAIRS} order. */
  readonly pairs: readonly PairFreshnessResult[];
  /**
   * True when the snapshot's Decision_Date reflects a run over history that
   * includes the most recent Completed_Trading_Day (R6.1): the snapshot's
   * Decision_Date is at or after the verification's Decision_Date.
   */
  readonly snapshotReflectsFreshHistory: boolean;
  /** The snapshot's Decision_Date (read, never mutated). */
  readonly snapshotDecisionDate: TradingDate;
  /** True when every pair is fresh AND the snapshot reflects fresh history. */
  readonly allFresh: boolean;
}

/**
 * Run the read-only freshness verification. Reads per-pair coverage and the
 * provided snapshot's Decision_Date; performs NO write and mutates nothing.
 *
 * A pair is "fresh" when its latest stored date is at or after the target (the
 * most recent Completed_Trading_Day); otherwise a residual gap is reported
 * (modulo provider availability — a gap is a finding, not an error, R6.2).
 *
 * The snapshot "reflects fresh history" when its Decision_Date is at or after
 * the verification's Decision_Date, so a run computed over the fresh candle
 * history produced the published snapshot (R6.1).
 */
export async function verifyFreshness(
  deps: FreshnessVerificationDeps,
): Promise<FreshnessVerificationResult> {
  const target = mostRecentCompletedTradingDay(deps.decisionDate);

  const coverage = await deps.candleStore.getCoverageSummary();
  const pairs: PairFreshnessResult[] = PAIRS.map((pair) => {
    const latestDate = coverage.find((c) => c.pair === pair)?.latestDate ?? null;
    const fresh = isFresh(latestDate, target);
    return {
      pair,
      latestDate,
      target,
      fresh,
      residualGap: !fresh,
    };
  });

  const snapshotDecisionDate = deps.snapshot.decisionDate;
  const snapshotReflectsFreshHistory =
    compareTradingDates(snapshotDecisionDate, deps.decisionDate) >= 0;

  const allFresh =
    snapshotReflectsFreshHistory && pairs.every((p) => p.fresh);

  return {
    decisionDate: deps.decisionDate,
    target,
    pairs,
    snapshotReflectsFreshHistory,
    snapshotDecisionDate,
    allFresh,
  };
}

/** True when `latestDate` is present and at/after `target`. */
function isFresh(latestDate: TradingDate | null, target: TradingDate): boolean {
  return latestDate !== null && compareTradingDates(latestDate, target) >= 0;
}
