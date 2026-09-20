// Feature Registry Types (Requirement 13, Design Component 8).
//
// The Feature Registry admits candidate features into the model ONE AT A TIME
// by re-running the two-stage Kill_Gate harness for each candidate, retaining
// passers and cutting+logging failers, subject to a hard ceiling of ≤12
// included features (Requirements 13.1–13.5, 13.8, 12.2, 12.3).
//
// This file defines the registry's typed vocabulary: the candidate FeatureId
// set, the ModelConfig that toggles features on a base configuration, the
// storage PORT for the `feature_registry` table, and the compute BOUNDARY
// (`FeatureComputer`) that task 8.2 fills in. Task 8.1 owns the registry
// orchestration and this vocabulary; it deliberately does NOT implement the
// candidate feature computations themselves — those are behind
// `FeatureComputer`, an interface task 8.2 implements.

import type { Pair } from "../ingestion/types.js";
import type { Horizon } from "../confidence/types.js";
import type { FoldGateInput } from "../kill-gate/verdict.js";
import type { GateVerdict } from "../kill-gate/types.js";

/**
 * The fixed set of candidate feature identifiers the registry can evaluate
 * (Requirements 13.5, 13.8). These are candidates only — a feature is
 * *included* solely through a passing Kill_Gate verdict (Requirement 12.2).
 *
 *   - `%B`                  — Bollinger %B.
 *   - `RSI`                 — Relative Strength Index.
 *   - `volumeProxyRegime`   — volume proxy used as REGIME (not magnitude).
 *   - `weeklyTrendContext`  — weekly-trend context.
 *   - `distanceToSma`       — distance to a simple moving average.
 *   - `structuralLiquiditySr`— distance to nearest structural S/R level
 *                              (Prev Day/Week H/L, 20-Day H/L; Req 13.6).
 *   - `yieldSpread10y`      — base-country 10Y minus quote-country 10Y
 *                              government-bond yield spread (Req 13.8).
 */
export const CANDIDATE_FEATURES = [
  "%B",
  "RSI",
  "volumeProxyRegime",
  "weeklyTrendContext",
  "distanceToSma",
  "structuralLiquiditySr",
  "yieldSpread10y",
] as const;

/** A candidate feature identifier (Requirements 13.5, 13.8). */
export type FeatureId = (typeof CANDIDATE_FEATURES)[number];

/** Type guard for {@link FeatureId}. */
export function isFeatureId(value: string): value is FeatureId {
  return (CANDIDATE_FEATURES as readonly string[]).includes(value);
}

/**
 * The hard ceiling on the number of *included* features (Requirement 13.4).
 * The registry never admits more than this, regardless of how many candidates
 * earn a passing verdict.
 */
export const FEATURE_CEILING = 12 as const;

/**
 * The lifecycle status of a feature in the `feature_registry` table, matching
 * the SQL `status` check constraint (`candidate` | `included` | `cut`).
 *
 *   - `candidate` — not yet evaluated (default).
 *   - `included`  — earned a PASS verdict and admitted under the ceiling.
 *   - `cut`       — evaluated and failed a gate (Requirement 13.3).
 */
export type FeatureStatus = "candidate" | "included" | "cut";

/**
 * A model configuration whose feature toggles the registry evaluates.
 *
 * A `ModelConfig` is the shape-only base model plus the set of features
 * currently toggled ON. `evaluateOneAtATime()` derives, for a single candidate,
 * the config `{ ...base, features: base.features ∪ {candidate} }` and re-runs
 * the gate against it (Requirement 13.1). Because a config is fully described by
 * its `configId` + toggled `features` + `pair`/`horizon`, toggling a feature
 * with otherwise-unchanged config reproduces the prior verdict deterministically
 * (Requirement 13.7).
 */
export interface ModelConfig {
  /** Stable identifier for the base configuration (drives verdict reproducibility). */
  readonly configId: string;
  /** The features toggled ON for this configuration. */
  readonly features: readonly FeatureId[];
  /** The currency pair this configuration is evaluated for. */
  readonly pair: Pair;
  /** The selected Horizon over which the gate scores this configuration. */
  readonly horizon: Horizon;
}

