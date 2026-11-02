// Container/operator entry point for the one-shot EDGE EVALUATION run
// (trader-edge-validation task 20; design R12, Stage H).
//
// Runs the evidence suite over a fixed window set: capture (and persist) a
// Frozen_Baseline → walk-forward the frozen set → build the system's Trade_Ledger
// over the out-of-sample window(s) → net-of-cost metrics + Comparator_Strategies +
// Calibration → emit a SECRET-FREE summary and append a measurement note to
// RESEARCH-LOG.md ONLY (R12.5; never PROJECT-STATE.md).
//
// It contains NO measurement math of its own: every figure comes from the
// already-built modules (`walkForward`, `buildTradeLedger`, `summarize`,
// `compareStrategies`, `calibrate`). It is a separate read-only consumer of stored
// data: it feeds nothing back into retrieval, confidence, firing or risk, takes no
// LLM input, and a negative result ("system does not beat the comparators") is
// reported plainly as a valid outcome (R5.4, R12.6). No PASS/CUT/KILL token is
// written anywhere.
//
// Secret confidentiality: the Supabase key is NEVER logged; logs carry only
// non-secret references (target name, ids, counts).
//
// ☁️ OPERATIONAL SAFETY: this module only BUILDS the entry point; it is unit-tested
// with injected in-memory stores (no network). Running it against the hosted DB is
// an OPERATOR action and is NOT performed autonomously.

import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import type { PipelineStores } from "../../pipeline/index.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import {
  SupabaseRestClient,
  SupabaseFrozenBaselineStore,
  buildSupabaseStores,
} from "../../storage/supabase/index.js";
import { SupabaseTradeLedgerStore } from "../../storage/supabase/tradeLedgerStore.js";
import { assertHostedHeavyOpAllowed } from "../../storage/supabaseConfig.js";
import {
  DEFAULT_EXECUTION_MODEL,
  type ExecutionModel,
} from "../../trade-sim/executionModel.js";
import {
  buildTradeLedger,
  type BuildTradeLedgerDeps,
  type LedgerForecast,
} from "../../trade-ledger/buildTradeLedger.js";
import type { TradeLedgerRow, TradeLedgerStore } from "../../trade-ledger/types.js";
import {
  captureFrozenBaseline,
  type FrozenBaseline,
} from "../../walk-forward/parameterSet.js";
import type { FrozenBaselineStore } from "../../walk-forward/frozenBaselineStore.js";
import {
  walkForward,
  type ForecastRegenerator,
  type WalkForwardWindow,
} from "../../walk-forward/walkForward.js";
import { pipelineForecastRegenerator } from "../../walk-forward/pipelineForecastRegenerator.js";
import { summarize, type PerformanceSummary } from "../../performance/metrics.js";
import {
  compareStrategies,
  defaultComparators,
  SYSTEM_STRATEGY_ID,
  type ComparisonReport,
} from "../../performance/comparators.js";
import { calibrate, type CalibrationReport } from "../../performance/calibration.js";

/**
 * The committed default window set: one fold whose OOS span is the 2024 calendar
 * year (mirrors the evaluation-run's fixed split), with the in-sample span ending
 * the last trading day of 2023. Committed, not runtime-derived, so re-runs measure
 * the same window.
 */
export const EDGE_EVAL_WINDOWS: readonly WalkForwardWindow[] = [
  {
    id: "oos-2024",
    inSample: { start: "2021-01-01", end: "2023-12-29" },
    outOfSample: { start: "2024-01-02", end: "2024-12-31" },
  },
] as const;

/** Secret-free summary of an edge-evaluation run. */
export interface EdgeEvalSummary {
  readonly frozenBaselineId: string;
  readonly executionModelId: string;
  readonly windows: readonly {
    readonly windowId: string;
    readonly outOfSample: { readonly start: string; readonly end: string };
    readonly independent: boolean;
    readonly usedReservedWindow: boolean;
    readonly tradeCount: number;
    readonly netExpectancyPips: number;
  }[];
  readonly pooledIndependent: PerformanceSummary;
  readonly comparison: ComparisonReport;
  readonly calibration: CalibrationReport;
  readonly ledgerRowCount: number;
}

export type EdgeEvalResult =
  | { readonly completed: true; readonly summary: EdgeEvalSummary }
  | { readonly completed: false; readonly missingPrerequisite: string };

