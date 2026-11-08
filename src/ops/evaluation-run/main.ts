// Container entry point for the one-shot EVALUATION run (simplify-to-cloud-minimal
// Requirements 2.1-2.6; design C1 / C4 / Decision 3).
//
// This is the runnable script that composes the human-read Evaluation_Report for
// the shape-only configuration over a FIXED, recorded chronological out-of-sample
// split against the backfilled history, persists it to `evaluation_reports`, and
// appends it to `RESEARCH-LOG.md` — with NO PASS/CUT and no verdict (Requirement
// 2.4). It is the report-path successor to `src/ops/gate-run/main.ts`: where the
// Gate_Run drove the retained verdict path (`gate_verdicts`), this drives the
// ACTIVE evaluation write path (`evaluation_reports`, Requirement 8.2).
//
// It contains NO measurement math of its own. The fold inputs come from the
// SHARED `buildFoldInputs` (src/staged-runner/stagedRunner.ts) — the exact same
// construction the retained verdict path uses, so the reframe changes only the
// OUTPUT type, not the Measurement_Engine inputs (Requirement 1.1). The report
// is composed by `composeEvaluationReport` (the sole report producer) and
// recorded by `evaluateAndRecordReport` (src/kill-gate/verdict.ts).
//
// The split dates are a COMMITTED CONSTANT ({@link SHAPE_ONLY_OOS_SPLIT}), not a
// runtime-derived moving value (Requirement 2.3): the first recorded evaluation
// and every re-run measure the same fixed out-of-sample window.
//
// Sample-size honesty (Requirement 2.5): the composed report's
// `uncertainty.note` already carries an explicit LOW-N caveat when the matched
// subset is below `GATE1_SAMPLE_SIZE_FLOOR` (30); the Living-Docs entry surfaces
// that note verbatim, so a thin read is recorded with its limitation stated
// rather than fabricated or withheld.
//
// Secret confidentiality (parent Req 6.2, 6.3): the Supabase `Secret_Key` is
// NEVER logged. The structured logs carry only non-secret references.
//
// ☁️ OPERATIONAL SAFETY: this module only BUILDS the entry point and is
// unit-testable with injected in-memory fixtures (no network). Executing it
// against the live backfilled history / hosted DB is an OPERATOR action (the ☁️
// step of task 2.2) and is NOT performed autonomously.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { PipelineStores } from "../../pipeline/index.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import { CsvLoader } from "../../csv-loader/csvLoader.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import {
  buildFoldInputs,
  hasBacktestData,
} from "../../staged-runner/stagedRunner.js";
import type { StagedRunnerDeps } from "../../staged-runner/types.js";
import { evaluateAndRecordReport } from "../../kill-gate/verdict.js";
import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type EvaluationReport,
  type EvaluationReportStore,
  type EvaluationSplit,
} from "../../kill-gate/types.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import {
  SupabaseRestClient,
  buildSupabaseStores,
  buildSupabaseEvaluationReportStore,
} from "../../storage/supabase/index.js";
import { assertHostedHeavyOpAllowed } from "../../storage/supabaseConfig.js";

/**
 * The config id recorded on the first-evaluation report. The spec's first
 * recorded evaluation is the SHAPE-ONLY pattern approach (Requirement 2.1).
 */
export const SHAPE_ONLY_CONFIG_ID = "shape-only" as const;

/**
 * The FIXED, recorded chronological out-of-sample split the shape-only
 * evaluation is measured over (Requirement 2.3). It is a COMMITTED CONSTANT —
 * not derived from the data at runtime — so the first recorded evaluation and
 * any re-run measure the SAME out-of-sample window; a re-run with different
 * split dates would be a different (rejected) request, not a silent change of
 * the recorded dates. The train window strictly precedes the test window,
 * preserving look-ahead safety.
 *
 * The window follows the design's ~3-year train / ~1-year test walk-forward
 * scheme: a 2024 calendar-year out-of-sample test over the five pairs' daily
 * history, with the training history ending the last trading day of 2023.
 */
export const SHAPE_ONLY_OOS_SPLIT: EvaluationSplit = {
  trainEnd: "2023-12-29",
  testStart: "2024-01-02",
  testEnd: "2024-12-31",
} as const;

