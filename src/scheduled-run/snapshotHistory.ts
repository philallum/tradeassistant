// Snapshot HISTORY loader — fills the `dashboard.json` slices the SPA browses
// (daily-run dashboard-data). The daily run previously carried ONLY the current
// Decision_Date's firing view, so every other snapshot slice
// (firingSetups across dates, decisionDates, analogueOutcomes, realizedOutcomes,
// candles, evaluationReports) was empty and the dashboard tabs rendered their
// explicit empty state. This module reads those slices back from the persisted
// source-of-truth rows so `buildDashboardSnapshot` can carry real history.
//
// READ-ONLY: it issues ONLY GET selects through the injected
// `SupabaseRestClient`. It mutates nothing and touches no decision/scoring path,
// so it cannot affect the Measurement_Engine or introduce look-ahead (the rows
// it reads are already-persisted outcomes).
//
// FAIL-SAFE: every slice is loaded independently inside its own try/catch. A
// slice that fails to load degrades to an empty array (logged secret-free) and
// never throws, so a transient read error can never fail the daily run nor
// corrupt the snapshot — consistent with the fail-safe snapshot write.
//
// BOUNDED: `candles` and `analogue_outcomes` are large (tens of thousands of
// rows). The price/excursion charts only need a recent per-pair window, so those
// two slices are bounded by a cutoff date to keep `dashboard.json` small. All
// other slices (firing setups, realized outcomes, evaluation reports) are small
// and loaded in full.

import type { SupabaseRestClient } from "../storage/supabase/index.js";
import type {
  SnapshotAnalogueOutcomeRow,
  SnapshotCandleRow,
  SnapshotEvaluationReportRow,
  SnapshotFiringSetupRow,
  SnapshotHistory,
  SnapshotRealizedOutcomeRow,
} from "./snapshot.js";
import { warnEvent } from "./warn.js";

/** How many days of candles/analogue history to carry per pair (recent window). */
export const HISTORY_WINDOW_DAYS = 400 as const;

/** Options for {@link loadSnapshotHistory}. */
export interface SnapshotHistoryOptions {
  /** The run's Decision_Date (`YYYY-MM-DD`); the window is measured back from here. */
  readonly decisionDate: string;
  /** Days of candle/analogue history to carry per pair. Defaults to {@link HISTORY_WINDOW_DAYS}. */
  readonly windowDays?: number;
}

/** Secret-free structured warning for a slice that failed to load. */
function warnSlice(slice: string, err: unknown): void {
  warnEvent("scheduled_run.snapshot_history_slice_failed", { slice }, err);
}

/** Run `load`, returning `fallback` (and logging) on any failure — never throws. */
async function safeSlice<T>(
  slice: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    warnSlice(slice, err);
    return fallback;
  }
}

