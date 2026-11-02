/**
 * Pure shaper for the net-of-cost evaluation view (trader-edge-validation R10.2, R10.3).
 *
 * Leads with the system's out-of-sample Net_Expectancy, drawdown, profit factor and trade
 * count (all AFTER costs), places each comparator beside it under the identical assumptions
 * the writer used, and states whether the sample is large enough to conclude anything.
 *
 * Pure: no fetch, DOM, clock, or core import. Presentation only; it recomputes no metric —
 * it selects, compares and flags values already present in the snapshot's v4 slices. A v3
 * snapshot (empty slices) yields `{ kind: "empty" }`.
 *
 * Honesty rules: no single metric (e.g. directional accuracy) is a headline; figures are
 * flagged `validated: false` until the sample is large enough; consistency across time is
 * reported as "not measured" because the snapshot carries no per-period breakdown.
 */
import type { Calibration, PerformanceSummaryRow, TradeLedgerSummary } from "../api/types";

/**
 * Minimum trade count before a net result is treated as a conclusion rather than an
 * anecdote. A presentation rule of thumb, not a tunable signal parameter (R12.2).
 */
export const MIN_SAMPLE_TRADES = 30;

/** A comparator's result next to the system, on identical assumptions. */
export interface ComparatorVM {
  readonly strategyId: string;
  readonly summary: PerformanceSummaryRow;
  /** System net expectancy minus this comparator's, in pips. */
  readonly systemMinusComparatorPips: number;
  /** True when the system's net expectancy is strictly higher than this comparator's. */
  readonly systemBeats: boolean;
}

export interface SampleAdequacyVM {
  readonly tradeCount: number;
  readonly minRequired: number;
  readonly sufficient: boolean;
}

export interface CalibrationVM {
  readonly measured: boolean;
  readonly monotonic: boolean | null;
  readonly wellCalibrated: boolean | null;
  readonly bandCount: number;
}

export interface EvaluationNetVM {
  readonly kind: "ready";
  /** The source ledger summary, so the view can show its date range verbatim. */
  readonly ledger: TradeLedgerSummary;
  readonly system: PerformanceSummaryRow;
  /** False until the sample is large enough; drives the explicit un-validated label. */
  readonly validated: boolean;
  readonly sample: SampleAdequacyVM;
  /** Consistency across time periods: the snapshot has no per-period slice. */
  readonly timeConsistency: { readonly measured: false };
  readonly comparators: readonly ComparatorVM[];
  /** null when there are no comparators with trades to compare against. */
  readonly beatsAllComparators: boolean | null;
  readonly calibration: CalibrationVM;
}

export type EvaluationNetShape = { readonly kind: "empty" } | EvaluationNetVM;

export interface EvaluationNetInput {
  readonly tradeLedgerSummary: TradeLedgerSummary;
  readonly calibration: Calibration;
}

/** Shape the v4 ledger summary + calibration into the net-of-cost evaluation view model. */
export function shapeEvaluationNet(input: EvaluationNetInput): EvaluationNetShape {
  const { tradeLedgerSummary: ledger, calibration } = input;
  const system = ledger.strategies.find((s) => s.role === "system");
  if (system === undefined) return { kind: "empty" };

  const comparators: ComparatorVM[] = ledger.strategies
    .filter((s) => s.role === "comparator")
    .map((s) => ({
      strategyId: s.summary.strategyId,
      summary: s.summary,
      systemMinusComparatorPips: system.summary.netExpectancyPips - s.summary.netExpectancyPips,
      systemBeats: system.summary.netExpectancyPips > s.summary.netExpectancyPips,
    }));

  const tradeCount = system.summary.tradeCount;
  const sufficient = tradeCount >= MIN_SAMPLE_TRADES;
  const comparable = comparators.filter((c) => c.summary.tradeCount > 0);

  return {
    kind: "ready",
    ledger,
    system: system.summary,
    validated: sufficient,
    sample: { tradeCount, minRequired: MIN_SAMPLE_TRADES, sufficient },
    timeConsistency: { measured: false },
    comparators,
    beatsAllComparators: comparable.length === 0 ? null : comparable.every((c) => c.systemBeats),
    calibration: {
      measured: calibration.bands.length > 0,
      monotonic: calibration.monotonic,
      wellCalibrated: calibration.wellCalibrated,
      bandCount: calibration.bands.length,
    },
  };
}
