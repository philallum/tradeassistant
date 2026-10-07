// Hosted Backfill Execution — thin entry seam + pure coverage predicate
// (task 10.1, spec Req 7.3, 7.5; design Component 8).
//
// Hosted_Candle_Seeding runs the EXISTING `StagedRunner.backfill("backfill")`
// with its `PipelineStores` bound to the Supabase adapters via
// `buildSupabaseStores(supabase)` (design Component 3), so candles and pattern
// vectors land in the hosted backend. This module re-implements NO ingestion,
// encoding, or storage logic — it only WIRES the existing pieces and reads the
// coverage summary back.
//
// Everything is injectable (stores, fetch, dataDir, config, docs, loader) so the
// seam is unit-testable WITHOUT a live network; the defaults resolve the hosted
// Supabase connection and the repo `data/` directory for the live run (task
// 10.3). The Supabase `Secret_Key` is never logged or echoed (spec Req 7.6).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { PipelineStores } from "../../pipeline/index.js";
import { PAIRS } from "../../ingestion/types.js";
import type { PerPairCoverage } from "../../ingestion/types.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import { CsvLoader } from "../../csv-loader/csvLoader.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { backfill } from "../../staged-runner/stagedRunner.js";
import type { StagedRunnerDeps } from "../../staged-runner/types.js";
import {
  InMemoryGateVerdictStore,
  type GateVerdictStore,
} from "../../kill-gate/types.js";
import {
  InMemoryFeatureRegistryStore,
  type FeatureRegistryStore,
} from "../../feature-registry/types.js";
import type {
  PairEvaluationLoader,
  DashboardViewPersister,
} from "../../scheduled-run/scheduledRun.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import { buildSupabaseStores } from "../../storage/supabase/index.js";
import type { HostedBackfillResult } from "./types.js";

/**
 * The pure seeding-complete predicate (spec Req 7.5; design Property 25).
 *
 * Returns true IF AND ONLY IF every one of the five {@link PAIRS} has a coverage
 * entry with a non-zero stored candle count. A pair that is MISSING from
 * `coverage`, or present with `count <= 0`, yields false. Performs NO I/O — it
 * is a pure function of the coverage summary, so it is unit- and property-
 * testable in isolation (task 10.2 / Property 25).
 *
 * @param coverage The per-pair coverage summary read back after seeding.
 */
export function isBackfillComplete(
  coverage: readonly PerPairCoverage[],
): boolean {
  return PAIRS.every((pair) => {
    const entry = coverage.find((c) => c.pair === pair);
    return entry !== undefined && entry.count > 0;
  });
}

/**
 * The default repository `data/` directory holding the five `*_D1.csv`
 * CSV_Candle_Files. Resolved relative to this module so it is correct whether
 * run from `src/` (ts) or `dist/` (built): `.../src/ops/hosted-backfill` →
 * repo root → `data`.
 */
function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <repo>/src/ops/hosted-backfill  → up three levels to <repo>.
  return join(here, "..", "..", "..", "data");
}

/**
 * A no-op {@link PairEvaluationLoader}. The Backfill_Stage never calls the
 * evaluation loader (that is the Forward_Look_Stage's collaborator), but
 * {@link StagedRunnerDeps} requires the field; this default keeps the seam
 * backfill-only without wiring the full pipeline. It is never invoked here.
 */
const noopEvaluationLoader: PairEvaluationLoader = () => Promise.resolve([]);

/**
 * Injectable collaborators for {@link runHostedBackfill}. Every field is
 * optional with a hosted/default resolution so the seam runs live with no
 * arguments, yet a unit test can inject in-memory/stub collaborators to exercise
 * it WITHOUT any network. No field carries a secret value.
 */
