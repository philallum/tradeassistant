// Container entry point for the GCP-scheduled daily refresh (Requirement 16.7).
//
// This is the runnable script the Cloud Run Job executes to completion once per
// day (triggered by Cloud Scheduler). It:
//   1. reads its runtime configuration from the environment — non-secret config
//      (project/region/model/decision date) from plain env vars and the secret
//      Supabase URL/keys that Cloud Run injects from Google Secret Manager;
//   2. resolves the Supabase connection over the IPv4-reachable pooler/REST
//      endpoint (Cloud Run has no IPv6 egress, so the IPv6-only direct DB host
//      is never used);
//   3. SKIPS non-trading days (Sat/Sun) so exactly one run is produced per
//      trading day (Requirement 4; the dashboard is a weekday session product);
//   4. invokes the SAME deterministic `runScheduledDaily` → `dailyRun` path the
//      local dashboard uses, then persists the firing view; and
//   5. BESIDE the firing view, produces the OUTWARD-ONLY display values for the
//      Decision_Date — the AI `signal_rationale` / `pattern_description`
//      narrative (Requirement 15) and the third-party external cross-reference
//      comparison (Requirement 23) — and carries them in the `dashboard.json`
//      snapshot (their dedicated DB tables are dropped under
//      simplify-to-cloud-minimal). These are display-only and never feed scoring.
//
// It contains NO firing logic of its own; all business logic lives in the
// shared modules so an unattended run reproduces an equivalent local run.

import { fileURLToPath } from "node:url";

import { loadScheduledRunConfig } from "./config.js";
import type { PairEvaluationLoader, DashboardViewPersister } from "./scheduledRun.js";
import { runScheduledDaily } from "./scheduledRun.js";
import { runCandleFreshnessStage, type CandleFreshnessDeps } from "./candleFreshness.js";
import { resolveMaxLookback } from "./candleGap.js";
import { makePipelineLoader } from "../pipeline/index.js";
import {
  buildSupabaseStores,
  makeSupabaseViewPersister,
  type DisplayOnlyWrite,
} from "../storage/supabase/index.js";
import type { PairEvaluation, DashboardView } from "../dashboard/index.js";
import { isTradingDay } from "../guard/tradingDate.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import {
  ohlcFeedConfigFromEnv,
  buildProviderChain,
} from "../ingestion/ohlcFeed/index.js";
import { LlmInterface, GeminiLlmProvider, InMemoryRoleRejectionRecorder } from "../llm/index.js";
import {
  externalSignalConfigFromEnv,
  FcsExternalSignalProvider,
  type ExternalSignalConfig,
} from "../external-signal/index.js";
import { resolveAccessTokenProvider } from "./accessToken.js";
import { buildDisplayOnly, type DisplayOnlyDeps } from "./displayOnly.js";
import {
  buildDashboardSnapshot,
  writeDashboardSnapshot,
  type SnapshotSink,
} from "./snapshot.js";
import { makeGcsSnapshotSink } from "./gcsSnapshotSink.js";

/**
 * Load the deterministic per-pair evaluations for the Decision_Date by running
 * the wired end-to-end pipeline (task 11.1) over the Supabase-backed storage
 * ports. Because the pipeline is a pure function of the stored inputs, this
 * reproduces an equivalent local run (Requirement 16.7).
 *
 * The loader is wrapped by {@link cachingLoader} below so the SAME evaluations
 * the view was built from are available to the display-only producer (the
 * third-party cross-reference needs each pair's own Direction_Class).
 *
 * The gate auto-block has been removed (design Decision 1, C2): the daily run no
 * longer reads recorded PASS verdicts to gate firing, so no gate-verdict adapter
 * is wired into the pipeline here.
 */
export const loadEvaluations: PairEvaluationLoader = (decisionDate, supabase) => {
  return makePipelineLoader(buildSupabaseStores(supabase))(decisionDate, supabase);
};

