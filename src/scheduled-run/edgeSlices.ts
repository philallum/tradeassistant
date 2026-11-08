// v4 snapshot evidence slices — trader-edge-validation Stage F (task 15; R8.1, R9.1, R10).
//
// Builds the additive `tradeLedgerSummary`, `calibration`, `exposure`,
// `provenance` and `validationStatus` slices from the DETERMINISTIC artifacts
// (performance/metrics, performance/calibration, exposure/aggregateExposure,
// provenance/signalProvenance) for the daily run's `dashboard.json`.
//
// FAIL-SAFE: each slice is computed independently inside its own try/catch; a
// slice that fails degrades to its empty default with a secret-free log, so the
// run still publishes `dashboard.json`. Read-only and LLM-free: nothing here
// feeds firing, scoring, or the persisted rows — only the output artifact grows.

import type { DashboardView } from "../dashboard/index.js";
import type { PairEvaluation } from "../dashboard/index.js";
import type { FiringSetupRow } from "../dashboard/persistFiringSetups.js";
import { aggregateExposure } from "../exposure/aggregateExposure.js";
import type { CandleStore } from "../ingestion/types.js";
import { calibrate } from "../performance/calibration.js";
import { summarize, type PerformanceSummary } from "../performance/metrics.js";
import { deriveSignalProvenance } from "../provenance/signalProvenance.js";
import type { TradeLedgerStore } from "../trade-ledger/types.js";
import {
  EMPTY_CALIBRATION,
  EMPTY_EXPOSURE,
  EMPTY_TRADE_LEDGER_SUMMARY,
  type SnapshotEdgeSlices,
  type SnapshotPerformanceSummary,
  type SnapshotTradeLedgerSummary,
  type SnapshotValidationStatus,
} from "./snapshot.js";
import { HISTORY_WINDOW_DAYS, windowStartDate } from "./snapshotHistory.js";
import { warnEvent } from "./warn.js";

/** The system's Strategy_Source id in the ledger. */
const SYSTEM_STRATEGY_ID = "system";

/** Collaborators for {@link buildEdgeSlices}; all read-only. */
export interface EdgeSliceDeps {
  readonly view: DashboardView;
  readonly evaluations: readonly PairEvaluation[];
  /** Trade_Ledger port (the Supabase adapter reads fail-safe). Omitted → empty ledger slices. */
  readonly ledgerStore?: TradeLedgerStore;
  /** Candle coverage for provenance. Omitted → empty provenance. */
  readonly candleStore?: CandleStore;
  /** Injected run clock for provenance `computedAt`. */
  readonly now?: Date;
  /** Secret-free warning sink (defaults to structured `console.warn`). */
  readonly warn?: (slice: string, err: unknown) => void;
}

function defaultWarn(slice: string, err: unknown): void {
  warnEvent("scheduled_run.edge_slice_failed", { slice }, err);
}

/** Wire form of a summary: JSON has no Infinity, so an infinite profit factor is `null`. */
function toWireSummary(s: PerformanceSummary): SnapshotPerformanceSummary {
  return { ...s, profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null };
}

/**
 * Conservative per-forecast validation flag. `validated` ONLY when the ledger
 * shows the system with simulated trades, a positive net-of-cost expectancy, and
 * a strictly higher net expectancy than every comparator. Anything else —
 * including an empty/failed ledger — is `unvalidated` (R10.3, R1.7).
 */
export function deriveValidationStatus(
  summary: SnapshotTradeLedgerSummary,
): SnapshotValidationStatus {
  const system = summary.strategies.find((s) => s.role === "system")?.summary;
  if (system === undefined || system.tradeCount === 0 || !(system.netExpectancyPips > 0)) {
    return "unvalidated";
  }
  const beatsAll = summary.strategies
    .filter((s) => s.role === "comparator")
    .every((c) => c.summary.netExpectancyPips < system.netExpectancyPips);
  return beatsAll ? "validated" : "unvalidated";
}

