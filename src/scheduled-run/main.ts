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
import {
  runCandleFreshnessStage,
  type CandleFreshnessDeps,
  type CandleFreshnessPairSummary,
} from "./candleFreshness.js";
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
  pairEvaluationRows,
  writeDashboardSnapshot,
  type SnapshotSink,
} from "./snapshot.js";
import { loadSnapshotHistory } from "./snapshotHistory.js";
import { makeGcsSnapshotSink } from "./gcsSnapshotSink.js";
import { SupabaseRestClient } from "../storage/supabase/index.js";
import { SupabaseSignalPredictionStore } from "../storage/supabase/index.js";
import { runSignalScorecardStep } from "./signalScorecardStep.js";
import { buildSignalScorecardSlice } from "./signalScorecardSlice.js";
import { SupabaseTradeLedgerStore } from "../storage/supabase/tradeLedgerStore.js";
import { buildEdgeSlices } from "./edgeSlices.js";
import { buildConfluenceSlice } from "./confluenceSlice.js";
import { evaluatePair } from "../pipeline/dailyPipeline.js";
import { DEFAULT_PIPELINE_CONFIG } from "../pipeline/types.js";
import {
  DEFAULT_RANGE_RECORD_LOOKBACK_DAYS,
  DEFAULT_TRACK_RECORD_LOOKBACK_DAYS,
  buildTrackRecordSlice,
  memoizeMaturedOutcomes,
} from "../track-record/index.js";

/** Env var: trading-day replay window for the per-strategy track record. */
export const TRACK_RECORD_LOOKBACK_ENV = "TRACK_RECORD_LOOKBACK_DAYS" as const;
/** Env var: trading-day replay window for the expected-candle-size record (0 disables). */
export const RANGE_RECORD_LOOKBACK_ENV = "RANGE_RECORD_LOOKBACK_DAYS" as const;

