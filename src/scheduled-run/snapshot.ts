// Dashboard JSON snapshot writer — the Public_Read_Path producer
// (simplify-to-cloud-minimal Requirements 5.1, 5.2; design Decision 2 / C3).
//
// Under the public-data decision the read-proxy, RLS, scoped read views, and the
// SPA's PostgREST coupling are all removed. Their replacement is a single static
// JSON file — `dashboard.json` — that the Cloud_Run_Job writes at the END of the
// daily run. The hosted SPA fetches that one same-origin static asset (no proxy,
// no auth gate). This module turns the already-produced deterministic view plus
// the (optional) display-only writes and history slices into that snapshot and
// writes it fail-safely.
//
// FAIL-SAFE (Requirement 5.2, design Error Handling): the persisted DB rows are
// the source of truth. A failed snapshot write is logged and SWALLOWED — it must
// NEVER corrupt the persisted rows nor fail the run. The next run overwrites the
// snapshot; if it is missing the SPA shows an explicit empty/unavailable state
// (Requirement 5.5), so a stale-or-absent snapshot degrades gracefully.
//
// This module imports NOTHING that performs the DB write and holds no secret: it
// is a pure serialiser plus a thin, injectable write seam. The wire-format row
// shapes below are an INDEPENDENT structural copy of the SPA's wire types
// (`web/src/api/types.ts`); the core never imports from `web/` and vice versa,
// exactly as the two allowlists used to be kept in lockstep by hand.

import type { DashboardView } from "../dashboard/index.js";
import type {
  DisplayOnlyWrite,
  ReferenceComparisonWrite,
  SignalRationaleWrite,
} from "../storage/supabase/index.js";

/** The schema version of the snapshot envelope, bumped if the shape changes. */
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** The canonical file name the SPA fetches as a same-origin static asset. */
export const SNAPSHOT_FILE_NAME = "dashboard.json" as const;

// ---------------------------------------------------------------------------------------
// Wire-format row shapes (structural copy of web/src/api/types.ts)
// ---------------------------------------------------------------------------------------

/** Firing direction class as persisted on `firing_setups`. */
export type SnapshotDirection = "UP" | "DOWN" | "FLAT";

/** Prediction horizon (days) — bounded small-int domain. */
export type SnapshotHorizon = 1 | 2 | 3;

/** The suppression reasons that survive the de-scope (`below_floor`, `not_fired`). */
export type SnapshotSuppressionReason = "below_floor" | "not_fired";

/** A surfaced-or-suppressed firing-setup row (mirrors `firing_setups`). */
export interface SnapshotFiringSetupRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly strategy_id: string;
  readonly direction: SnapshotDirection;
  readonly horizon: SnapshotHorizon;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly surfaced: boolean;
  readonly suppression_reason: SnapshotSuppressionReason | null;
}

/** A matured analogue-outcome row (excursion profile). */
export interface SnapshotAnalogueOutcomeRow {
  readonly asset: string;
  readonly decision_date: string;
  readonly horizon: SnapshotHorizon;
  readonly direction: SnapshotDirection;
  readonly mfe_pips: number;
  readonly mae_pips: number;
  readonly matured: boolean;
}

/** A prediction-versus-actual realized-outcome row. */
export interface SnapshotRealizedOutcomeRow {
  readonly strategy_id: string;
  readonly pair: string;
  readonly decision_date: string;
  readonly predicted_direction: SnapshotDirection;
  readonly horizon: SnapshotHorizon;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly realized_direction: SnapshotDirection | null;
  readonly realized_mfe_pips: number | null;
  readonly realized_mae_pips: number | null;
  readonly matured: boolean;
}

/** A price (OHLC) candle row. */
export interface SnapshotCandleRow {
  readonly asset: string;
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** A single advisory research proposal (display-only). */
export interface SnapshotProposal {
  readonly proposalId: string;
  readonly kind: string;
  readonly proposalText: string;
}

/** An AI rationale row (display-only, advisory, non-scoring). */
export interface SnapshotAiRationaleRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly rationale_text: string;
  readonly analogue_labels: readonly string[];
  /** Advisory proposals; the daily-run display path emits none, so typically empty. */
  readonly proposals: readonly SnapshotProposal[];
}