/**
 * Wrap a loader so the last-loaded evaluations are captured. `runScheduledDaily`
 * calls the loader once and hands the view (not the evaluations) to the
 * persister; capturing them here lets the persister build the display-only
 * cross-reference from the exact same deterministic evaluations.
 */
function cachingLoader(
  inner: PairEvaluationLoader,
): { loader: PairEvaluationLoader; get(): readonly PairEvaluation[] } {
  let last: readonly PairEvaluation[] = [];
  return {
    loader: async (decisionDate, supabase) => {
      last = await inner(decisionDate, supabase);
      return last;
    },
    get: () => last,
  };
}

/**
 * Build the optional display-only collaborators from the environment:
 *   - the Gemini-backed {@link LlmInterface} when `GEMINI_MODEL` + GCP
 *     project/region are configured (auth via ADC / metadata token), and
 *   - the FCS {@link ExternalSignalProvider} when `EXTERNAL_SIGNAL_PROVIDER`
 *     resolves a config with an API key.
 * Each is independent and optional; an unconfigured producer is simply skipped,
 * leaving the firing view and the deterministic path untouched.
 */
async function buildDisplayDeps(
  config: ReturnType<typeof loadScheduledRunConfig>,
): Promise<DisplayOnlyDeps> {
  const deps: { -readonly [K in keyof DisplayOnlyDeps]: DisplayOnlyDeps[K] } = {};

  // AI narrative (Requirement 15): wire the real Gemini backend behind the
  // single LlmInterface gateway when a model + project/region are configured.
  if (config.geminiModel !== undefined && config.gcpProject !== undefined && config.gcpRegion !== undefined) {
    try {
      const tokens = await resolveAccessTokenProvider();
      const provider = new GeminiLlmProvider(
        { project: config.gcpProject, location: config.gcpRegion, model: config.geminiModel },
        tokens,
      );
      deps.llm = new LlmInterface({ provider, rejectionRecorder: new InMemoryRoleRejectionRecorder() });
    } catch (err) {
      logStartupWarning("gemini", err);
    }
  }

  // Third-party cross-reference (Requirement 23): wire the FCS adapter when the
  // external-signal env contract resolves a provider with an API key.
  const externalConfig: ExternalSignalConfig | null = externalSignalConfigFromEnv(process.env);
  if (externalConfig !== null && externalConfig.apiKey !== undefined) {
    try {
      deps.externalProvider = new FcsExternalSignalProvider(externalConfig);
      deps.externalConfig = externalConfig;
    } catch (err) {
      logStartupWarning("external_signal", err);
    }
  }

  return deps;
}

/**
 * Resolve the destination sink for the `dashboard.json` snapshot
 * (simplify-to-cloud-minimal R5.1, R5.2).
 *
 * Under the public-data decision (Option A), the snapshot is published to a
 * PUBLIC-READ GCS bucket the hosted SPA fetches cross-origin. When the
 * non-secret `DASHBOARD_SNAPSHOT_BUCKET` env var names that bucket, this returns
 * the GCS uploader built with the SAME injected access-token provider the Gemini
 * adapter uses (the runtime SA's metadata token in Cloud Run, local ADC
 * otherwise) — NO new auth mechanism. When the var is UNSET (local/dev runs with
 * no bucket), it returns `undefined`, so {@link writeDashboardSnapshot} logs a
 * secret-free "no destination configured" no-op and the run completes cleanly.
 * Either way the snapshot step stays fail-safe by construction: a failing upload
 * is logged+swallowed and can never corrupt the persisted rows.
 */
async function resolveSnapshotSink(
  config: ReturnType<typeof loadScheduledRunConfig>,
): Promise<SnapshotSink | undefined> {
  const bucket = config.dashboardSnapshotBucket;
  if (bucket === undefined) {
    return undefined;
  }
  try {
    const tokens = await resolveAccessTokenProvider();
    return makeGcsSnapshotSink({ bucket, tokens });
  } catch (err) {
    // A failure resolving the token provider must not break the run: degrade to
    // the no-op sink (the snapshot step is best-effort). Logged secret-free.
    logStartupWarning("snapshot_sink", err);
    return undefined;
  }
}