/**
 * Compute every v4 slice for the run. Never throws: a failing slice is replaced
 * by its empty default and logged secret-free.
 */
export async function buildEdgeSlices(deps: EdgeSliceDeps): Promise<SnapshotEdgeSlices> {
  const warn = deps.warn ?? defaultWarn;
  const decisionDate = deps.view.decisionDate;

  // Ledger-derived slices share ONE read of the window.
  let tradeLedgerSummary = EMPTY_TRADE_LEDGER_SUMMARY;
  let calibration = EMPTY_CALIBRATION;
  try {
    if (deps.ledgerStore !== undefined) {
      const from = windowStartDate(decisionDate, HISTORY_WINDOW_DAYS);
      const rows = await deps.ledgerStore.getByWindow(from, decisionDate);
      if (rows.length > 0) {
        const ids = [...new Set(rows.map((r) => r.strategyId))].sort();
        const ordered = [
          ...ids.filter((id) => id === SYSTEM_STRATEGY_ID),
          ...ids.filter((id) => id !== SYSTEM_STRATEGY_ID),
        ];
        tradeLedgerSummary = {
          window: { from, to: decisionDate },
          strategies: ordered.map((id) => ({
            role: id === SYSTEM_STRATEGY_ID ? ("system" as const) : ("comparator" as const),
            summary: toWireSummary(
              summarize(rows.filter((r) => r.strategyId === id), id),
            ),
          })),
        };
        try {
          const report = calibrate(rows.filter((r) => r.strategyId === SYSTEM_STRATEGY_ID));
          calibration = {
            bands: report.bands.map((b) => ({ ...b })),
            monotonic: report.monotonic,
            wellCalibrated: report.wellCalibrated,
          };
        } catch (err) {
          warn("calibration", err);
        }
      }
    }
  } catch (err) {
    warn("tradeLedgerSummary", err);
    tradeLedgerSummary = EMPTY_TRADE_LEDGER_SUMMARY;
    calibration = EMPTY_CALIBRATION;
  }

  let exposure = EMPTY_EXPOSURE;
  try {
    const firing: FiringSetupRow[] = deps.view.cards.map((card) => ({
      decisionDate,
      pair: card.pair,
      direction: card.direction,
      horizon: card.horizon,
      earnedConfidence: card.earnedConfidence,
      stopLossPips: card.stopLossPips,
      takeProfitPips: card.takeProfitPips,
      surfaced: true,
      suppressionReason: null,
    }));
    const summary = aggregateExposure(firing);
    exposure = {
      perCurrency: summary.perCurrency.map((c) => ({ ...c })),
      concentrated: summary.concentrated,
      strongestPair: summary.strongestPair,
    };
  } catch (err) {
    warn("exposure", err);
    exposure = EMPTY_EXPOSURE;
  }

  let provenance: NonNullable<SnapshotEdgeSlices["provenance"]> = [];
  try {
    if (deps.candleStore !== undefined) {
      const candleStore = deps.candleStore;
      const computedAt = deps.now ?? new Date();
      provenance = await Promise.all(
        deps.evaluations.map(async (ev) => {
          const p = await deriveSignalProvenance({
            pair: ev.pair,
            decisionDate,
            horizonDays: ev.horizon,
            computedAt,
            candleStore,
          });
          return {
            decision_date: decisionDate,
            pair: p.pair,
            lastCandleTimestamp: p.lastCandleTimestamp,
            computedAt: p.computedAt,
            earliestEntryRef: p.earliestEntryRef,
            horizonStart: p.horizonStart,
            horizonEnd: p.horizonEnd,
            dataComplete: p.dataComplete,
            staleReason: p.staleReason,
          };
        }),
      );
    }
  } catch (err) {
    warn("provenance", err);
    provenance = [];
  }

  const status = deriveValidationStatus(tradeLedgerSummary);
  const validationStatus = deps.evaluations.map((ev) => ({
    decision_date: decisionDate,
    pair: ev.pair,
    status,
  }));

  return { tradeLedgerSummary, calibration, exposure, provenance, validationStatus };
}
