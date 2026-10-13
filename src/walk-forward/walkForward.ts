// Walk_Forward_Evaluation harness — trader-edge-validation Stage D (task 12;
// design R7, R11). Honors "freeze before you measure": per window it SELECTS a
// Parameter_Set on an in-sample span, FREEZES it as a Frozen_Baseline, then
// builds the ledger + metrics ONLY on the immediately following out-of-sample
// span, records which Frozen_Baseline produced the result (R7.2), advances, and
// repeats (R7.1).
//
// Horizon selection is PART of the frozen Parameter_Set (R7.4), so it cannot be
// re-chosen on the OOS data to inflate the result. A final window is reservable
// and untouched until a Parameter_Set is settled; each result records whether it
// used the reserved window (R7.5). A window development has already tuned against
// is flagged non-independent in any report that uses it (R7.6).
//
// Forecasts for a window are REGENERATED through the live pipeline under the
// frozen set via an injected `ForecastRegenerator` seam — the signal is NEVER
// re-implemented here (R7.1, R7.3). The harness then feeds those forecasts into
// the SAME `buildTradeLedger` + metrics used everywhere else. Deterministic,
// LLM-free; a read-only consumer that touches no live decision path.

import type { ExecutionModel } from "../trade-sim/executionModel.js";
import type { IntraCandleResolver } from "../trade-sim/types.js";
import type { CandleStore } from "../ingestion/types.js";
import {
  buildTradeLedger,
  type BuildTradeLedgerDeps,
  type LedgerForecast,
} from "../trade-ledger/buildTradeLedger.js";
import { summarize, type PerformanceSummary } from "../performance/metrics.js";
import type { FrozenBaseline, ParameterSet } from "./parameterSet.js";

/** A half-open date span `[start, end]` (inclusive ISO dates). */
export interface DateWindow {
  readonly start: string;
  readonly end: string;
}

/**
 * One chronological fold: an in-sample span used to SELECT the Parameter_Set and
 * the immediately following out-of-sample span the frozen set is MEASURED on
 * (R7.1). `reserved` marks the untouched final window (R7.5).
 */
export interface WalkForwardWindow {
  readonly id: string;
  /** The span used to select / fit the Parameter_Set. */
  readonly inSample: DateWindow;
  /** The immediately following span the FROZEN set is measured on. */
  readonly outOfSample: DateWindow;
  /** True for the reserved final window held untouched until params settle (R7.5). */
  readonly reserved?: boolean;
}

/**
 * Selects (fits) a Parameter_Set on an in-sample window and returns the
 * version-stamped Frozen_Baseline to freeze. The DEFAULT selector captures the
 * current live constants verbatim (no fitting), so the walk-forward measures the
 * live system; a sensitivity study may plug a selector that fits a variant. The
 * selector is called with the IN-SAMPLE window ONLY — it must never see the OOS
 * span (that is what makes the freeze provable).
 */
export type BaselineSelector = (
  inSample: DateWindow,
  windowId: string,
) => FrozenBaseline | Promise<FrozenBaseline>;

/**
 * Regenerates the forecasts for an OOS window under a FROZEN Parameter_Set, by
 * running the live pipeline — never re-implementing the signal (R7.1, R7.3).
 * Implemented by {@link pipelineForecastRegenerator} in production; injected as a
 * stub in tests so the harness runs offline. MUST honor the frozen set's horizon
 * selection (R7.4) and MUST produce forecasts ONLY within the OOS span.
 */
export type ForecastRegenerator = (
  params: ParameterSet,
  outOfSample: DateWindow,
  strategyId: string,
) => Promise<readonly LedgerForecast[]>;

/** The result of measuring ONE OOS window under its frozen set. */
export interface WindowResult {
  readonly windowId: string;
  readonly outOfSample: DateWindow;
  /** The Frozen_Baseline that produced this window's result (R7.2). */
  readonly frozenBaseline: FrozenBaseline;
  /** OOS net-of-cost performance under the frozen set. */
  readonly summary: PerformanceSummary;
  /** Whether this result used the reserved final window (R7.5). */
  readonly usedReservedWindow: boolean;
  /**
   * Whether this window is still INDEPENDENT of its own result. False when the
   * window was tuned against during development (R7.6) — any report using it must
   * surface the loss of independence.
   */
  readonly independent: boolean;
}

/** The full walk-forward report across every fold. */
export interface WalkForwardReport {
  readonly windows: readonly WindowResult[];
  /**
   * The pooled OOS summary across every INDEPENDENT window (the reserved window
   * is included only if it was consulted). A tuned-against window is excluded
   * from the pooled independent headline but still reported per-window.
   */
  readonly pooledIndependent: PerformanceSummary;
}