export interface HostedBackfillDeps {
  /**
   * The resolved scheduled-run configuration (carries the hosted
   * {@link ScheduledRunConfig.supabase} connection + Decision_Date). Defaults to
   * {@link loadScheduledRunConfig} over `process.env` (resolves the hosted
   * Supabase connection over the IPv4 pooler/REST endpoint).
   */
  readonly config?: ScheduledRunConfig;
  /**
   * The three storage PORTs. Defaults to `buildSupabaseStores(config.supabase)`
   * (hosted). Inject in-memory stores to test without a backend.
   */
  readonly stores?: PipelineStores;
  /**
   * Injectable `fetch` passed to {@link buildSupabaseStores} when `stores` is
   * not supplied — tests inject a stub so no network is required.
   */
  readonly fetchImpl?: typeof fetch;
  /** The data directory holding the CSV_Candle_Files. Defaults to repo `data/`. */
  readonly dataDir?: string;
  /** Living-Docs writer (used by later stages). Defaults to a repo FsDocStore. */
  readonly docs?: LivingDocs;
  /** Kill-gate config id recorded on verdicts (unused by backfill). */
  readonly configId?: string;
  /**
   * GateVerdictStore PORT (unused by backfill); defaults to an in-memory
   * reference since the Backfill_Stage never persists a verdict.
   */
  readonly gateVerdictStore?: GateVerdictStore;
  /**
   * FeatureRegistryStore PORT (unused by backfill); defaults to an in-memory
   * reference since the Backfill_Stage never writes the feature registry.
   */
  readonly featureRegistryStore?: FeatureRegistryStore;
  /** Evaluation loader (unused by backfill); defaults to a no-op. */
  readonly loadEvaluations?: PairEvaluationLoader;
  /** Optional view persister (unused by backfill). */
  readonly persistView?: DashboardViewPersister;
}

/**
 * Run Hosted_Candle_Seeding (spec Req 7.3, 7.5): execute the EXISTING
 * `StagedRunner.backfill("backfill")` against the hosted Supabase stores, then
 * read the per-pair coverage summary back and compute the pure
 * {@link isBackfillComplete} verdict.
 *
 * This re-implements NO ingestion/encoding/storage logic — it only assembles a
 * {@link StagedRunnerDeps} from existing pieces (the three Supabase stores plus
 * a {@link CsvLoader}/{@link OhlcIngestion} wired to the hosted `candleStore`,
 * the data dir, a {@link LivingDocs}, and the config) and calls the existing
 * free `backfill` function. Collaborators are injectable so this is
 * unit-testable without a live network (task 10.1); the LIVE run against hosted
 * Supabase is task 10.3.
 *
 * The Supabase `Secret_Key` is never logged or echoed; the returned
 * {@link HostedBackfillResult} carries only non-secret coverage counts/dates
 * (spec Req 7.6).
 *
 * @param deps Optional injected collaborators/overrides (see
 *             {@link HostedBackfillDeps}).
 */
export async function runHostedBackfill(
  deps: HostedBackfillDeps = {},
): Promise<HostedBackfillResult> {
  const config = deps.config ?? loadScheduledRunConfig();

  // Bind the three storage PORTs to the hosted Supabase backend (design
  // Component 3) unless the caller injected its own stores.
  const stores =
    deps.stores ?? buildSupabaseStores(config.supabase, deps.fetchImpl);

  // Wire the existing ingestion + CsvLoader to the hosted candleStore. NO
  // ingestion/encoding logic is re-implemented — OhlcIngestion and CsvLoader
  // own validity, dedup, normalization, and parsing.
  const ingestion = new OhlcIngestion(stores.candleStore);
  const csvLoader = new CsvLoader(ingestion);

  const dataDir = deps.dataDir ?? defaultDataDir();
  const docs = deps.docs ?? new LivingDocs(new FsDocStore());

  const runnerDeps: StagedRunnerDeps = {
    csvLoader,
    ingestion,
    candleStore: stores.candleStore,
    vectorStore: stores.vectorStore,
    analogueStore: stores.analogueStore,
    gateVerdictStore: deps.gateVerdictStore ?? new InMemoryGateVerdictStore(),
    featureRegistryStore:
      deps.featureRegistryStore ?? new InMemoryFeatureRegistryStore(),
    dataDir,
    docs,
    config,
    loadEvaluations: deps.loadEvaluations ?? noopEvaluationLoader,
    ...(deps.persistView !== undefined ? { persistView: deps.persistView } : {}),
    configId: deps.configId ?? "hosted-backfill",
  };

  // Run the EXISTING Backfill_Stage with Data_Source_Role = "backfill"
  // (spec Req 7.3). No forked logic.
  const result = await backfill(runnerDeps, "backfill");

  // Read the per-pair coverage summary back from the hosted candleStore and
  // compute the pure completion verdict (spec Req 7.5). Record only non-secret
  // references (counts + dates) — never the Supabase key (spec Req 7.6).
  const coverage = await ingestion.coverageSummary();

  return {
    result,
    coverage,
    complete: isBackfillComplete(coverage),
  };
}
