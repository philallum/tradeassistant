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
//   5. BESIDE the firing view, produces and persists the OUTWARD-ONLY display
//      values for the Decision_Date — the AI `signal_rationale` /
//      `pattern_description` narrative (Requirement 15) and the third-party
//      external cross-reference comparison (Requirement 23) — via the display
//      persister. These are display-only and never feed scoring.
//
// It contains NO firing logic of its own; all business logic lives in the
// shared modules so an unattended run reproduces an equivalent local run.

import { loadScheduledRunConfig } from "./config.js";
import type { PairEvaluationLoader, DashboardViewPersister } from "./scheduledRun.js";
import { runScheduledDaily } from "./scheduledRun.js";
import { makePipelineLoader } from "../pipeline/index.js";
import {
  buildSupabaseStores,
  makeSupabaseViewPersister,
  makeDisplayDataPersister,
  type DisplayOnlyWrite,
} from "../storage/supabase/index.js";
import type { PairEvaluation, DashboardView } from "../dashboard/index.js";
import { isTradingDay } from "../guard/tradingDate.js";
import { LlmInterface, GeminiLlmProvider, InMemoryRoleRejectionRecorder } from "../llm/index.js";
import {
  externalSignalConfigFromEnv,
  FcsExternalSignalProvider,
  type ExternalSignalConfig,
} from "../external-signal/index.js";
import { resolveAccessTokenProvider } from "./accessToken.js";
import { buildDisplayOnly, type DisplayOnlyDeps } from "./displayOnly.js";

/**
 * Load the deterministic per-pair evaluations for the Decision_Date by running
 * the wired end-to-end pipeline (task 11.1) over the Supabase-backed storage
 * ports. Because the pipeline is a pure function of the stored inputs, this
 * reproduces an equivalent local run (Requirement 16.7).
 *
 * The loader is wrapped by {@link cachingLoader} below so the SAME evaluations
 * the view was built from are available to the display-only producer (the
 * third-party cross-reference needs each pair's own Direction_Class).
 */
const loadEvaluations: PairEvaluationLoader = (decisionDate, supabase) => {
  const stores = buildSupabaseStores(supabase);
  return makePipelineLoader(stores)(decisionDate, supabase);
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

/** Structured, secret-free warning for an optional-collaborator wiring failure. */
function logStartupWarning(collaborator: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    JSON.stringify({ event: "scheduled_run.startup_warning", collaborator, message }),
  );
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

  const displayDeps = await buildDisplayDeps(config);
  const cached = cachingLoader(loadEvaluations);

  /**
   * Persist the produced dashboard view to `firing_setups`, then — beside it —
   * build and write the OUTWARD-ONLY display values (AI rationale + external
   * comparison) for the Decision_Date to `signal_rationale` /
   * `external_reference_comparison` via `makeDisplayDataPersister` (Req 20, 15,
   * 23). The display step is fail-safe: a producer error degrades to no
   * rationale / unavailable reference for that pair and never prevents the
   * firing view from being persisted.
   */
  const persistView: DashboardViewPersister = async (view: DashboardView, supabase) => {
    await makeSupabaseViewPersister(supabase)(view, supabase);

    let displayOnly: DisplayOnlyWrite | undefined;
    try {
      displayOnly = await buildDisplayOnly(view, cached.get(), displayDeps);
    } catch (err) {
      logStartupWarning("display_build", err);
      displayOnly = undefined;
    }

    if (displayOnly !== undefined) {
      await makeDisplayDataPersister(supabase)(displayOnly);
    }
  };

  const result = await runScheduledDaily(config, { loadEvaluations: cached.loader, persistView });

  console.log(
    JSON.stringify({
      event: "scheduled_run.complete",
      decisionDate: result.decisionDate,
      firingCards: result.view.cards.length,
      suppressed: result.view.suppressed.length,
      persisted: result.persisted,
    }),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    JSON.stringify({ event: "scheduled_run.error", message }),
  );
  process.exitCode = 1;
});
