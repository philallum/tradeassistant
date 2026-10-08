// Supabase-backed EvaluationReportStore adapter (simplify-to-cloud-minimal
// Requirement 1.3, 8.2; design C4 / Data Models).
//
// Implements the SAME `EvaluationReportStore` PORT signatures and semantics as
// the in-memory reference `InMemoryEvaluationReportStore` (src/kill-gate/types.ts),
// backed by the `evaluation_reports` schema added in migration
// 20260916000006_evaluation_reports.sql:
//
//   evaluation_reports
//     id uuid pk default gen_random_uuid(), config_id,
//     split_train_end, split_test_start, split_test_end,
//     sample_size, predictions_count,
//     model_accuracy, baseline_accuracy, delta_vs_baseline,
//     friction_adj_model|null, friction_adj_base|null,
//     metrics jsonb, created_at
//     -- NO verdict column (Requirement 8.2)
//
// It is the successor to `SupabaseGateVerdictStore` on the evaluation write
// path and is modelled on it directly: it reaches storage ONLY through the
// injected `SupabaseRestClient`, re-implements NO measurement math
// (`composeEvaluationReport` in src/kill-gate/verdict.ts stays the sole report
// producer), and only maps `EvaluationReport` <-> row and reads back the
// DB-generated id.
//
// Persist (design C4): the row is POSTed via `insertReturning`
// (`Prefer: return=representation`) so the `gen_random_uuid()` id is read back.
// Errors are augmented with the `config_id` and remain secret-free — the
// Supabase key is never part of a `SupabaseRestError`, so it is never surfaced
// (mirrors the `#guard` in `SupabaseGateVerdictStore`).
//
// Faithful round-trip: the named columns map directly onto the report's scalar
// fields; the richer sub-objects (`mfeMaeSummary`, `strengthBreakdown`,
// `uncertainty`, `annotations`) are stored verbatim in the `metrics` jsonb so
// `getReport` reconstructs the report exactly, re-deriving no metric.

import type {
  EvaluationAnnotations,
  EvaluationReport,
  EvaluationReportStore,
  EvaluationUncertainty,
  MfeMaeSummary,
  StrengthBreakdown,
} from "../../kill-gate/types.js";
import { SupabaseRestError, eq, type SupabaseRestClient } from "./client.js";

const EVALUATION_REPORTS = "evaluation_reports";

/** evaluation_reports row shape (matches the SQL columns exactly). */
interface EvaluationReportRow {
  /** DB-generated uuid; present on read / return=representation, absent on insert. */
  readonly id?: string;
  readonly config_id: string;
  readonly split_train_end: string;
  readonly split_test_start: string;
  readonly split_test_end: string;
  readonly sample_size: number;
  readonly predictions_count: number;
  readonly model_accuracy: number;
  readonly baseline_accuracy: number;
  readonly delta_vs_baseline: number;
  readonly friction_adj_model: number | null;
  readonly friction_adj_base: number | null;
  readonly metrics: ReportMetricsJson;
}

/**
 * The jsonb payload stored in `evaluation_reports.metrics`. It carries the
 * report's richer sub-objects verbatim so the read-back is value-equal to the
 * composed report — the scalar columns carry the rest.
 */
interface ReportMetricsJson {
  readonly mfeMaeSummary: MfeMaeSummary;
  readonly strengthBreakdown: StrengthBreakdown;
  readonly uncertainty: EvaluationUncertainty;
  readonly annotations: EvaluationAnnotations;
}

/** Map an {@link EvaluationReport} to its `evaluation_reports` row. */
function toReportRow(report: EvaluationReport): Record<string, unknown> {
  const metrics: ReportMetricsJson = {
    mfeMaeSummary: report.mfeMaeSummary,
    strengthBreakdown: report.strengthBreakdown,
    uncertainty: report.uncertainty,
    annotations: report.annotations,
  };
  return {
    config_id: report.configId,
    split_train_end: report.split.trainEnd,
    split_test_start: report.split.testStart,
    split_test_end: report.split.testEnd,
    sample_size: report.sampleSize,
    predictions_count: report.predictionsCount,
    model_accuracy: report.modelAccuracy,
    baseline_accuracy: report.baselineAccuracy,
    delta_vs_baseline: report.deltaVsBaseline,
    friction_adj_model: report.frictionAdjustedModel,
    friction_adj_base: report.frictionAdjustedBaseline,
    metrics,
  };
}

/** Reconstruct an {@link EvaluationReport} from its row + jsonb metrics. */
function fromReportRow(row: EvaluationReportRow): EvaluationReport {
  return {
    configId: row.config_id,
    split: {
      trainEnd: row.split_train_end,
      testStart: row.split_test_start,
      testEnd: row.split_test_end,
    },
    sampleSize: row.sample_size,
    predictionsCount: row.predictions_count,
    modelAccuracy: row.model_accuracy,
    baselineAccuracy: row.baseline_accuracy,
    deltaVsBaseline: row.delta_vs_baseline,
    frictionAdjustedModel: row.friction_adj_model ?? 0,
    frictionAdjustedBaseline: row.friction_adj_base ?? 0,
    mfeMaeSummary: row.metrics.mfeMaeSummary,
    strengthBreakdown: row.metrics.strengthBreakdown,
    uncertainty: row.metrics.uncertainty,
    annotations: row.metrics.annotations,
  };
}

export class SupabaseEvaluationReportStore implements EvaluationReportStore {
  readonly #client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.#client = client;
  }

  /**
   * Persist one `evaluation_reports` row. The POST uses `insertReturning`
   * (`Prefer: return=representation`) to read back the DB-generated
   * `gen_random_uuid()` id. Returns `{ reportId }`, matching
   * {@link InMemoryEvaluationReportStore}. Errors are augmented with the
   * `config_id` and remain secret-free.
   */
  async persistReport(
    report: EvaluationReport,
  ): Promise<{ readonly reportId: string }> {
    const inserted = await this.#guard(report.configId, () =>
      this.#client.insertReturning<EvaluationReportRow>(EVALUATION_REPORTS, [
        toReportRow(report),
      ]),
    );

    const reportId = inserted[0]?.id;
    if (reportId === undefined) {
      throw new SupabaseRestError(
        `Supabase REST insert on "${EVALUATION_REPORTS}" ` +
          `(config_id=${report.configId}) returned no generated id`,
        0,
        EVALUATION_REPORTS,
      );
    }

    return { reportId };
  }

  /**
   * Read a report by id and reconstruct the {@link EvaluationReport}. Returns
   * null when no `evaluation_reports` row has that id.
   */
  async getReport(reportId: string): Promise<EvaluationReport | null> {
    const rows = await this.#guard("", () =>
      this.#client.select<EvaluationReportRow>(
        EVALUATION_REPORTS,
        `id=${eq(reportId)}&limit=1`,
      ),
    );
    const row = rows[0];
    return row === undefined ? null : fromReportRow(row);
  }

  /**
   * Run `op`, re-raising a {@link SupabaseRestError} with the `config_id`
   * appended to its message for diagnosis. The Supabase key is never part of a
   * `SupabaseRestError`, so it is never surfaced (Requirement 1.9 of the parent
   * activation spec, preserved here).
   */
  async #guard<T>(configId: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof SupabaseRestError) {
        const suffix = configId === "" ? "" : ` (config_id=${configId})`;
        throw new SupabaseRestError(
          `${err.message}${suffix}`,
          err.status,
          err.table,
        );
      }
      throw err;
    }
  }
}