/**
 * The default repository `data/` directory holding the five `*_D1.csv`
 * CSV_Candle_Files. Resolved relative to this module so it is correct whether
 * run from `src/` (ts) or `dist/` (built): `.../src/ops/evaluation-run` → repo
 * root → `data`. Mirrors `gate-run/main.ts`.
 */
function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "data");
}

/**
 * The base directory the default {@link FsDocStore} writes the Research_Log
 * (`RESEARCH-LOG.md`) under. In the Cloud Run Job the image runs as the
 * unprivileged `node` user and the process cwd is not writable, so resolving the
 * Research_Log under a writable directory (`EVALUATION_RUN_DOCS_DIR`, else the OS
 * temp dir) keeps the required append working. Mirrors `gate-run/main.ts`.
 */
function researchLogBaseDir(): string {
  const configured = process.env.EVALUATION_RUN_DOCS_DIR;
  return configured !== undefined && configured.length > 0
    ? configured
    : tmpdir();
}

/**
 * The outcome of an evaluation run. On a successful compose+record it carries
 * the composed {@link EvaluationReport} and its generated `reportId`. When the
 * backtest prerequisite (stored candles + vectors) is absent it reports
 * `recorded: false` with the missing prerequisite — the report is NOT fabricated
 * (Requirement 2.5).
 */
export type EvaluationRunResult =
  | {
      readonly recorded: true;
      readonly report: EvaluationReport;
      readonly reportId: string;
    }
  | { readonly recorded: false; readonly missingPrerequisite: string };

/**
 * Injectable collaborators for {@link runEvaluation}. Every field is optional
 * with a hosted/default resolution so the entry runs live with no arguments, yet
 * a unit test can inject in-memory fixtures to exercise it WITHOUT any network.
 * No field carries a secret value.
 */
export interface EvaluationRunDeps {
  /** Resolved scheduled-run config (hosted Supabase + Decision_Date). */
  readonly config?: ScheduledRunConfig;
  /** The three pipeline storage PORTs (candle/vector/analogue). */
  readonly stores?: PipelineStores;
  /** The evaluation report store. Defaults to the Supabase adapter (hosted). */
  readonly reportStore?: EvaluationReportStore;
  /** Injectable `fetch` passed to the Supabase builders. */
  readonly fetchImpl?: typeof fetch;
  /** The data directory holding the CSV_Candle_Files. Defaults to repo `data/`. */
  readonly dataDir?: string;
  /** Living-Docs writer for the Research_Log append. Defaults to a repo FsDocStore. */
  readonly docs?: LivingDocs;
  /** Config id recorded on the report. Defaults to {@link SHAPE_ONLY_CONFIG_ID}. */
  readonly configId?: string;
  /** The fixed OOS split. Defaults to {@link SHAPE_ONLY_OOS_SPLIT}. */
  readonly split?: EvaluationSplit;
}

/**
 * Run the one-shot evaluation: resolve config → build hosted pipeline + report
 * stores sharing ONE client → build the fold inputs from stored data via the
 * SHARED `buildFoldInputs` → compose the {@link EvaluationReport} over the fixed
 * split and record it (persist + Research_Log append) via
 * `evaluateAndRecordReport`. `composeEvaluationReport` remains the sole report
 * producer; this entry re-implements no measurement math.
 *
 * When the backtest prerequisite is absent (no stored candles/vectors) it
 * returns `{ recorded: false, missingPrerequisite }` — it does NOT fabricate a
 * report (Requirement 2.5).
 *
 * Collaborators are injectable so this is unit-testable without a live network;
 * the LIVE execution against hosted Supabase is an OPERATOR action (the ☁️ step).
 */