/** Dependencies for {@link walkForward}. */
export interface WalkForwardDeps {
  readonly candleStore: CandleStore;
  readonly executionModel: ExecutionModel;
  /** Selects + freezes the Parameter_Set per in-sample window. */
  readonly baselineSelector: BaselineSelector;
  /** Regenerates OOS forecasts under the frozen set (pipeline-backed). */
  readonly regenerate: ForecastRegenerator;
  readonly intraCandleResolver?: IntraCandleResolver;
  /**
   * Window ids development has already tuned against — flagged non-independent in
   * the report (R7.6). The reserved window, once consulted, is independent unless
   * also listed here.
   */
  readonly tunedAgainstWindowIds?: readonly string[];
}

/**
 * Run the walk-forward evaluation over the ordered windows (R7.1). For each
 * window: select+freeze the Parameter_Set on its in-sample span, regenerate the
 * OOS forecasts under the frozen set through the pipeline, build the ledger +
 * metrics on the OOS span only, and record the frozen baseline + independence
 * flags. The reserved final window is measured like any other BUT its
 * `usedReservedWindow` is recorded so a reader knows the untouched holdout was
 * consulted (R7.5).
 *
 * The harness never re-chooses the horizon or any other tunable on the OOS data
 * — those are fixed in the frozen `ParameterSet` the regenerator consumes (R7.4).
 */
export async function walkForward(
  windows: readonly WalkForwardWindow[],
  deps: WalkForwardDeps,
): Promise<WalkForwardReport> {
  const tuned = new Set(deps.tunedAgainstWindowIds ?? []);
  const ledgerDeps = ledgerDepsFrom(deps);
  const results: WindowResult[] = [];

  for (const window of windows) {
    // FREEZE: select the Parameter_Set on the IN-SAMPLE window only.
    const frozen = await deps.baselineSelector(window.inSample, window.id);

    // REGENERATE forecasts under the frozen set, OOS span only (signal unchanged).
    const forecasts = await deps.regenerate(frozen.params, window.outOfSample, frozen.id);

    // MEASURE: same ledger + metrics machinery as everywhere else.
    const rows = await buildTradeLedger(forecasts, ledgerDeps);

    results.push({
      windowId: window.id,
      outOfSample: window.outOfSample,
      frozenBaseline: frozen,
      summary: summarize(rows, frozen.id),
      usedReservedWindow: window.reserved === true,
      independent: !tuned.has(window.id),
    });
  }

  // Pool only the INDEPENDENT windows into the headline (R7.6): re-summarise the
  // union of their ledgers would require re-running; instead we aggregate the
  // already-computed per-window ledgers by re-building across the independent set.
  const pooledIndependent = await pooledIndependentSummary(windows, results, deps, tuned);

  return { windows: results, pooledIndependent };
}

/**
 * Build the pooled summary across every INDEPENDENT window by re-running the
 * ledger on the union of those windows' OOS forecasts, so the headline figure is
 * never contaminated by a tuned-against window (R7.6). An empty independent set
 * yields a zeroed summary.
 */
async function pooledIndependentSummary(
  windows: readonly WalkForwardWindow[],
  results: readonly WindowResult[],
  deps: WalkForwardDeps,
  tuned: ReadonlySet<string>,
): Promise<PerformanceSummary> {
  const byId = new Map(windows.map((w) => [w.id, w] as const));
  const allRows = [];
  for (const result of results) {
    if (!result.independent || tuned.has(result.windowId)) continue;
    const window = byId.get(result.windowId)!;
    const forecasts = await deps.regenerate(
      result.frozenBaseline.params,
      window.outOfSample,
      result.frozenBaseline.id,
    );
    const rows = await buildTradeLedger(forecasts, ledgerDepsFrom(deps));
    allRows.push(...rows);
  }
  return summarize(allRows, "walk-forward-independent");
}

/**
 * Build the ledger deps from the harness deps, including `intraCandleResolver`
 * ONLY when present (the ledger's `BuildTradeLedgerDeps` uses
 * `exactOptionalPropertyTypes`, so passing an explicit `undefined` is rejected).
 */
function ledgerDepsFrom(deps: WalkForwardDeps): BuildTradeLedgerDeps {
  return deps.intraCandleResolver === undefined
    ? { candleStore: deps.candleStore, executionModel: deps.executionModel }
    : {
        candleStore: deps.candleStore,
        executionModel: deps.executionModel,
        intraCandleResolver: deps.intraCandleResolver,
      };
}