/** A third-party external-reference comparison row (display-only, research-only). */
export interface SnapshotExternalComparisonRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly own_direction: SnapshotDirection | null;
  readonly reference_direction: "BUY" | "SELL" | "HOLD" | null;
  readonly reference_score: number | null;
  readonly provider: string | null;
  readonly comparison: "agree" | "diverge" | "neutral" | "unavailable";
}

/**
 * An evaluation-report summary row (the human-read measurement, no verdict).
 * This is the "evaluation summary" slice of the snapshot (design Decision 2);
 * the Measurement_Engine's report, carrying NO PASS/CUT field (Requirement 1.3).
 */
export interface SnapshotEvaluationReportRow {
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
 * The complete `dashboard.json` envelope the SPA fetches. Every field is a
 * read-only array of wire-format rows plus the Decision_Date the run was for and
 * a generation timestamp (the SPA's freshness marker). An absent slice is an
 * empty array, never `undefined`, so the SPA can render an explicit empty state
 * without guarding for missing keys (Requirement 5.5).
 */
export interface DashboardSnapshot {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** The Decision_Date this snapshot was generated for. */
  readonly decisionDate: string;
  /** ISO timestamp the snapshot was generated (freshness marker). */
  readonly generatedAt: string;
  /** Every Decision_Date with persisted data, newest-last (drives the browse selector). */
  readonly decisionDates: readonly string[];
  readonly firingSetups: readonly SnapshotFiringSetupRow[];
  readonly analogueOutcomes: readonly SnapshotAnalogueOutcomeRow[];
  readonly realizedOutcomes: readonly SnapshotRealizedOutcomeRow[];
  readonly candles: readonly SnapshotCandleRow[];
  readonly aiRationale: readonly SnapshotAiRationaleRow[];
  readonly externalComparison: readonly SnapshotExternalComparisonRow[];
  readonly evaluationReports: readonly SnapshotEvaluationReportRow[];
}

/** The v1 deterministic system Strategy_Source (schema default 'system'). */
const SYSTEM_STRATEGY_ID = "system";

/**
 * History slices the daily run has already loaded/computed and wants carried in
 * the snapshot. All optional: an omitted slice becomes an empty array so a run
 * that cannot (yet) supply history still writes a valid, renderable snapshot.
 */
export interface SnapshotHistory {
  readonly decisionDates?: readonly string[];
  readonly analogueOutcomes?: readonly SnapshotAnalogueOutcomeRow[];
  readonly realizedOutcomes?: readonly SnapshotRealizedOutcomeRow[];
  readonly candles?: readonly SnapshotCandleRow[];
  readonly evaluationReports?: readonly SnapshotEvaluationReportRow[];
}

/** Map a produced firing card into a surfaced wire-format `firing_setups` row. */
function firingSetupRow(decisionDate: string, card: DashboardView["cards"][number]): SnapshotFiringSetupRow {
  return {
    decision_date: decisionDate,
    pair: card.pair,
    strategy_id: SYSTEM_STRATEGY_ID,
    direction: card.direction,
    horizon: card.horizon,
    earned_confidence: card.earnedConfidence,
    stop_loss_pips: card.stopLossPips,
    take_profit_pips: card.takeProfitPips,
    surfaced: true,
    suppression_reason: null,
  };
}

/** Map a display-only rationale write into a wire-format AI rationale row. */
function aiRationaleRow(decisionDate: string, write: SignalRationaleWrite): SnapshotAiRationaleRow {
  return {
    decision_date: decisionDate,
    pair: write.pair,
    // `rationale`/`analogueLabels` are `LlmTagged<…>` at the write boundary;
    // unwrap `.value` to the plain display strings exactly as the DB write
    // boundary does (display-only, never re-entering scoring).
    rationale_text: write.rationale.value,
    analogue_labels: [...write.analogueLabels.value],
    // The daily-run display path does not generate research proposals; the slice
    // is present (empty) so the SPA renders without guarding for a missing key.
    proposals: [],
  };
}

/** Map a display-only comparison write into a wire-format external-comparison row. */
function externalComparisonRow(
  decisionDate: string,
  write: ReferenceComparisonWrite,
): SnapshotExternalComparisonRow {
  const reference = write.reference;
  return {
    decision_date: decisionDate,
    pair: write.pair,
    own_direction: write.ownDirection,
    reference_direction: reference?.direction ?? null,
    reference_score: reference?.score ?? null,
    provider: reference?.provider ?? null,
    comparison: write.comparison,
  };
}

/**
 * Build the complete {@link DashboardSnapshot} for a Decision_Date from the
 * produced dashboard view, the optional display-only writes, and any history
 * slices the run supplied. Pure and deterministic given its inputs (plus the
 * injected `now` for the freshness marker), so it is unit-testable without I/O.
 *
 * @param view        The produced dashboard view (the firing cards).
 * @param displayOnly The display-only writes (AI rationale + external comparison), if any.
 * @param history     History slices already loaded by the run, if any.
 * @param now         Injected clock for the freshness marker (defaults to `new Date()`).
 */
export function buildDashboardSnapshot(
  view: DashboardView,
  displayOnly: DisplayOnlyWrite | undefined,
  history: SnapshotHistory = {},
  now: Date = new Date(),
): DashboardSnapshot {
  const decisionDate = view.decisionDate;
  const firingSetups = view.cards.map((card) => firingSetupRow(decisionDate, card));
  const aiRationale = (displayOnly?.rationales ?? []).map((w) =>
    aiRationaleRow(decisionDate, w),
  );
  const externalComparison = (displayOnly?.comparisons ?? []).map((w) =>
    externalComparisonRow(decisionDate, w),
  );

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    decisionDate,
    generatedAt: now.toISOString(),
    decisionDates: history.decisionDates ?? [],
    firingSetups,
    analogueOutcomes: history.analogueOutcomes ?? [],
    realizedOutcomes: history.realizedOutcomes ?? [],
    candles: history.candles ?? [],
    aiRationale,
    externalComparison,
    evaluationReports: history.evaluationReports ?? [],
  };
}

/**
 * Serialise a snapshot to the exact JSON text written to `dashboard.json`.
 * Stable 2-space indentation keeps the hosted asset diffable; the SPA parses it
 * with a plain `JSON.parse`.
 */
export function serializeSnapshot(snapshot: DashboardSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * The injectable sink that persists the serialised snapshot JSON to its public
 * destination (Firebase Hosting / a public bucket). It receives the file name
 * and the already-serialised body; the concrete uploader is wired by the caller
 * so this module stays I/O-free and testable. It may reject on failure — the
 * fail-safe wrapper {@link writeDashboardSnapshot} swallows the rejection.
 */
export type SnapshotSink = (fileName: string, body: string) => Promise<void>;

/**
 * Fail-safely write the dashboard snapshot through the injected sink
 * (Requirement 5.2, design Error Handling).
 *
 * The write is best-effort: on ANY sink failure the error is logged
 * (secret-free) and SWALLOWED, returning `false`, so the snapshot step can never
 * corrupt the persisted DB rows (the source of truth) nor fail the daily run.
 * Returns `true` iff the snapshot was written. A `null`/absent sink is treated
 * as "no destination configured" and is a logged no-op (also `false`), so a run
 * without a hosting target still completes cleanly.
 *
 * @param snapshot The snapshot to write.
 * @param sink     The destination sink, or `undefined` when none is configured.
 */
export async function writeDashboardSnapshot(
  snapshot: DashboardSnapshot,
  sink: SnapshotSink | undefined,
): Promise<boolean> {
  if (sink === undefined) {
    console.warn(
      JSON.stringify({
        event: "scheduled_run.snapshot_skipped",
        reason: "no_sink_configured",
        decisionDate: snapshot.decisionDate,
      }),
    );
    return false;
  }

  try {
    await sink(SNAPSHOT_FILE_NAME, serializeSnapshot(snapshot));
    console.log(
      JSON.stringify({
        event: "scheduled_run.snapshot_written",
        decisionDate: snapshot.decisionDate,
        firingCards: snapshot.firingSetups.length,
      }),
    );
    return true;
  } catch (err) {
    // Fail-safe: a snapshot write failure NEVER corrupts the persisted rows and
    // never fails the run. Log a secret-free warning and move on; the next run
    // overwrites the snapshot (design Error Handling, Requirement 5.2, 5.5).
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "scheduled_run.snapshot_write_failed",
        decisionDate: snapshot.decisionDate,
        message,
      }),
    );
    return false;
  }
}