/** Injectable collaborators; every field optional with a hosted default. */
export interface EdgeEvalDeps {
  readonly config?: ScheduledRunConfig;
  readonly stores?: PipelineStores;
  readonly tradeLedgerStore?: TradeLedgerStore;
  readonly frozenBaselineStore?: FrozenBaselineStore;
  readonly fetchImpl?: typeof fetch;
  readonly docs?: LivingDocs;
  readonly executionModel?: ExecutionModel;
  readonly windows?: readonly WalkForwardWindow[];
  /** Forecast regenerator; defaults to the pipeline-backed one over `stores`. */
  readonly regenerate?: ForecastRegenerator;
  /** Pre-chosen Frozen_Baseline; defaults to capturing the live parameter set. */
  readonly frozenBaseline?: FrozenBaseline;
  /** Window ids development already tuned against (flagged non-independent). */
  readonly tunedAgainstWindowIds?: readonly string[];
}

function researchLogBaseDir(): string {
  const configured = process.env.EDGE_EVAL_DOCS_DIR ?? process.env.EVALUATION_RUN_DOCS_DIR;
  return configured !== undefined && configured.length > 0 ? configured : tmpdir();
}

/** Memoise the regenerator so the same (set, window) is computed once per run. */
function memoise(inner: ForecastRegenerator): ForecastRegenerator {
  const cache = new Map<string, Promise<readonly LedgerForecast[]>>();
  return (params, oos, strategyId) => {
    const key = `${strategyId}|${oos.start}|${oos.end}|${JSON.stringify(params)}`;
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = inner(params, oos, strategyId);
      cache.set(key, hit);
    }
    return hit;
  };
}

/**
 * Run the one-shot edge evaluation. Returns `completed: false` (no fabricated
 * result) when there are no stored candles to evaluate.
 */
export async function runEdgeEval(deps: EdgeEvalDeps = {}): Promise<EdgeEvalResult> {
  const config = deps.config ?? loadScheduledRunConfig();
  const needsHosted =
    deps.stores === undefined ||
    deps.tradeLedgerStore === undefined ||
    deps.frozenBaselineStore === undefined;

  // Heavy full-history read: refuse hosted unless the operator opted in. Skipped
  // when every store is injected (tests), since no hosted read can occur.
  if (needsHosted) {
    assertHostedHeavyOpAllowed(config.supabase, "edge-eval backtest");
  }
  const client = needsHosted
    ? deps.fetchImpl === undefined
      ? new SupabaseRestClient(config.supabase)
      : new SupabaseRestClient(config.supabase, deps.fetchImpl)
    : undefined;

  const stores = deps.stores ?? buildSupabaseStores(config.supabase, deps.fetchImpl);
  const tradeLedgerStore =
    deps.tradeLedgerStore ?? new SupabaseTradeLedgerStore(requireClient(client));
  const frozenStore =
    deps.frozenBaselineStore ?? new SupabaseFrozenBaselineStore(requireClient(client));
  const docs = deps.docs ?? new LivingDocs(new FsDocStore(researchLogBaseDir()));
  const executionModel = deps.executionModel ?? DEFAULT_EXECUTION_MODEL;
  const windows = deps.windows ?? EDGE_EVAL_WINDOWS;

  console.log(
    JSON.stringify({
      event: "edge_eval.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      executionModelId: executionModel.id,
      windows: windows.map((w) => w.id),
    }),
  );

  // Prerequisite: stored candles must exist. Do not fabricate a result.
  const coverage = await stores.candleStore.getCoverageSummary();
  if (!coverage.some((c) => c.count > 0)) {
    const missingPrerequisite =
      "edge-eval: no candles stored — run the backfill/seed first";
    console.error(JSON.stringify({ event: "edge_eval.incomplete", missingPrerequisite }));
    return { completed: false, missingPrerequisite };
  }

  // 1. Capture + persist the Frozen_Baseline (read-only wrt the live decision, R11.3).
  const baseline = deps.frozenBaseline ?? captureFrozenBaseline();
  await frozenStore.append([baseline]);

  const regenerate = memoise(deps.regenerate ?? pipelineForecastRegenerator(stores));
  const ledgerDeps: BuildTradeLedgerDeps = {
    candleStore: stores.candleStore,
    executionModel,
  };

  // 2. Walk-forward under the frozen set (selector returns the frozen baseline).
  const wf = await walkForward(windows, {
    candleStore: stores.candleStore,
    executionModel,
    baselineSelector: () => baseline,
    regenerate,
    ...(deps.tunedAgainstWindowIds !== undefined
      ? { tunedAgainstWindowIds: deps.tunedAgainstWindowIds }
      : {}),
  });

  // 3. System ledger over the OOS windows → persist, calibrate, compare.
  const tuned = new Set(deps.tunedAgainstWindowIds ?? []);
  const systemForecasts: LedgerForecast[] = [];
  for (const w of windows) {
    if (tuned.has(w.id)) continue; // headline uses independent windows only (R7.6)
    systemForecasts.push(...(await regenerate(baseline.params, w.outOfSample, SYSTEM_STRATEGY_ID)));
  }
  const ledgerRows: readonly TradeLedgerRow[] = await buildTradeLedger(systemForecasts, ledgerDeps);
  await tradeLedgerStore.appendRows(ledgerRows);

  const comparison = await compareStrategies(systemForecasts, defaultComparators(), ledgerDeps);
  const calibration = calibrate(ledgerRows);

  const summary: EdgeEvalSummary = {
    frozenBaselineId: baseline.id,
    executionModelId: executionModel.id,
    windows: wf.windows.map((r) => ({
      windowId: r.windowId,
      outOfSample: r.outOfSample,
      independent: r.independent,
      usedReservedWindow: r.usedReservedWindow,
      tradeCount: r.summary.tradeCount,
      netExpectancyPips: r.summary.netExpectancyPips,
    })),
    pooledIndependent: wf.pooledIndependent,
    comparison,
    calibration,
    ledgerRowCount: ledgerRows.length,
  };

  // 4. Measurement note → RESEARCH-LOG.md only (R12.5). No PASS/CUT token.
  await docs.appendEdgeEvaluation(
    `${new Date().toISOString().slice(0, 10)} baseline=${baseline.id}`,
    renderResearchLines(summary, summarize(ledgerRows, SYSTEM_STRATEGY_ID)),
  );

  console.log(
    JSON.stringify({
      event: "edge_eval.completed",
      frozenBaselineId: baseline.id,
      ledgerRowCount: ledgerRows.length,
      tradeCount: wf.pooledIndependent.tradeCount,
      netExpectancyPips: wf.pooledIndependent.netExpectancyPips,
      systemBeatsComparators: comparison.systemBeatsComparators,
    }),
  );

  return { completed: true, summary };
}

