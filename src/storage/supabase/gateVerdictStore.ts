// Supabase-backed GateVerdictStore adapter (Requirement 1.1-1.4, 1.8, 1.9;
// design Component 1).
//
// Implements the SAME `GateVerdictStore` PORT signatures and semantics as the
// in-memory reference `InMemoryGateVerdictStore` (src/kill-gate/types.ts),
// backed by the shared `gate_verdicts` / `gate_fold_verdicts` schema:
//
//   gate_verdicts
//     id uuid pk default gen_random_uuid(), config_id, sample_size,
//     gate1_model_acc, gate1_baseline_acc, gate1_delta_pp, gate1_passed,
//     gate2_model_ra|null, gate2_baseline_ra|null, gate2_margin|null,
//     gate2_passed|null, verdict ('PASS'|'CUT'), selected_horizon (1|2|3|null),
//     split_train_end, split_test_start, split_test_end, created_at
//   gate_fold_verdicts
//     verdict_id uuid fk, fold_index, sample_size, skipped,
//     gate1_passed|null, gate2_passed|null, verdict ('PASS'|'CUT'|null),
//     metrics jsonb   PK (verdict_id, fold_index)
//
// Compute/storage separation (Requirement 17.1): this adapter reaches storage
// ONLY through the injected `SupabaseRestClient` and re-implements NO gate math
// or verdict composition — `composeGateVerdict` (src/kill-gate/verdict.ts) stays
// the sole producer. The adapter only maps record <-> row and reads back the
// DB-generated id.
//
// Persist ordering (design Component 1): the aggregate row is POSTed FIRST via
// `insertReturning` so the `gen_random_uuid()` id is read back, THEN one
// `gate_fold_verdicts` row per `FoldVerdict` is POSTed referencing that id
// (`gate_fold_verdicts.verdict_id` is an FK to `gate_verdicts(id)`). PostgREST
// has no cross-request transaction, so a fold-insert failure leaves a tolerable
// orphan aggregate row (verdicts are append-only research history) and the error
// is surfaced identifying the `config_id` — never the Supabase key (Req 1.9).
//
// Faithful round-trip (Req 1.3, 1.4): each fold's full `Gate1Result` /
// `Gate2Result` are stored in that fold's `metrics` jsonb so `getVerdict`
// reconstructs every `FoldVerdict` exactly. The aggregate `gate1` / `gate2` /
// `metrics` are reconstructed from the named columns plus the fold set using the
// SAME invariants `composeGateVerdict` guarantees (aggregate
// `gate1.sampleSize === verdict.sampleSize`, `gate1.evaluated === sampleSize >= 30`,
// Gate 2 not-evaluated => null columns, `metrics` counts derived from the fold
// rows), re-deriving no gate math.

import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type FoldVerdict,
  type Gate1Result,
  type Gate2Result,
  type GateMetrics,
  type GateVerdict,
  type GateVerdictSplit,
  type GateVerdictStore,
  type PersistVerdictReport,
  type PersistedGateVerdict,
} from "../../kill-gate/types.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";
import { eq } from "./client.js";

const GATE_VERDICTS = "gate_verdicts";
const GATE_FOLD_VERDICTS = "gate_fold_verdicts";

/** gate_verdicts row shape (matches the SQL columns exactly). */
interface GateVerdictRow {
  /** DB-generated uuid; present on read / return=representation, absent on insert. */
  readonly id?: string;
  readonly config_id: string;
  readonly sample_size: number;
  readonly gate1_model_acc: number;
  readonly gate1_baseline_acc: number;
  readonly gate1_delta_pp: number;
  readonly gate1_passed: boolean;
  readonly gate2_model_ra: number | null;
  readonly gate2_baseline_ra: number | null;
  readonly gate2_margin: number | null;
  readonly gate2_passed: boolean | null;
  readonly verdict: "PASS" | "CUT";
  readonly selected_horizon: 1 | 2 | 3 | null;
  readonly split_train_end: string;
  readonly split_test_start: string;
  readonly split_test_end: string;
}

/**
 * gate_fold_verdicts row shape. The `metrics` jsonb carries the full per-fold
 * `Gate1Result` / `Gate2Result` so the fold is reconstructed faithfully.
 */
interface GateFoldVerdictRow {
  readonly verdict_id: string;
  readonly fold_index: number;
  readonly sample_size: number;
  readonly skipped: boolean;
  readonly gate1_passed: boolean | null;
  readonly gate2_passed: boolean | null;
  readonly verdict: "PASS" | "CUT" | null;
  readonly metrics: FoldMetricsJson;
}

/** The jsonb payload stored in `gate_fold_verdicts.metrics`. */
interface FoldMetricsJson {
  readonly gate1: Gate1Result;
  readonly gate2: Gate2Result;
}

