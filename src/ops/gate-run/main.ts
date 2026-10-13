// Container entry point for the one-shot hosted GATE run (Feature:
// dashboard-data-activation, task 8.1; design Component 6).
//
// This is the runnable script a Cloud Run Job executes once to evaluate the
// two-stage Kill_Gate over the ALREADY-SEEDED hosted walk-forward folds and
// RECORD the resulting verdicts in the hosted backend. Its purpose is to close
// the activation gap: the seed run (`src/ops/seed-run/main.ts`) populates
// `candles` / `pattern_vectors` / `analogue_outcomes`, but nothing yet drives
// the EXISTING Backtest_Stage against that hosted data to persist a
// `gate_verdicts` PASS — so the `GatePassingResolver` finds no recorded PASS and
// no pair fires. The Gate_Run runs that Backtest_Stage against the hosted stores
// so composed verdicts land in the hosted backend.
//
// It contains NO gate math of its own — Gate 1 / Gate 2 evaluation and
// `composeGateVerdict` are design Component 4, reached entirely through the
// EXISTING `backtest` stage of `src/staged-runner/stagedRunner.ts`. This module
// only WIRES that stage to the hosted stores (mirroring the structure of
// `src/ops/seed-run/main.ts` and `src/ops/hosted-backfill/hostedBackfill.ts`):
//
//   loadScheduledRunConfig()
//     → buildSupabaseStores(config.supabase)        (candle/vector/analogue)
//     + buildSupabaseGateStores(<shared client>)    (gate-verdict)
//       sharing ONE SupabaseRestClient
//     → backtest(deps)  — composeGateVerdict per config → persistGateVerdict
//       + logGateVerdict
//
// `composeGateVerdict` remains the SOLE verdict producer; nothing here
// re-implements, re-evaluates, or re-composes any verdict. `persistGateVerdict`
// / `logGateVerdict` live inside the existing Backtest_Stage; this entry
// supplies the hosted stores and reports non-secret references.
//
// Secret confidentiality (design Component 6; parent Req 6.2, 6.3): the Supabase
// `Secret_Key` is NEVER logged. The structured logs carry only non-secret
// references — the Decision_Date, the Supabase target label and REST URL, the
// kill-gate config id, and the stage result.
//
// This module only BUILDS the entry point; wiring a Cloud Run Job / deploy is a
// later LIVE step (task 10).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { PipelineStores } from "../../pipeline/index.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import { CsvLoader } from "../../csv-loader/csvLoader.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { backtest } from "../../staged-runner/stagedRunner.js";
import type {
  StagedRunnerDeps,
  StageResult,
} from "../../staged-runner/types.js";
import type { GateVerdictStore } from "../../kill-gate/types.js";
import type {
  PairEvaluationLoader,
  DashboardViewPersister,
} from "../../scheduled-run/scheduledRun.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import {
  SupabaseRestClient,
  buildSupabaseStores,
  buildSupabaseGateStores,
} from "../../storage/supabase/index.js";
import { assertHostedHeavyOpAllowed } from "../../storage/supabaseConfig.js";

/**
 * The default kill-gate config id recorded on the verdicts produced by the
 * Gate_Run when the caller supplies none. The Backtest_Stage composes one
 * aggregate verdict per `configId`.
 */
const DEFAULT_GATE_RUN_CONFIG_ID = "gate-run";

/**
 * Resolve the kill-gate `config_id` the Gate_Run records on its composed
 * verdict when the caller injects none, allowing a deployed Cloud Run Job to
 * parameterise the recorded `config_id` WITHOUT a code change or rebuild per
 * run (the Job is executed once per pair with `GATE_RUN_CONFIG_ID` overridden).
 *
 * This matters for the daily `GatePassingResolver`, which reads the latest PASS
 * for a pair's active config named `` `${pair}-active` `` (design Component 5).
 * A verdict recorded under the bare default `"gate-run"` would match no pair's
 * active config, so the resolver would return `false` for every pair and
 * nothing would fire. Driving the Job once per pair with
 * `GATE_RUN_CONFIG_ID=<PAIR>-active` records the (aggregate) PASS under a
 * `config_id` the resolver reads.
 *
 * This is pure wiring: it only selects the non-secret `config_id` label stamped
 * on the verdict. It re-implements NO gate math — `composeGateVerdict` remains
 * the sole verdict producer, and the fold inputs are independent of this label.
 * Falls back to {@link DEFAULT_GATE_RUN_CONFIG_ID} when the env var is unset or
 * empty.
 */
function resolveConfigIdFromEnv(): string {
  const configured = process.env.GATE_RUN_CONFIG_ID;
  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_GATE_RUN_CONFIG_ID;
}

