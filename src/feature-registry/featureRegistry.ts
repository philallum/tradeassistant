// Feature Registry (Task 8.1; Requirements 13.1–13.5, 13.8, 12.2, 12.3;
// Design Component 8).
//
// The registry admits candidate features into the model ONE AT A TIME by
// re-running the two-stage Kill_Gate harness for each candidate on top of a
// base configuration, then:
//
//   - retains passers (a PASS verdict) as `included`, subject to the hard
//     ceiling of ≤12 (Requirements 13.2, 13.4);
//   - cuts failers (a CUT verdict) and logs the failure with its metric deltas
//     to the Research_Log via LivingDocs (Requirement 13.3);
//   - persists every outcome to the `feature_registry` table through an
//     injected storage PORT (Requirement 13, 17.1).
//
// Build-order discipline (Requirement 12): a feature becomes `included` ONLY
// through a passing verdict (Requirement 12.2), and `included()` is the single
// source of truth for which features may drive a displayed signal
// (Requirement 12.3).
//
// This module owns the orchestration only. The candidate feature computations
// live behind the {@link FeatureComputer} boundary (task 8.2). No LLM input
// ever reaches this path (Requirement 2.1).

import { composeGateVerdict, toVerdictSummary } from "../kill-gate/verdict.js";
import type { LivingDocs } from "../living-docs/livingDocs.js";
import type { GateVerdict } from "../kill-gate/types.js";
import {
  CANDIDATE_FEATURES,
  FEATURE_CEILING,
  type CandidateEvaluation,
  type FeatureComputer,
  type FeatureId,
  type FeatureRegistryRow,
  type FeatureRegistryStore,
  type FeatureStatus,
  type ModelConfig,
} from "./types.js";

/** Dependencies the registry needs to evaluate and record candidates. */
export interface FeatureRegistryDeps {
  /** Computes per-fold gate inputs for a toggled config (task 8.2 boundary). */
  readonly computer: FeatureComputer;
  /** Storage PORT for the `feature_registry` table (Requirement 13, 17.1). */
  readonly store: FeatureRegistryStore;
  /** Living-Docs writer for logging cuts with metric deltas (Requirement 13.3). */
  readonly docs: LivingDocs;
}

/**
 * The Feature Registry (Design Component 8). Orchestrates one-at-a-time
 * candidate evaluation through the Kill_Gate, enforces the ≤12 inclusion
 * ceiling, and records every outcome. Deterministic given its injected
 * dependencies: a candidate toggled on an otherwise-unchanged config reproduces
 * the prior verdict (Requirement 13.7), because the verdict is a pure function
 * of the config's gate inputs.
 */
export class FeatureRegistry {
  readonly #computer: FeatureComputer;
  readonly #store: FeatureRegistryStore;
  readonly #docs: LivingDocs;

  constructor(deps: FeatureRegistryDeps) {
    this.#computer = deps.computer;
    this.#store = deps.store;
    this.#docs = deps.docs;
  }

  /**
   * The fixed candidate feature set (Requirements 13.5, 13.8). Returns a fresh
   * array so callers cannot mutate the canonical list.
   */
  candidates(): FeatureId[] {
    return [...CANDIDATE_FEATURES];
  }

  /**
   * Evaluate a single candidate by re-running the Kill_Gate harness on the
   * config with that candidate toggled ON (Requirement 13.1).
   *
   * PURE and deterministic: it toggles the candidate onto `baseConfig`, asks the
   * {@link FeatureComputer} for that config's per-fold gate inputs, and composes
   * the verdict. No persistence, no logging, no ceiling enforcement — those are
   * effects handled by {@link evaluateAndRecord}. Because the verdict is derived
   * solely from the config, toggling the same candidate onto the same base
   * reproduces the same verdict (Requirement 13.7).
   */
  evaluateOneAtATime(candidate: FeatureId, baseConfig: ModelConfig): GateVerdict {
    const toggledConfig = withFeature(baseConfig, candidate);
    const folds = this.#computer.gateInputsFor(toggledConfig);
    return composeGateVerdict(toggledConfig.configId, folds);
  }

  /**
   * Evaluate a candidate through the gate and record the outcome
   * (Requirements 13.2, 13.3, 13.4). Wraps {@link evaluateOneAtATime} with the
   * three effects the registry owns:
   *
   *   1. A PASS is admitted as `included` — UNLESS the ≤12 ceiling is already
   *      full, in which case it is recorded as a `candidate` and NOT included
   *      (the ceiling is never exceeded, Requirement 13.4).
   *   2. A CUT is recorded as `cut` and logged to the Research_Log with its
   *      metric deltas via LivingDocs (Requirement 13.3).
   *   3. The resulting row is persisted to the `feature_registry` store.
   *
   * A feature is admitted to `included` ONLY through a PASS verdict
   * (Requirement 12.2); there is no other path to inclusion.
   */
  async evaluateAndRecord(
    candidate: FeatureId,
    baseConfig: ModelConfig,
  ): Promise<CandidateEvaluation> {
    const verdict = this.evaluateOneAtATime(candidate, baseConfig);
    const passed = verdict.verdict === "PASS";

    // Enforce the ceiling against the currently-included set (Requirement 13.4).
    const includedCount = (await this.included()).length;
    const admit = passed && includedCount < FEATURE_CEILING;

    const status: FeatureStatus = admit
      ? "included"
      : passed
        ? "candidate" // passed but ceiling full: retained as candidate, not included.
        : "cut";

    // A CUT is logged with its metric deltas (Requirement 13.3). A PASS that is
    // admitted is logged as a verdict for the research history (Requirement 5.4).
    if (verdict.verdict === "CUT") {
      await this.#docs.appendCut(toVerdictSummary(verdict));
    } else if (admit) {
      await this.#docs.appendVerdict(toVerdictSummary(verdict));
    }

    const row: FeatureRegistryRow = {
      featureId: candidate,
      status,
      verdictId: verdict.configId,
    };
    await this.#store.upsert(row);

    return { candidate, verdict, included: admit, status };
  }

  /**
   * The included feature set (Requirement 13.4) — the single source of truth for
   * which features may drive a displayed signal (Requirement 12.3). Reads the
   * persisted `feature_registry` rows and returns those with status `included`.
   *
   * Defensively capped at {@link FEATURE_CEILING}: even if the store somehow
   * held more than 12 `included` rows, this never returns more than the ceiling
   * (Requirement 13.4). Ordering follows the canonical candidate order for
   * determinism.
   */
  async included(): Promise<FeatureId[]> {
    const rows = await this.#store.all();
    const includedIds = new Set(
      rows.filter((r) => r.status === "included").map((r) => r.featureId),
    );
    const ordered = CANDIDATE_FEATURES.filter((id) => includedIds.has(id));
    return ordered.slice(0, FEATURE_CEILING);
  }
}

/**
 * Derive the config with `candidate` toggled ON, leaving everything else
 * unchanged. Idempotent: toggling an already-present feature yields an
 * equivalent config (deduplicated), so the prior verdict is reproduced
 * (Requirement 13.7). The `features` list is normalized to the canonical
 * candidate order so two configs with the same feature set are identical.
 */
export function withFeature(base: ModelConfig, candidate: FeatureId): ModelConfig {
  const set = new Set<FeatureId>(base.features);
  set.add(candidate);
  const features = CANDIDATE_FEATURES.filter((id) => set.has(id));
  return { ...base, features };
}