export async function runEvaluation(
  deps: EvaluationRunDeps = {},
): Promise<EvaluationRunResult> {
  const config = deps.config ?? loadScheduledRunConfig();

  // One shared client so the pipeline stores and the report store reach storage
  // through the same connection (URL + key + fetch). When the caller injects all
  // stores (tests), no client is built and no network is touched.
  const needsHostedStores =
    deps.stores === undefined || deps.reportStore === undefined;

  // Deploy-safety: the evaluation backtest reads the full pattern_vectors /
  // analogue_outcomes history and must NOT accidentally sweep the hosted
  // free-plan project (egress/log quota). Hard-refuse hosted unless the operator
  // explicitly opted in. Only relevant when real hosted stores would be built —
  // when the caller injects all stores (tests use in-memory fixtures), no hosted
  // read happens, so the guard is skipped.
  if (needsHostedStores) {
    assertHostedHeavyOpAllowed(config.supabase, "evaluation-run backtest");
  }
  const sharedClient = needsHostedStores
    ? makeSharedClient(config, deps.fetchImpl)
    : undefined;

  const stores =
    deps.stores ?? buildSupabaseStores(config.supabase, deps.fetchImpl);
  const reportStore =
    deps.reportStore ??
    (sharedClient !== undefined
      ? buildSupabaseEvaluationReportStore(sharedClient)
      : buildSupabaseEvaluationReportStore(config.supabase, deps.fetchImpl));

  const ingestion = new OhlcIngestion(stores.candleStore);
  const csvLoader = new CsvLoader(ingestion);
  const dataDir = deps.dataDir ?? defaultDataDir();
  const docs = deps.docs ?? new LivingDocs(new FsDocStore(researchLogBaseDir()));
  const configId = deps.configId ?? SHAPE_ONLY_CONFIG_ID;
  const split = deps.split ?? SHAPE_ONLY_OOS_SPLIT;

  console.log(
    JSON.stringify({
      event: "evaluation_run.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
      configId,
      split,
    }),
  );

  // Assemble the staged-runner deps the fold-builder reads from: just the read-side
  // stores, the CSV loader and the data dir.
  const runnerDeps: StagedRunnerDeps = {
    csvLoader,
    ingestion,
    candleStore: stores.candleStore,
    vectorStore: stores.vectorStore,
    analogueStore: stores.analogueStore,
    dataDir,
  };

  // Prerequisite: stored candles + vectors must exist (the backfill/seed must
  // have run). Absent → report the gap, do NOT fabricate a report (Req 2.5).
  if (!(await hasBacktestData(runnerDeps))) {
    const missingPrerequisite =
      "evaluation: no candles or pattern vectors stored — run the backfill/seed first";
    console.error(
      JSON.stringify({ event: "evaluation_run.incomplete", missingPrerequisite }),
    );
    return { recorded: false, missingPrerequisite };
  }

  const { foldInputs } = await buildFoldInputs(runnerDeps);

  // Compose + persist + append — all through the single report-path orchestrator.
  const { report, reportId } = await evaluateAndRecordReport({
    configId,
    folds: foldInputs,
    split,
    store: reportStore,
    docs,
  });

  const belowFloor = report.sampleSize < GATE1_SAMPLE_SIZE_FLOOR;
  console.log(
    JSON.stringify({
      event: "evaluation_run.recorded",
      reportId,
      sampleSize: report.sampleSize,
      predictionsCount: report.predictionsCount,
      // Surface the sample-size honesty flag so operators see a LOW-N read as
      // such (Req 2.5); the recorded Research_Log note carries the full caveat.
      belowSampleFloor: belowFloor,
    }),
  );

  return { recorded: true, report, reportId };
}

/**
 * Build the shared {@link SupabaseRestClient} the hosted pipeline + report store
 * reuse. Omitting `fetchImpl` lets the client default to the Node 22 built-in
 * `fetch`; a stub can be injected in tests so no network is required.
 */
function makeSharedClient(
  config: ScheduledRunConfig,
  fetchImpl?: typeof fetch,
): SupabaseRestClient {
  return fetchImpl === undefined
    ? new SupabaseRestClient(config.supabase)
    : new SupabaseRestClient(config.supabase, fetchImpl);
}

/**
 * Entry wrapper mirroring `gate-run/main.ts`: resolve config, run the evaluation,
 * and emit a secret-free completion log. Delegates all work to {@link runEvaluation}.
 */
export async function main(): Promise<void> {
  const result = await runEvaluation();
  if (!result.recorded) {
    console.error(
      JSON.stringify({
        event: "evaluation_run.incomplete",
        missingPrerequisite: result.missingPrerequisite,
      }),
    );
    process.exitCode = 1;
  }
}

/**
 * True iff this module is the process entry point, so importing it (e.g. from a
 * test) does NOT start a run. Mirrors the direct-invocation guard of `gate-run`.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "evaluation_run.error", message }));
    process.exitCode = 1;
  });
}