/**
 * The default repository `data/` directory holding the five `*_D1.csv`
 * CSV_Candle_Files. Resolved relative to this module so it is correct whether
 * run from `src/` (ts) or `dist/` (built): `.../src/ops/gate-run` → repo root →
 * `data`. Mirrors `hostedBackfill.ts` so the Backtest_Stage's prerequisite
 * check sees the same data layout.
 */
function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <repo>/src/ops/gate-run → up three levels to <repo>.
  return join(here, "..", "..", "..", "data");
}

/**
 * The base directory the default {@link FsDocStore} writes the Research_Log
 * (`RESEARCH-LOG.md`) under. In the Cloud Run Job the image runs as the
 * unprivileged `node` user and `/app` (the process cwd, the `FsDocStore`
 * default) is not writable, so a bare `new FsDocStore()` fails with EACCES on
 * the backtest stage's `logGateVerdict` append — aborting BEFORE the verdicts
 * persist. Resolving the Research_Log under a writable directory
 * (`GATE_RUN_DOCS_DIR`, else the OS temp dir — `/tmp` in the container) keeps
 * that existing, required append (spec Req 2.5: the log is preserved) working
 * without touching the gate math or the Backtest_Stage. This only relocates a
 * non-secret diagnostic log; it introduces no gate logic.
 */
function researchLogBaseDir(): string {
  const configured = process.env.GATE_RUN_DOCS_DIR;
  return configured !== undefined && configured.length > 0
    ? configured
    : tmpdir();
}

/**
 * A no-op {@link PairEvaluationLoader}. The Backtest_Stage never calls the
 * evaluation loader (that is the Forward_Look_Stage's collaborator), but
 * {@link StagedRunnerDeps} requires the field; this default keeps the entry
 * backtest-only without wiring the full pipeline. It is never invoked here.
 */
const noopEvaluationLoader: PairEvaluationLoader = () => Promise.resolve([]);

/**
 * Injectable collaborators for {@link runGateRun}. Every field is optional with
 * a hosted/default resolution so the entry runs live with no arguments, yet a
 * unit test can inject in-memory stores to exercise it WITHOUT any network. No
 * field carries a secret value.
 */
export interface GateRunDeps {
  /**
   * The resolved scheduled-run configuration (carries the hosted
   * {@link ScheduledRunConfig.supabase} connection + Decision_Date). Defaults to
   * {@link loadScheduledRunConfig} over `process.env`.
   */
  readonly config?: ScheduledRunConfig;
  /**
   * The three pipeline storage PORTs (candle/vector/analogue). Defaults to
   * `buildSupabaseStores(config.supabase, fetchImpl)` sharing ONE client with
   * the gate stores (hosted). Inject in-memory stores to test without a backend.
   */
  readonly stores?: PipelineStores;
  /**
   * The gate-verdict store. Defaults to `buildSupabaseGateStores(<shared
   * client>)` so it shares the SAME {@link SupabaseRestClient} as `stores`.
   * Inject an in-memory reference to test.
   */
  readonly gateVerdictStore?: GateVerdictStore;
  /**
   * Injectable `fetch` passed to the Supabase builders when `stores` /
   * gate stores are not supplied — tests inject a stub so no network is
   * required.
   */
  readonly fetchImpl?: typeof fetch;
  /** The data directory holding the CSV_Candle_Files. Defaults to repo `data/`. */
  readonly dataDir?: string;
  /** Living-Docs writer for the Research_Log append. Defaults to a repo FsDocStore. */
  readonly docs?: LivingDocs;
  /** Kill-gate config id recorded on the composed verdict. */
  readonly configId?: string;
  /** Evaluation loader (unused by backtest); defaults to a no-op. */
  readonly loadEvaluations?: PairEvaluationLoader;
  /** Optional view persister (unused by backtest). */
  readonly persistView?: DashboardViewPersister;
}

/**
 * Run the one-shot hosted Gate_Run: resolve config → build hosted pipeline +
 * gate stores sharing ONE client → run the EXISTING Backtest_Stage over the
 * hosted seeded walk-forward folds. The Backtest_Stage calls
 * `composeGateVerdict` (the sole verdict producer), then `persistGateVerdict` +
 * `logGateVerdict` — all unchanged, existing logic. This entry re-implements NO
 * gate math; it only assembles the {@link StagedRunnerDeps} from existing
 * pieces and calls the existing free `backtest` function.
 *
 * Collaborators are injectable so this is unit-testable without a live network
 * (task 8.2); the LIVE build/deploy/execute against hosted Supabase is task 10.
 *
 * The Supabase `Secret_Key` is never logged or echoed; the returned
 * {@link StageResult} carries only the non-secret stage outcome.
 *
 * @param deps Optional injected collaborators/overrides (see {@link GateRunDeps}).
 */