/**
 * Compute BOUNDARY between the registry orchestration (task 8.1) and the
 * candidate feature computations (task 8.2).
 *
 * Given a fully-toggled {@link ModelConfig} — the base features plus the one
 * candidate under test — an implementation produces the per-fold gate inputs
 * (matched firing subset + model/baseline excursions) for that configuration on
 * the walk-forward test folds. The registry feeds these straight into
 * `composeGateVerdict()`.
 *
 * Task 8.1 depends ONLY on this interface; task 8.2 supplies the concrete
 * implementation that computes %B, RSI, the volume-proxy regime, weekly-trend
 * context, distance-to-SMA, `structuralLiquidityDistance()`, and
 * `yieldSpread10y()`, all under the Look-Ahead Guard. Keeping the boundary here
 * lets both tasks proceed in parallel without edit conflicts.
 */
export interface FeatureComputer {
  /**
   * Produce the per-fold gate inputs for `config` on the walk-forward test
   * folds. The registry passes the returned folds unchanged to
   * `composeGateVerdict()`, so the implementation is responsible for applying
   * the Look-Ahead Guard and restricting rows to the out-of-sample partition.
   */
  gateInputsFor(config: ModelConfig): readonly FoldGateInput[];
}

/**
 * A single `feature_registry` row: the feature's current status and the id of
 * the verdict that justifies it (`null` while still a candidate). Mirrors the
 * SQL columns `feature_id`, `status`, `verdict_id`.
 */
export interface FeatureRegistryRow {
  readonly featureId: FeatureId;
  readonly status: FeatureStatus;
  /** The `gate_verdicts.id` that produced this status, or null for a candidate. */
  readonly verdictId: string | null;
}

/**
 * Storage PORT for the `feature_registry` table (Requirement 13, 17.1). The
 * registry orchestration depends only on this port, never on Supabase directly,
 * keeping compute independent of storage. Implementations upsert by
 * `feature_id` (the table's primary key).
 */
export interface FeatureRegistryStore {
  /** Upsert a feature's status + justifying verdict id by `feature_id`. */
  upsert(row: FeatureRegistryRow): Promise<void>;
  /** Read a single feature row by id, or null when absent. */
  get(featureId: FeatureId): Promise<FeatureRegistryRow | null>;
  /** Read all recorded rows (order unspecified). */
  all(): Promise<readonly FeatureRegistryRow[]>;
}

/**
 * In-memory reference implementation of {@link FeatureRegistryStore}.
 *
 * Deterministic and dependency-free; upserts by `feature_id` exactly as the SQL
 * table's primary key does, and serves as the reference for the Supabase
 * adapter. Used to exercise the registry offline.
 */
export class InMemoryFeatureRegistryStore implements FeatureRegistryStore {
  readonly #rows = new Map<FeatureId, FeatureRegistryRow>();

  constructor(initial: readonly FeatureRegistryRow[] = []) {
    for (const row of initial) this.#rows.set(row.featureId, row);
  }

  upsert(row: FeatureRegistryRow): Promise<void> {
    this.#rows.set(row.featureId, row);
    return Promise.resolve();
  }

  get(featureId: FeatureId): Promise<FeatureRegistryRow | null> {
    return Promise.resolve(this.#rows.get(featureId) ?? null);
  }

  all(): Promise<readonly FeatureRegistryRow[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  clear(): void {
    this.#rows.clear();
  }
}

/** The outcome of evaluating a single candidate through the gate. */
export interface CandidateEvaluation {
  readonly candidate: FeatureId;
  /** The full gate verdict produced by re-running the harness for the candidate. */
  readonly verdict: GateVerdict;
  /**
   * True when the candidate earned a PASS AND was admitted under the ≤12
   * ceiling; false when it was cut (failed a gate) or the ceiling was already
   * full (Requirements 13.2, 13.3, 13.4).
   */
  readonly included: boolean;
  /** The status persisted for this feature after the evaluation. */
  readonly status: FeatureStatus;
}