/** Structured, secret-free warning for an optional-collaborator wiring failure. */
function logStartupWarning(collaborator: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    JSON.stringify({ event: "scheduled_run.startup_warning", collaborator, message }),
  );
}

/**
 * Injectable seam for {@link freshenCandles} so the wiring is unit-testable with
 * no live network. Production defaults build the real Supabase-backed stores and
 * drive {@link runCandleFreshnessStage}; a test injects an in-memory
 * `buildStores` and/or a `runStage` spy to assert the stage is (not) run and
 * that a thrown error is caught.
 */
export interface FreshenCandlesDeps {
  /** Build the candle/vector stores for the stage. Defaults to the Supabase stores. */
  readonly buildStores?: (
    config: ReturnType<typeof loadScheduledRunConfig>,
  ) => Pick<ReturnType<typeof buildSupabaseStores>, "candleStore" | "vectorStore">;
  /** Run the freshness stage. Defaults to {@link runCandleFreshnessStage}. */
  readonly runStage?: (stageDeps: CandleFreshnessDeps) => Promise<unknown>;
  /** Env map the OHLC-feed config + lookback are read from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Candle_Freshness_Stage wiring (design Component 6, R2.1): bring each pair's
 * candles up to the most recent Completed_Trading_Day BEFORE the deterministic
 * pipeline reads history. Must run after the weekday gate and before
 * `runScheduledDaily` (which reads candle history inside the pipeline loader).
 *
 * FAIL-SAFE (R4.1): the whole stage is wrapped in a `try/catch` that routes any
 * error — including an unexpected store-construction failure — through the
 * secret-free {@link logStartupWarning}. A stage error NEVER crashes the Job; the
 * run then proceeds on the pair's existing history. (`runCandleFreshnessStage`
 * already avoids throwing on provider failures; the try/catch covers the rest.)
 *
 * When NO OHLC feed provider key is configured (`providers.length === 0`), the
 * stage is skipped with a secret-free warning and the run proceeds (R1.5). No
 * key value is ever logged.
 */
export async function freshenCandles(
  config: ReturnType<typeof loadScheduledRunConfig>,
  deps: FreshenCandlesDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const runStage = deps.runStage ?? runCandleFreshnessStage;
  const buildStores =
    deps.buildStores ?? ((c) => buildSupabaseStores(c.supabase));

  try {
    const chainConfig = ohlcFeedConfigFromEnv(env);

    // `ohlcFeedConfigFromEnv` ALWAYS returns `{ providers: [] }` (never null);
    // an empty list means no provider key is present (R1.5) — skip the stage.
    if (chainConfig.providers.length === 0) {
      logStartupWarning("candle_freshness", new Error("no OHLC feed provider configured"));
      return;
    }

    console.log(
      JSON.stringify({
        event: "candle_freshness.start",
        decisionDate: config.decisionDate,
        providers: chainConfig.providers.map((p) => p.provider),
      }),
    );

    const stores = buildStores(config);
    await runStage({
      decisionDate: config.decisionDate,
      ingestion: new OhlcIngestion(stores.candleStore),
      candleStore: stores.candleStore,
      vectorStore: stores.vectorStore,
      chain: buildProviderChain(chainConfig),
      maxLookbackTradingDays: resolveMaxLookback(env),
    });

    console.log(
      JSON.stringify({
        event: "candle_freshness.complete",
        decisionDate: config.decisionDate,
      }),
    );
  } catch (err) {
    // Fail-safe (R4.1): a stage error never crashes the Job; the run proceeds on
    // existing history with a secret-free warning (no key value is logged).
    logStartupWarning("candle_freshness", err);
  }
}

/** Run the scheduled daily refresh and report the outcome, then exit. */
async function main(): Promise<void> {
  const config = loadScheduledRunConfig();

  // Structured, secret-free startup log. The Supabase key is never logged.
  console.log(
    JSON.stringify({
      event: "scheduled_run.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
      gcpProject: config.gcpProject ?? null,
      gcpRegion: config.gcpRegion ?? null,
      geminiModel: config.geminiModel ?? null,
    }),
  );

  // Weekday gating (Requirement 4): FX daily candles are a Monday-Friday
  // product, so a weekend Decision_Date has no session to evaluate. Skip
  // cleanly (exit 0) so a Saturday/Sunday scheduler trigger is a no-op rather
  // than writing a spurious weekend view. The scheduler cron is also restricted
  // to Mon-Fri; this is the defence-in-depth guard for an explicit
  // RUN_DECISION_DATE or an off-schedule invocation.
  if (!isTradingDay(config.decisionDate)) {
    console.log(
      JSON.stringify({
        event: "scheduled_run.skipped_non_trading_day",
        decisionDate: config.decisionDate,
      }),
    );
    return;
  }

  // Candle_Freshness_Stage (design Component 6, R2.1): freshen candle history up
  // to the most recent Completed_Trading_Day BEFORE `runScheduledDaily` reads it.
  // Fail-safe (R4.1): a stage error is caught inside `freshenCandles` and the run
  // proceeds on existing history.
  await freshenCandles(config);

  const displayDeps = await buildDisplayDeps(config);
  const cached = cachingLoader(loadEvaluations);

  /**
   * Persist the produced dashboard view to `firing_setups`, then — beside it —
   * build the OUTWARD-ONLY display values (AI rationale + external comparison)
   * for the Decision_Date (Req 15, 23). These are no longer written to their own
   * DB tables (the `signal_rationale` / `external_reference_comparison` tables
   * are dropped under simplify-to-cloud-minimal, design C4); their display
   * content is carried in the `dashboard.json` snapshot instead. The display
   * step stays fail-safe: a producer error degrades to no rationale / unavailable
   * reference for that pair and never prevents the firing view from being
   * persisted.
   */
  const snapshotSink = await resolveSnapshotSink(config);

  const persistView: DashboardViewPersister = async (view: DashboardView, supabase) => {
    // The persisted DB rows are the source of truth and are written FIRST.
    await makeSupabaseViewPersister(supabase)(view, supabase);

    let displayOnly: DisplayOnlyWrite | undefined;
    try {
      displayOnly = await buildDisplayOnly(view, cached.get(), displayDeps);
    } catch (err) {
      logStartupWarning("display_build", err);
      displayOnly = undefined;
    }

    // Public_Read_Path (simplify-to-cloud-minimal R5.1, R5.2): at the END of the
    // run, serialise the dashboard view + display-only writes into the
    // `dashboard.json` snapshot the hosted SPA fetches, and write it fail-safely.
    // This runs AFTER the DB rows are persisted, and the write is best-effort:
    // `writeDashboardSnapshot` logs and swallows any failure so a snapshot error
    // can never corrupt the persisted rows nor fail the run (design Error
    // Handling). History slices beyond today's view are not re-queried here; the
    // snapshot carries the produced view + display-only, and a missing slice is
    // an empty array the SPA renders as an explicit empty state (R5.5).
    const snapshot = buildDashboardSnapshot(view, displayOnly, {
      decisionDates: [view.decisionDate],
    });
    await writeDashboardSnapshot(snapshot, snapshotSink);
  };

  const result = await runScheduledDaily(config, { loadEvaluations: cached.loader, persistView });

  console.log(
    JSON.stringify({
      event: "scheduled_run.complete",
      decisionDate: result.decisionDate,
      firingCards: result.view.cards.length,
      persisted: result.persisted,
    }),
  );
}

/**
 * True iff this module is the process entry point (invoked as
 * `node .../scheduled-run/main.js`), so importing it (e.g. from a test) does NOT
 * start a run. Mirrors the direct-invocation guard pattern of the seed runner's
 * container entry (`src/ops/seed-run/main.ts`).
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event: "scheduled_run.error", message }),
    );
    process.exitCode = 1;
  });
}