export async function runGateRun(deps: GateRunDeps = {}): Promise<StageResult> {
  const config = deps.config ?? loadScheduledRunConfig();

  // Build ONE shared SupabaseRestClient so the pipeline stores and the gate
  // store reach storage through the same connection configuration (URL + key +
  // fetch), as the design requires (Component 3 / Component 6). The key is held
  // inside the client and never logged. When the caller injects `stores` /
  // gate store (tests), no client is built and no network is touched.
  const needsHostedStores =
    deps.stores === undefined || deps.gateVerdictStore === undefined;

  // Deploy-safety: the Backtest_Stage reads the full pattern_vectors /
  // analogue_outcomes history and must NOT accidentally sweep the hosted
  // free-plan project (egress/log quota). Hard-refuse hosted unless the operator
  // explicitly opted in. Only relevant when real hosted stores would be built —
  // when the caller injects all stores (tests), no hosted read happens.
  if (needsHostedStores) {
    assertHostedHeavyOpAllowed(config.supabase, "gate-run backtest");
  }

  const sharedClient = needsHostedStores
    ? makeSharedClient(config, deps.fetchImpl)
    : undefined;

  const stores =
    deps.stores ?? buildSupabaseStores(config.supabase, deps.fetchImpl);

  const gateStores = buildGateStores(
    sharedClient,
    config,
    deps.fetchImpl,
    deps.gateVerdictStore,
  );

  const ingestion = new OhlcIngestion(stores.candleStore);
  const csvLoader = new CsvLoader(ingestion);
  const dataDir = deps.dataDir ?? defaultDataDir();
  const docs = deps.docs ?? new LivingDocs(new FsDocStore(researchLogBaseDir()));
  const configId = deps.configId ?? resolveConfigIdFromEnv();

  // Structured, secret-free startup log. The Supabase key is never logged.
  console.log(
    JSON.stringify({
      event: "gate_run.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
      configId,
    }),
  );

  const runnerDeps: StagedRunnerDeps = {
    csvLoader,
    ingestion,
    candleStore: stores.candleStore,
    vectorStore: stores.vectorStore,
    analogueStore: stores.analogueStore,
    gateVerdictStore: gateStores.gateVerdictStore,
    dataDir,
    docs,
    config,
    loadEvaluations: deps.loadEvaluations ?? noopEvaluationLoader,
    ...(deps.persistView !== undefined ? { persistView: deps.persistView } : {}),
    configId,
  };

  // Run the EXISTING Backtest_Stage against the hosted (seeded) stores. All gate
  // math, verdict composition, persistence, and logging live inside this
  // existing stage (design Component 4). A missing prerequisite (no stored
  // candles/vectors) is surfaced via `ok: false`.
  const result = await backtest(runnerDeps);

  console.log(
    JSON.stringify({
      event: "gate_run.backtest_complete",
      ok: result.ok,
      ...(result.ok ? {} : { missingPrerequisite: result.missingPrerequisite }),
    }),
  );

  return result;
}

/**
 * Build the shared {@link SupabaseRestClient} the hosted pipeline + gate stores
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
 * Resolve the gate-verdict store. When the caller injected it, that is used
 * verbatim (tests). Otherwise `buildSupabaseGateStores` constructs it — from
 * the SHARED client when available (so it shares the pipeline stores' client),
 * else from the config.
 */
function buildGateStores(
  sharedClient: SupabaseRestClient | undefined,
  config: ScheduledRunConfig,
  fetchImpl: typeof fetch | undefined,
  injectedVerdictStore: GateVerdictStore | undefined,
): { readonly gateVerdictStore: GateVerdictStore } {
  if (injectedVerdictStore !== undefined) {
    return { gateVerdictStore: injectedVerdictStore };
  }
  const built =
    sharedClient !== undefined
      ? buildSupabaseGateStores(sharedClient)
      : buildSupabaseGateStores(config.supabase, fetchImpl);
  return { gateVerdictStore: built.gateVerdictStore };
}

/**
 * Entry wrapper mirroring `seed-run/main.ts`: resolve config, run the Gate_Run,
 * and emit a secret-free completion log. Delegates all work to {@link runGateRun}.
 */
export async function main(): Promise<void> {
  const result = await runGateRun();
  if (!result.ok) {
    // A missing prerequisite is a non-secret, operationally meaningful outcome:
    // surface it as a failure so the Job reports non-success.
    console.error(
      JSON.stringify({
        event: "gate_run.incomplete",
        missingPrerequisite: result.missingPrerequisite,
      }),
    );
    process.exitCode = 1;
  }
}

/**
 * True iff this module is the process entry point (invoked as
 * `node .../gate-run/main.js`), so importing it (e.g. from a test) does NOT
 * start a run. Mirrors the direct-invocation guard pattern of `seed-run/main.ts`.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Secret-free failure log — only the (non-secret) error message.
    console.error(JSON.stringify({ event: "gate_run.error", message }));
    process.exitCode = 1;
  });
}
