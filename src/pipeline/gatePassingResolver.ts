// GatePassingResolver — pure read-only resolver (Requirement 3.1-3.3, 3.6-3.8;
// design Component 5).
//
// Implements the existing `GatePassingResolver` type contract from
// `src/pipeline/types.ts`:
//
//   (pair, decisionDate) => Promise<boolean> | boolean
//
// by READING recorded verdicts through the Requirement 1 adapters. It returns
// `true` ONLY when a recorded PASS Gate_Verdict backs the pair's active
// configuration, and `false` otherwise (Req 3.2, 3.6).
//
// It consumes recorded outcomes only (Req 3.3): it NEVER re-runs the
// walk-forward backtest, re-evaluates Gate 1 / Gate 2, or re-computes any gate
// math — `composeGateVerdict` (src/kill-gate/verdict.ts) stays the sole producer
// of verdicts and the Backtest_Stage the sole persister. This resolver is a
// pure, deterministic read over the recorded rows: for a fixed verdict history
// and Decision_Date, repeated invocations yield identical results (Req 3.7).
//
// Mapping "the pair's active configuration" to a verdict (design Component 5
// recommended default): the Gate_Run names each pair's governing config
// deterministically as `configId = "<PAIR>-active"`, and `activeConfigFor(pair)`
// returns that same string. The resolver then selects the latest recorded PASS
// `gate_verdicts` row for that `config_id` (append-only history ⇒ newest PASS
// wins) via the gate-verdict adapter's `latestPassVerdict` read helper.
//
// Failure handling (Req 3.8): on a store/read failure the resolver REJECTS
// (the error surfaces up through `evaluatePair` / `runDailyPipeline`); it never
// coerces gate-passing to `true` for any pair.

import type { Pair } from "../ingestion/types.js";
import type { GateVerdictStore } from "../kill-gate/types.js";
import type { FeatureRegistryStore } from "../feature-registry/types.js";
import type { GatePassingResolver } from "./types.js";

/**
 * Collaborators the {@link makeGatePassingResolver} factory wires together, per
 * design Component 5. All reads reach storage only through these injected
 * adapters, keeping the resolver a pure read over the recorded rows.
 */
export interface GatePassingResolverDeps {
  /** The gate-verdict adapter the recorded PASS verdicts are read from. */
  readonly gateVerdictStore: GateVerdictStore;
  /** The feature-registry adapter (recorded by the Gate_Run on PASS). */
  readonly featureRegistryStore: FeatureRegistryStore;
  /**
   * Maps a {@link Pair} to its active gate `config_id`. Defaults to
   * `` `${pair}-active` `` — the deterministic naming convention the Gate_Run
   * and this resolver share (design Component 5 recommended default).
   */
  readonly activeConfigFor?: (pair: Pair) => string;
  /**
   * Reads the newest recorded PASS `gate_verdicts` row for a `config_id`,
   * returning `{ verdictId }` or `null` when no PASS backs the config. Bound to
   * the gate-verdict adapter's `latestPassVerdict` read helper.
   */
  readonly latestPassVerdict: (
    configId: string,
  ) => Promise<{ readonly verdictId: string } | null>;
}

/** The default `Pair → config_id` naming convention (design Component 5). */
const defaultActiveConfigFor = (pair: Pair): string => `${pair}-active`;

/**
 * Build a {@link GatePassingResolver} that resolves gate-passing from recorded
 * PASS verdicts.
 *
 * The returned resolver, for a given `pair`, resolves the pair's active
 * `config_id` via `activeConfigFor(pair)` (defaulting to `` `${pair}-active` ``)
 * and reads the latest recorded PASS for that config through
 * `latestPassVerdict`. It resolves `true` ONLY when such a PASS exists, and
 * `false` otherwise (Req 3.2, 3.6). It performs no gate math (Req 3.3), is a
 * pure read over the recorded rows (Req 3.7), and REJECTS rather than coercing
 * `true` when the backing store read fails (Req 3.8).
 *
 * The `decisionDate` argument is part of the `GatePassingResolver` contract; the
 * recommended-default mapping keys the governing verdict on the active config
 * (append-only history ⇒ newest PASS wins), so the resolution does not vary
 * within a fixed verdict history.
 */
export function makeGatePassingResolver(
  deps: GatePassingResolverDeps,
): GatePassingResolver {
  const activeConfigFor = deps.activeConfigFor ?? defaultActiveConfigFor;

  return async (pair: Pair): Promise<boolean> => {
    const configId = activeConfigFor(pair);
    // A rejection here propagates to the caller unchanged — the resolver never
    // swallows a read failure and never returns `true` on failure (Req 3.8).
    const pass = await deps.latestPassVerdict(configId);
    return pass !== null;
  };
}