/** Map an aggregate {@link GateVerdict} + {@link GateVerdictSplit} to its row. */
function toVerdictRow(
  verdict: GateVerdict,
  split: GateVerdictSplit,
): Record<string, unknown> {
  const g2 = verdict.gate2;
  return {
    config_id: verdict.configId,
    sample_size: verdict.sampleSize,
    gate1_model_acc: verdict.gate1.modelAccuracy,
    gate1_baseline_acc: verdict.gate1.baselineAccuracy,
    gate1_delta_pp: verdict.gate1.deltaPp,
    gate1_passed: verdict.gate1.passed,
    // Gate 2 columns are null when Gate 2 was not evaluated (Gate 1 did not
    // pass): this records the not-evaluated state faithfully for read-back.
    gate2_model_ra: g2.evaluated ? g2.modelRiskAdj : null,
    gate2_baseline_ra: g2.evaluated ? g2.baselineRiskAdj : null,
    gate2_margin: g2.evaluated ? g2.margin : null,
    gate2_passed: g2.evaluated ? g2.passed : null,
    verdict: verdict.verdict,
    selected_horizon: split.selectedHorizon ?? null,
    split_train_end: split.trainEnd,
    split_test_start: split.testStart,
    split_test_end: split.testEnd,
  };
}

/** Map a {@link FoldVerdict} to its `gate_fold_verdicts` row. */
function toFoldRow(
  verdictId: string,
  fold: FoldVerdict,
): Record<string, unknown> {
  const metrics: FoldMetricsJson = { gate1: fold.gate1, gate2: fold.gate2 };
  return {
    verdict_id: verdictId,
    fold_index: fold.foldIndex,
    sample_size: fold.sampleSize,
    skipped: fold.skipped,
    gate1_passed: fold.gate1.passed,
    gate2_passed: fold.gate2.evaluated ? fold.gate2.passed : null,
    verdict: fold.verdict,
    metrics,
  };
}

/** Reconstruct a {@link FoldVerdict} from its row + jsonb metrics. */
function fromFoldRow(row: GateFoldVerdictRow): FoldVerdict {
  return {
    foldIndex: row.fold_index,
    sampleSize: row.sample_size,
    skipped: row.skipped,
    gate1: row.metrics.gate1,
    gate2: row.metrics.gate2,
    verdict: row.verdict === "CUT" ? "CUT" : "PASS",
  };
}

/**
 * A Gate 2 result read back as not-evaluated. Mirrors the `NOT_EVALUATED`
 * constant in src/kill-gate/gate2.ts (0 metrics, not passed) so the round-trip
 * is value-equal when Gate 1 did not pass.
 */
const GATE2_NOT_EVALUATED: Gate2Result = {
  modelRiskAdj: 0,
  baselineRiskAdj: 0,
  margin: 0,
  passed: false,
  evaluated: false,
};

/**
 * Reconstruct the aggregate {@link GateVerdict} from its row and its already
 * reconstructed per-fold verdicts.
 *
 * The aggregate `gate1` / `gate2` / `metrics` are rebuilt from the named columns
 * plus the fold set using the SAME invariants `composeGateVerdict` guarantees —
 * no gate math is re-run:
 *  - `gate1.sampleSize` is the aggregate `sample_size` column (== union size),
 *    and `gate1.evaluated` is `sampleSize >= GATE1_SAMPLE_SIZE_FLOOR`
 *    (the exact rule in `evaluateGate1`).
 *  - `gate2` is not-evaluated (all-zero) when its columns are null, else read
 *    back from the columns.
 *  - `metrics` counts come from the fold rows (`skipped` flag) and the
 *    accuracy/risk-adjusted deltas come from the aggregate delta/margin columns.
 */
function fromVerdictRow(
  row: GateVerdictRow,
  foldVerdicts: readonly FoldVerdict[],
): GateVerdict {
  const gate1: Gate1Result = {
    modelAccuracy: row.gate1_model_acc,
    baselineAccuracy: row.gate1_baseline_acc,
    deltaPp: row.gate1_delta_pp,
    sampleSize: row.sample_size,
    evaluated: row.sample_size >= GATE1_SAMPLE_SIZE_FLOOR,
    passed: row.gate1_passed,
  };

  const gate2: Gate2Result =
    row.gate2_passed === null
      ? GATE2_NOT_EVALUATED
      : {
          modelRiskAdj: row.gate2_model_ra ?? 0,
          baselineRiskAdj: row.gate2_baseline_ra ?? 0,
          margin: row.gate2_margin ?? 0,
          passed: row.gate2_passed,
          evaluated: true,
        };

  const skippedFolds = foldVerdicts.filter((f) => f.skipped).length;
  const metrics: GateMetrics = {
    qualifyingFolds: foldVerdicts.length - skippedFolds,
    skippedFolds,
    totalFolds: foldVerdicts.length,
    accuracyVsBaseline: row.gate1_delta_pp,
    riskAdjustedVsBaseline: gate2.margin,
  };

  return {
    configId: row.config_id,
    foldVerdicts,
    gate1,
    gate2,
    sampleSize: row.sample_size,
    verdict: row.verdict,
    metrics,
  };
}