/** Parse a non-negative integer env value, falling back to `fallback` on anything else. */
export function nonNegativeIntFromEnv(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

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
        {
          project: config.gcpProject,
          location: config.gcpRegion,
          model: config.geminiModel,
          // All roles this run uses are SHORT display-only prose/labels, so the
          // model's hidden "thinking" adds no value and — on a 2.5 thinking model
          // — would eat the output budget and truncate the visible answer
          // (observed: 491 thought tokens of 512, `finishReason: MAX_TOKENS`).
          // Disable thinking and give the answer a comfortable budget so the
          // daily note + rationales come back as complete sentences.
          thinkingBudget: 0,
          maxOutputTokens: 1024,
        },
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
  readonly runStage?: (
    stageDeps: CandleFreshnessDeps,
  ) => Promise<readonly CandleFreshnessPairSummary[]>;
  /** Env map the OHLC-feed config + lookback are read from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Wait between freshness attempts. Defaults to a real timer; tests inject a no-op. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Extra freshness attempts after the first when a pair is still behind. */
const DEFAULT_FRESHNESS_RETRY_ATTEMPTS = 3;
/** Seconds to wait between freshness attempts (> FCS's 60s batch memo). */
const DEFAULT_FRESHNESS_RETRY_DELAY_SECONDS = 120;

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

    // The scheduled run fires at the same instant the target candle closes
    // (17:00 NY), so a provider may not have published it yet. Re-run the
    // (idempotent) stage a bounded number of times, waiting between attempts,
    // while any pair is still behind. The total wait stays well inside the
    // Job's task timeout. Env overrides: CANDLE_FRESHNESS_RETRY_ATTEMPTS,
    // CANDLE_FRESHNESS_RETRY_DELAY_SECONDS (0 attempts disables the retry).
    const retryAttempts = nonNegativeInt(
      env.CANDLE_FRESHNESS_RETRY_ATTEMPTS,
      DEFAULT_FRESHNESS_RETRY_ATTEMPTS,
    );
    const retryDelayMs =
      nonNegativeInt(
        env.CANDLE_FRESHNESS_RETRY_DELAY_SECONDS,
        DEFAULT_FRESHNESS_RETRY_DELAY_SECONDS,
      ) * 1000;
    const sleep = deps.sleep ?? realSleep;

    let summaries: readonly CandleFreshnessPairSummary[] = [];
    for (let attempt = 0; ; attempt += 1) {
      summaries = await runStage({
        decisionDate: config.decisionDate,
        ingestion: new OhlcIngestion(stores.candleStore),
        candleStore: stores.candleStore,
        vectorStore: stores.vectorStore,
        chain: buildProviderChain(chainConfig),
        maxLookbackTradingDays: resolveMaxLookback(env),
      });
      const pairsBehind = summaries.filter((s) => s.degraded || s.residualGap).length;
      if (pairsBehind === 0 || attempt >= retryAttempts) break;
      console.log(
        JSON.stringify({
          event: "candle_freshness.retry",
          decisionDate: config.decisionDate,
          attempt: attempt + 1,
          maxRetries: retryAttempts,
          pairsBehind,
          waitSeconds: retryDelayMs / 1000,
        }),
      );
      await sleep(retryDelayMs);
    }

    // Phase 2a (daily-candle-freshness-and-cleanup): the stage is fail-safe and
    // never throws for a provider failure, so a day where NO provider could
    // close a pair's gap would otherwise look identical to a healthy up-to-date
    // run and exit 0 silently — exactly how the Oct-8 stuck-candle incident went
    // unnoticed for ~3 weeks. Emit a DISTINCT, high-severity (ERROR) structured
    // event naming the still-behind pairs so a log-based alert can fire. This
    // does NOT change the fail-safe behaviour: the run still proceeds on
    // existing history and still exits 0 (a provider hiccup must not blank the
    // dashboard); the ERROR line is purely an alerting signal. Secret-free:
    // names/dates/counts only.
    logFreshnessDegradation(config.decisionDate, summaries);

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

/**
 * Phase 2a: emit a high-severity, secret-free `candle_freshness.degraded` event
 * when one or more pairs are still behind after the Candle_Freshness_Stage — a
 * pair that is `degraded` (every provider failed/was unconfigured for it) OR
 * still carries a `residualGap` (its latest stored candle is behind the most
 * recent Completed_Trading_Day). A fully up-to-date run logs NOTHING here.
 *
 * This is purely an alerting signal (a log-based alert keys on it); it does not
 * change the fail-safe flow — the caller still proceeds and exits 0. The payload
 * carries only names/dates/counts (no secret). `severity: "ERROR"` is a field in
 * the structured JSON so a log-based metric/alert filter can match on it; the
 * run itself is not failed.
 */
export function logFreshnessDegradation(
  decisionDate: string,
  summaries: readonly CandleFreshnessPairSummary[],
  log: (event: object) => void = (event) => {
    console.log(JSON.stringify(event));
  },
): void {
  const behind = summaries.filter((s) => s.degraded || s.residualGap);
  if (behind.length === 0) {
    return;
  }
  log({
    event: "candle_freshness.degraded",
    severity: "ERROR",
    decisionDate,
    pairsBehind: behind.map((s) => ({
      pair: s.pair,
      gap: s.gap,
      provider: s.provider,
      latestDate: s.latestDate,
      target: s.target,
      degraded: s.degraded,
      residualGap: s.residualGap,
    })),
  });
}

/**
 * Injectable seams for {@link makePersistView} so the end-of-run snapshot
 * assembly is unit-testable with no live network/DB. Production wiring (in
 * {@link main}) leaves every seam at its default; a test injects in-memory
 * stubs/spies to assert, e.g., that the firing view, the persisted rows, and
 * the `cards` handed to the persister are IDENTICAL whether the (fail-safe)
 * confluence step succeeds or throws (Requirement 10.5), and that the snapshot
 * still publishes with an `EMPTY_CONFLUENCE` slice when it throws (10.6, 13.7).
 */
export interface PersistViewDeps {
  /** The cached deterministic evaluations the view was built from. */
  readonly cached: { get(): readonly PairEvaluation[] };
  /** Display-only producer collaborators (LLM / external provider), as resolved. */
  readonly displayDeps: DisplayOnlyDeps;
  /** The resolved snapshot destination sink, or `undefined` for a no-op write. */
  readonly snapshotSink: SnapshotSink | undefined;
  /** The DB view persister. Defaults to the Supabase writer (the source of truth). */
  readonly persist?: (view: DashboardView, supabase: SupabaseConfigArg) => Promise<void>;
  /** Build the display-only writes. Defaults to {@link buildDisplayOnly}. */
  readonly buildDisplay?: (
    view: DashboardView,
    evaluations: readonly PairEvaluation[],
    deps: DisplayOnlyDeps,
  ) => Promise<DisplayOnlyWrite | undefined>;
  /** Load the read-back history slices. Defaults to {@link loadSnapshotHistory}. */
  readonly loadHistory?: (
    supabase: SupabaseConfigArg,
    view: DashboardView,
  ) => Promise<Awaited<ReturnType<typeof loadSnapshotHistory>>>;
  /** Build the v4 edge slices. Defaults to {@link buildEdgeSlices} over Supabase. */
  readonly buildEdge?: (
    supabase: SupabaseConfigArg,
    view: DashboardView,
    evaluations: readonly PairEvaluation[],
  ) => Promise<Awaited<ReturnType<typeof buildEdgeSlices>>>;
  /** Build the v5 confluence slice. Defaults to {@link buildConfluenceSlice} over Supabase. */
  readonly buildConfluence?: (
    supabase: SupabaseConfigArg,
    view: DashboardView,
    evaluations: readonly PairEvaluation[],
    displayOnly: DisplayOnlyWrite | undefined,
  ) => Promise<Awaited<ReturnType<typeof buildConfluenceSlice>>>;
  /** Build the v6 track-record slice. Defaults to {@link buildTrackRecordSlice} over Supabase. */
  readonly buildTrackRecord?: (
    supabase: SupabaseConfigArg,
    view: DashboardView,
    history: Awaited<ReturnType<typeof loadSnapshotHistory>>,
  ) => Promise<Awaited<ReturnType<typeof buildTrackRecordSlice>>>;
  /** Assemble the snapshot envelope. Defaults to {@link buildDashboardSnapshot}. */
  readonly buildSnapshot?: typeof buildDashboardSnapshot;
  /** Write the assembled snapshot. Defaults to {@link writeDashboardSnapshot}. */
  readonly writeSnapshot?: typeof writeDashboardSnapshot;
  /**
   * Run the per-signal scorecard step (reconcile the open backlog + record
   * today's six directions). Defaults to {@link runSignalScorecardStep} over the
   * Supabase-backed store. Fail-safe: it never throws and writes only to its own
   * `signal_predictions` table, so it can never disturb the firing rows.
   */
  readonly runScorecard?: (
    supabase: SupabaseConfigArg,
    view: DashboardView,
    evaluations: readonly PairEvaluation[],
    displayOnly: DisplayOnlyWrite | undefined,
  ) => Promise<void>;
  /**
   * Build the v7 recorded `signalScorecard` snapshot slice from the persisted
   * `signal_predictions` rows. Defaults to {@link buildSignalScorecardSlice}
   * over the Supabase-backed store. Read-only and fail-safe (empty slice on any
   * failure); runs AFTER {@link runScorecard} so today's rows are included.
   */
  readonly buildScorecard?: (
    supabase: SupabaseConfigArg,
  ) => Promise<Awaited<ReturnType<typeof buildSignalScorecardSlice>>>;
  /** Secret-free warning sink. Defaults to {@link logStartupWarning}. */
  readonly warn?: (collaborator: string, err: unknown) => void;
}

/** The Supabase connection argument the persister receives (alias for readability). */
type SupabaseConfigArg = Parameters<DashboardViewPersister>[1];

/**
 * Build the end-of-run {@link DashboardViewPersister}: write the firing view to
 * `firing_setups` (the source of truth) FIRST, then assemble the read-only
 * `dashboard.json` snapshot and write it fail-safely.
 *
 * The confluence step (subtask 19.1) is a separate read-only consumer: it writes
 * nothing to the DB and returns nothing firing reads, and it is wrapped in a
 * fail-safe try/catch so that a defect degrades the snapshot to an
 * `EMPTY_CONFLUENCE` slice (via `buildDashboardSnapshot`'s default) WITHOUT
 * changing the firing view, the persisted rows, or the `cards` the persister saw
 * (Requirements 10.5, 10.6, 13.7).
 */
export function makePersistView(deps: PersistViewDeps): DashboardViewPersister {
  const warn = deps.warn ?? logStartupWarning;
  const persist =
    deps.persist ?? ((view, supabase) => makeSupabaseViewPersister(supabase)(view, supabase));
  const buildDisplay =
    deps.buildDisplay ?? ((view, evaluations, d) => buildDisplayOnly(view, evaluations, d));
  const loadHistory =
    deps.loadHistory ??
    ((supabase, view) =>
      loadSnapshotHistory(new SupabaseRestClient(supabase), {
        decisionDate: view.decisionDate,
      }));
  const buildEdge =
    deps.buildEdge ??
    (async (supabase, view, evaluations) => {
      const stores = buildSupabaseStores(supabase);
      return buildEdgeSlices({
        view,
        evaluations,
        ledgerStore: new SupabaseTradeLedgerStore(new SupabaseRestClient(supabase)),
        candleStore: stores.candleStore,
        now: new Date(),
      });
    });
  const buildConfluence =
    deps.buildConfluence ??
    ((supabase, view, evaluations, displayOnly) =>
      buildConfluenceSlice({
        decisionDate: view.decisionDate,
        evaluations,
        displayOnly,
        candleStore: buildSupabaseStores(supabase).candleStore,
      }));
  const buildTrackRecord =
    deps.buildTrackRecord ??
    (async (supabase, view, history) => {
      const stores = buildSupabaseStores(supabase);
      // One pair-wide read of matured outcomes serves every replayed date.
      const analogueStore = memoizeMaturedOutcomes(stores.analogueStore, view.decisionDate);
      const pipelineDeps = { ...stores, analogueStore };
      return buildTrackRecordSlice({
        decisionDate: view.decisionDate,
        candleStore: stores.candleStore,
        realizedOutcomes: history.realizedOutcomes ?? [],
        lookbackDays: nonNegativeIntFromEnv(
          process.env[TRACK_RECORD_LOOKBACK_ENV],
          DEFAULT_TRACK_RECORD_LOOKBACK_DAYS,
        ),
        rangeLookbackDays: nonNegativeIntFromEnv(
          process.env[RANGE_RECORD_LOOKBACK_ENV],
          DEFAULT_RANGE_RECORD_LOOKBACK_DAYS,
        ),
        // The SAME as-of-date pipeline the live run uses, replayed for a past date.
        forecast: async (pair, date) =>
          (await evaluatePair(pair, date, pipelineDeps, DEFAULT_PIPELINE_CONFIG)).expectedRange ??
          null,
      });
    });
  const buildSnapshot = deps.buildSnapshot ?? buildDashboardSnapshot;
  const writeSnapshot = deps.writeSnapshot ?? writeDashboardSnapshot;
  const runScorecard =
    deps.runScorecard ??
    ((supabase, view, evaluations, displayOnly) =>
      runSignalScorecardStep({
        decisionDate: view.decisionDate,
        store: new SupabaseSignalPredictionStore(new SupabaseRestClient(supabase)),
        evaluations,
        displayOnly,
        candleStore: buildSupabaseStores(supabase).candleStore,
      }));
  const buildScorecard =
    deps.buildScorecard ??
    ((supabase) =>
      buildSignalScorecardSlice({
        store: new SupabaseSignalPredictionStore(new SupabaseRestClient(supabase)),
      }));

  return async (view: DashboardView, supabase) => {
    // The persisted DB rows are the source of truth and are written FIRST.
    await persist(view, supabase);

    let displayOnly: DisplayOnlyWrite | undefined;
    try {
      displayOnly = await buildDisplay(view, deps.cached.get(), deps.displayDeps);
    } catch (err) {
      warn("display_build", err);
      displayOnly = undefined;
    }

    // Signal Scorecard (signal-scorecard feature): a separate, fail-safe,
    // read-only consumer. It reconciles the open backlog (filling the realized
    // next-session direction of prior predictions whose session has now closed)
    // and records today's six per-signal directions from the same per-run
    // Confluence_Matrix the dashboard's confluence slice uses. It writes ONLY to
    // its own `signal_predictions` table and returns nothing firing reads, so it
    // can never disturb the firing view, the persisted firing rows, or the
    // snapshot (Scoring isolation). `runSignalScorecardStep` never throws; the
    // extra try/catch is belt-and-braces so a defect here cannot fail the run.
    try {
      await runScorecard(supabase, view, deps.cached.get(), displayOnly);
    } catch (err) {
      warn("signal_scorecard", err);
    }

    // Public_Read_Path (simplify-to-cloud-minimal R5.1, R5.2): at the END of the
    // run, serialise the dashboard view + display-only writes into the
    // `dashboard.json` snapshot the hosted SPA fetches, and write it fail-safely.
    // This runs AFTER the DB rows are persisted, and the write is best-effort:
    // `writeDashboardSnapshot` logs and swallows any failure so a snapshot error
    // can never corrupt the persisted rows nor fail the run (design Error
    // Handling).
    //
    // History slices (prior firing setups, realized/analogue outcomes, a bounded
    // recent window of candles, evaluation reports, and the Decision_Date list)
    // are READ BACK from the just-persisted source-of-truth rows so the SPA's
    // tabs render real data instead of an empty state. The read is read-only and
    // fail-safe per slice: a slice that cannot load degrades to an empty array
    // and never breaks the run (see `loadSnapshotHistory`). `buildDashboardSnapshot`
    // merges today's produced view on TOP of the historical firing setups.
    const history = await loadHistory(supabase, view);
    // Per-pair run-completion readout (schema v2): carry EVERY evaluated pair —
    // fired or not — so a silent (no-fire) day shows a credible "run evaluated
    // all five pairs" summary instead of a bare "no data" notice. The full
    // evaluations are the exact deterministic ones the view was built from
    // (captured by `cachingLoader`); the run uses the default dashboard config,
    // so `pairEvaluationRows` derives the same `fired` flag the view used.
    const pairEvaluations = pairEvaluationRows(view.decisionDate, deps.cached.get());
    // v4 evidence slices (trader-edge-validation R8.1, R9.1, R10): read-only,
    // deterministic, and fail-safe per slice (a failing slice degrades to empty
    // with a secret-free log). Only the output artifact grows; firing is untouched.
    let edge: Awaited<ReturnType<typeof buildEdgeSlices>> = {};
    try {
      edge = await buildEdge(supabase, view, deps.cached.get());
    } catch (err) {
      warn("edge_slices", err);
    }
    // v5 confluence slice (multi-strategy-confluence-engine R10, R11): a
    // separate read-only consumer of already-produced deterministic data. It
    // reads candles + the display-only third-party references, runs the four
    // classical strategies + the two adapters through the engine, and maps the
    // result to the appended `confluence` key. It writes NOTHING to the DB and
    // returns NOTHING firing reads (Requirement 10.5). `buildConfluenceSlice`
    // itself never throws (it degrades to `EMPTY_CONFLUENCE` on any internal
    // failure), but the call is wrapped in the same fail-safe try/catch the
    // edge slices use so a defect here can never fail the run or disturb the
    // persisted rows (Requirement 10.6).
    let confluence: Awaited<ReturnType<typeof buildConfluenceSlice>> | undefined;
    try {
      confluence = await buildConfluence(supabase, view, deps.cached.get(), displayOnly);
    } catch (err) {
      warn("confluence_slice", err);
    }
    // v6 track-record slice (dashboard-simplification): per-strategy hit counts and
    // expected-candle-size hit counts by look-ahead-safe replay. Read-only and
    // display-only; a defect degrades the slice to its empty default and can never
    // fail the run or disturb the persisted rows.
    let trackRecord: Awaited<ReturnType<typeof buildTrackRecordSlice>> | undefined;
    try {
      trackRecord = await buildTrackRecord(supabase, view, history);
    } catch (err) {
      warn("track_record", err);
    }
    // v7 recorded signal-scorecard slice (signal-scorecard feature): read-only
    // aggregation of the dated `signal_predictions` rows the scorecard step just
    // recorded/reconciled. Fail-safe — a defect degrades the slice to its empty
    // default and can never fail the run or disturb the persisted rows.
    let signalScorecard: Awaited<ReturnType<typeof buildSignalScorecardSlice>> | undefined;
    try {
      signalScorecard = await buildScorecard(supabase);
    } catch (err) {
      warn("signal_scorecard_slice", err);
    }
    const snapshot = buildSnapshot(
      view,
      displayOnly,
      history,
      undefined,
      pairEvaluations,
      edge,
      confluence,
      trackRecord,
      signalScorecard,
    );
    await writeSnapshot(snapshot, deps.snapshotSink);
  };
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

  const persistView = makePersistView({ cached, displayDeps, snapshotSink });

  const result = await runScheduledDaily(config, { loadEvaluations: cached.loader, persistView });

  console.log(
    JSON.stringify({
      event: "scheduled_run.complete",
      decisionDate: result.decisionDate,
      // The number of setups that FIRED on this run's Decision_Date (the
      // rendered firing cards), distinct from the snapshot's rolling
      // `surfacedSetupsTotal` across all dates.
      firedToday: result.view.cards.length,
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