/** Compute the inclusive lower-bound date `windowDays` before `decisionDate` (UTC). */
export function windowStartDate(decisionDate: string, windowDays: number): string {
  const start = new Date(`${decisionDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - windowDays);
  return start.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------
// DB row shapes (snake_case, exactly as persisted) → snapshot wire rows.
// ---------------------------------------------------------------------------------------

interface DbFiringSetupRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly strategy_id: string;
  readonly direction: string;
  readonly horizon: number;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly surfaced: boolean;
  readonly suppression_reason: string | null;
}

interface DbRealizedOutcomeRow {
  readonly strategy_id: string;
  readonly pair: string;
  readonly decision_date: string;
  readonly predicted_direction: string;
  readonly horizon: number;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly realized_direction: string | null;
  readonly realized_mfe_pips: number | null;
  readonly realized_mae_pips: number | null;
  readonly matured: boolean;
}

interface DbAnalogueOutcomeRow {
  readonly asset: string;
  readonly decision_date: string;
  readonly horizon: number;
  readonly direction: string;
  readonly mfe_pips: number;
  readonly mae_pips: number;
  readonly matured: boolean;
}

interface DbCandleRow {
  readonly asset: string;
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

interface DbEvaluationReportRow {
  readonly config_id: string;
  readonly split_test_start: string;
  readonly split_test_end: string;
  readonly sample_size: number;
  readonly predictions_count: number;
  readonly model_accuracy: number;
  readonly baseline_accuracy: number;
  readonly delta_vs_baseline: number;
}

/**
 * Load the history slices for a Decision_Date from the persisted rows, read-only
 * and fail-safe. The returned {@link SnapshotHistory} is handed straight to
 * `buildDashboardSnapshot` (which merges today's firing view on top). An
 * individual slice that fails to load is an empty array, so the snapshot is
 * always well-formed and the run never breaks.
 */
export async function loadSnapshotHistory(
  client: SupabaseRestClient,
  options: SnapshotHistoryOptions,
): Promise<SnapshotHistory> {
  const windowDays = options.windowDays ?? HISTORY_WINDOW_DAYS;
  const cutoff = windowStartDate(options.decisionDate, windowDays);

  // All firing setups across every Decision_Date (small table) — drives the
  // Setups tab's date browser and the Pattern-Outcomes confidence trend.
  const firingSetups = await safeSlice<readonly SnapshotFiringSetupRow[]>(
    "firing_setups",
    async () => {
      const rows = await client.select<DbFiringSetupRow>(
        "firing_setups",
        "select=decision_date,pair,strategy_id,direction,horizon,earned_confidence,stop_loss_pips,take_profit_pips,surfaced,suppression_reason&order=decision_date.asc,pair.asc",
      );
      return rows.map(
        (r): SnapshotFiringSetupRow => ({
          decision_date: r.decision_date,
          pair: r.pair,
          strategy_id: r.strategy_id,
          direction: r.direction as SnapshotFiringSetupRow["direction"],
          horizon: r.horizon as SnapshotFiringSetupRow["horizon"],
          earned_confidence: r.earned_confidence,
          stop_loss_pips: r.stop_loss_pips,
          take_profit_pips: r.take_profit_pips,
          surfaced: r.surfaced,
          suppression_reason:
            r.suppression_reason as SnapshotFiringSetupRow["suppression_reason"],
        }),
      );
    },
    [],
  );

  // Every realized-outcome row (small table) — prediction-vs-actual.
  const realizedOutcomes = await safeSlice<readonly SnapshotRealizedOutcomeRow[]>(
    "realized_outcomes",
    async () => {
      const rows = await client.select<DbRealizedOutcomeRow>(
        "realized_outcomes",
        "select=strategy_id,pair,decision_date,predicted_direction,horizon,earned_confidence,stop_loss_pips,take_profit_pips,realized_direction,realized_mfe_pips,realized_mae_pips,matured&order=decision_date.asc,pair.asc",
      );
      return rows.map(
        (r): SnapshotRealizedOutcomeRow => ({
          strategy_id: r.strategy_id,
          pair: r.pair,
          decision_date: r.decision_date,
          predicted_direction: r.predicted_direction as SnapshotRealizedOutcomeRow["predicted_direction"],
          horizon: r.horizon as SnapshotRealizedOutcomeRow["horizon"],
          earned_confidence: r.earned_confidence,
          stop_loss_pips: r.stop_loss_pips,
          take_profit_pips: r.take_profit_pips,
          realized_direction:
            r.realized_direction as SnapshotRealizedOutcomeRow["realized_direction"],
          realized_mfe_pips: r.realized_mfe_pips,
          realized_mae_pips: r.realized_mae_pips,
          matured: r.matured,
        }),
      );
    },
    [],
  );

  // Matured analogue outcomes within the recent window (bounded) — excursion profile.
  const analogueOutcomes = await safeSlice<readonly SnapshotAnalogueOutcomeRow[]>(
    "analogue_outcomes",
    async () => {
      const rows = await client.select<DbAnalogueOutcomeRow>(
        "analogue_outcomes",
        `select=asset,decision_date,horizon,direction,mfe_pips,mae_pips,matured&matured=is.true&decision_date=gte.${encodeURIComponent(cutoff)}&order=decision_date.asc,asset.asc,horizon.asc`,
      );
      return rows.map(
        (r): SnapshotAnalogueOutcomeRow => ({
          asset: r.asset,
          decision_date: r.decision_date,
          horizon: r.horizon as SnapshotAnalogueOutcomeRow["horizon"],
          direction: r.direction as SnapshotAnalogueOutcomeRow["direction"],
          mfe_pips: r.mfe_pips,
          mae_pips: r.mae_pips,
          matured: r.matured,
        }),
      );
    },
    [],
  );

  // Candles within the recent window (bounded) — the OHLC price chart.
  const candles = await safeSlice<readonly SnapshotCandleRow[]>(
    "candles",
    async () => {
      const rows = await client.select<DbCandleRow>(
        "candles",
        `select=asset,date,open,high,low,close&date=gte.${encodeURIComponent(cutoff)}&order=asset.asc,date.asc`,
      );
      return rows.map(
        (r): SnapshotCandleRow => ({
          asset: r.asset,
          date: r.date,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
        }),
      );
    },
    [],
  );

  // Evaluation reports (small table, cross-config) — the Gate/Evaluation tab.
  const evaluationReports = await safeSlice<readonly SnapshotEvaluationReportRow[]>(
    "evaluation_reports",
    async () => {
      const rows = await client.select<DbEvaluationReportRow>(
        "evaluation_reports",
        "select=config_id,split_test_start,split_test_end,sample_size,predictions_count,model_accuracy,baseline_accuracy,delta_vs_baseline&order=split_test_end.asc",
      );
      return rows.map(
        (r): SnapshotEvaluationReportRow => ({
          config_id: r.config_id,
          split_test_start: r.split_test_start,
          split_test_end: r.split_test_end,
          sample_size: r.sample_size,
          predictions_count: r.predictions_count,
          model_accuracy: r.model_accuracy,
          baseline_accuracy: r.baseline_accuracy,
          delta_vs_baseline: r.delta_vs_baseline,
        }),
      );
    },
    [],
  );

  // Decision_Dates with persisted firing data, deduped + ascending. Derived from
  // the firing-setups slice so it never disagrees with the browsable rows; the
  // snapshot builder additionally unions today's Decision_Date in.
  const decisionDates = Array.from(
    new Set(firingSetups.map((r) => r.decision_date)),
  ).sort();

  return {
    decisionDates,
    firingSetups,
    analogueOutcomes,
    realizedOutcomes,
    candles,
    evaluationReports,
  };
}