function requireClient(client: SupabaseRestClient | undefined): SupabaseRestClient {
  if (client === undefined) throw new Error("edge-eval: Supabase client unavailable");
  return client;
}

/** Plain, verdict-token-free lines for the RESEARCH-LOG entry. */
function renderResearchLines(s: EdgeEvalSummary, system: PerformanceSummary): readonly string[] {
  const p = s.pooledIndependent;
  const beats = s.comparison.systemBeatsComparators
    ? "system net expectancy exceeds every comparator"
    : `system did NOT exceed: ${s.comparison.notBeaten.join(", ")} (valid, reported plainly)`;
  const bands = s.calibration.bands
    .map((b) => `[${b.lo},${b.hi}) n=${b.forecastCount} eff=${b.effectiveSampleSize.toFixed(1)} rate=${b.realizedCorrectRate.toFixed(3)}`)
    .join("; ");
  return [
    `Execution model: ${s.executionModelId}; Frozen_Baseline: ${s.frozenBaselineId}`,
    `Windows: ${s.windows.map((w) => `${w.windowId}(${w.outOfSample.start}..${w.outOfSample.end}, independent=${w.independent}, reserved=${w.usedReservedWindow})`).join("; ")}`,
    `Pooled independent OOS (net of costs): trades=${p.tradeCount} netExpectancyPips=${p.netExpectancyPips.toFixed(3)} netExpectancyR=${p.netExpectancyR.toFixed(3)} profitFactor=${String(p.profitFactor)} maxDrawdownPips=${p.maxDrawdownPips.toFixed(1)} ambiguousShare=${p.ambiguousShare.toFixed(3)} expiredShare=${p.expiredShare.toFixed(3)}`,
    `System ledger (all rows): trades=${system.tradeCount} netExpectancyPips=${system.netExpectancyPips.toFixed(3)}`,
    `Comparators: ${s.comparison.results.map((r) => `${r.strategyId}=${r.summary.netExpectancyPips.toFixed(3)}`).join(" ")}; ${beats}`,
    `Calibration: monotonic=${s.calibration.monotonic} wellCalibrated=${s.calibration.wellCalibrated}; bands: ${bands.length > 0 ? bands : "none"}`,
    "Note: evidence for human interpretation; an unfavourable result is a valid outcome.",
  ];
}

export async function main(): Promise<void> {
  const result = await runEdgeEval();
  if (!result.completed) process.exitCode = 1;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "edge_eval.error", message }));
    process.exitCode = 1;
  });
}