/** Reconstruct the {@link GateVerdictSplit} from the aggregate row columns. */
function splitFromRow(row: GateVerdictRow): GateVerdictSplit {
  const split: GateVerdictSplit = {
    trainEnd: row.split_train_end,
    testStart: row.split_test_start,
    testEnd: row.split_test_end,
  };
  return row.selected_horizon === null || row.selected_horizon === undefined
    ? split
    : { ...split, selectedHorizon: row.selected_horizon };
}

export class SupabaseGateVerdictStore implements GateVerdictStore {
  readonly #client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.#client = client;
  }

  /**
   * Persist one aggregate row then its per-fold rows. The aggregate POST uses
   * `insertReturning` (`Prefer: return=representation`) to read back the
   * DB-generated `gen_random_uuid()` id, then one `gate_fold_verdicts` row per
   * fold is POSTed referencing that id. Returns
   * `{ verdictId, foldRows: verdict.foldVerdicts.length }`, matching
   * `InMemoryGateVerdictStore` (Req 1.3). Errors are augmented with the
   * `config_id` and remain secret-free (Req 1.9).
   */
  async persistVerdict(
    verdict: GateVerdict,
    split: GateVerdictSplit,
  ): Promise<PersistVerdictReport> {
    const inserted = await this.#guard(verdict.configId, () =>
      this.#client.insertReturning<GateVerdictRow>(GATE_VERDICTS, [
        toVerdictRow(verdict, split),
      ]),
    );

    const verdictId = inserted[0]?.id;
    if (verdictId === undefined) {
      throw new SupabaseRestError(
        `Supabase REST insert on "${GATE_VERDICTS}" (config_id=${verdict.configId}) ` +
          `returned no generated id`,
        0,
        GATE_VERDICTS,
      );
    }

    if (verdict.foldVerdicts.length > 0) {
      const foldRows = verdict.foldVerdicts.map((fold) =>
        toFoldRow(verdictId, fold),
      );
      await this.#guard(verdict.configId, () =>
        this.#client.insertReturning<GateFoldVerdictRow>(
          GATE_FOLD_VERDICTS,
          foldRows,
        ),
      );
    }

    return { verdictId, foldRows: verdict.foldVerdicts.length };
  }

  /**
   * Read the aggregate by id, then its fold rows (paginated, ordered by
   * fold_index), and reconstruct the `GateVerdict` + `GateVerdictSplit`. Returns
   * null when no `gate_verdicts` row has that id (Req 1.4).
   */
  async getVerdict(verdictId: string): Promise<PersistedGateVerdict | null> {
    const verdictRows = await this.#client.select<GateVerdictRow>(
      GATE_VERDICTS,
      `id=${eq(verdictId)}&limit=1`,
    );
    const verdictRow = verdictRows[0];
    if (verdictRow === undefined) {
      return null;
    }

    const foldRows = await this.#client.select<GateFoldVerdictRow>(
      GATE_FOLD_VERDICTS,
      `verdict_id=${eq(verdictId)}&order=fold_index.asc`,
    );
    const foldVerdicts = foldRows.map(fromFoldRow);

    return {
      verdictId,
      verdict: fromVerdictRow(verdictRow, foldVerdicts),
      split: splitFromRow(verdictRow),
    };
  }

  /**
   * Read the newest recorded PASS verdict for a config, or null when none
   * exists (Req 1.7, 1.8). This is the pure read the `GatePassingResolver`
   * (design Component 5) binds to in order to find the governing PASS of a
   * pair's active config: it selects the single most-recent `gate_verdicts`
   * row with `verdict = 'PASS'` for `configId`, ordered by `created_at`
   * descending and limited to one, through the SAME paginated `select` and
   * `eq()` encoder the rest of the adapter uses.
   *
   * It re-implements NO gate math (Req 1.8) — it consumes the recorded PASS the
   * Backtest_Stage persisted via `persistVerdict` and reports only its id.
   * Errors remain secret-free and are augmented with the `config_id` (Req 1.9).
   */
  async latestPassVerdict(
    configId: string,
  ): Promise<{ readonly verdictId: string } | null> {
    const rows = await this.#guard(configId, () =>
      this.#client.select<GateVerdictRow>(
        GATE_VERDICTS,
        `config_id=${eq(configId)}&verdict=${eq("PASS")}` +
          `&order=created_at.desc&limit=1`,
      ),
    );

    const verdictId = rows[0]?.id;
    return verdictId === undefined ? null : { verdictId };
  }

  /**
   * Run `op`, re-raising a {@link SupabaseRestError} with the `config_id`
   * appended to its message for diagnosis. The Supabase key is never part of a
   * `SupabaseRestError`, so it is never surfaced (Req 1.9).
   */
  async #guard<T>(configId: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof SupabaseRestError) {
        throw new SupabaseRestError(
          `${err.message} (config_id=${configId})`,
          err.status,
          err.table,
        );
      }
      throw err;
    }
  }
}
