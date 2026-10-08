// Scheduled daily-run entry point (Requirement 16.7).
//
// This is the SINGLE code path invoked by the GCP-scheduled unattended run
// (Cloud Run Job triggered by Cloud Scheduler) AND available to the local
// dashboard. It does NOT fork or duplicate the dashboard's firing logic: it
// composes the existing modules and calls the exact deterministic `dailyRun`
// entry point from `../dashboard`. Because `dailyRun` is a pure function of the
// Decision_Date and the per-pair evaluations (see `src/dashboard/dashboard.ts`),
// a scheduled unattended run produces the same view as an equivalent local run
// over identical stored inputs (Requirement 16.7, 3.1).
//
// The seam between the end-to-end compute pipeline (ingestion → encoder →
// retrieval → resolver → confidence → kill-gate → news → risk-boundaries,
// wired end-to-end in task 11.1) and this runner is the `PairEvaluationLoader`:
// a function that, given the Decision_Date and the storage connection, returns
// the deterministic `PairEvaluation[]` the dashboard consumes. The runner owns
// orchestration and persistence; it never re-implements the firing decision.

import type { PairEvaluation } from "../dashboard/index.js";
import { dailyRun } from "../dashboard/index.js";
import type { DashboardConfig, DashboardView } from "../dashboard/index.js";
import { DEFAULT_DASHBOARD_CONFIG } from "../dashboard/index.js";
import type { TradingDate } from "../guard/types.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import type { ScheduledRunConfig } from "./config.js";

/**
 * Loads the deterministic per-pair evaluations for a Decision_Date from storage.
 *
 * This is the integration point for the end-to-end pipeline (task 11.1). It is
 * injected rather than hard-wired here so that:
 *   - the scheduled runner reuses the SAME `dailyRun` regardless of whether the
 *     evaluations come from the live pipeline or a fixed local fixture, and
 *   - reproducibility is exact: identical stored inputs yield identical
 *     evaluations and therefore an identical view (Requirement 16.7).
 *
 * @param decisionDate The Decision_Date being evaluated.
 * @param supabase     The resolved Supabase connection (IPv4 pooler/REST path).
 */
export type PairEvaluationLoader = (
  decisionDate: TradingDate,
  supabase: SupabaseConfig,
) => Promise<readonly PairEvaluation[]>;

/**
 * Persists the produced dashboard view (firing cards) for the Decision_Date.
 * Injected for the same reasons as the loader; the concrete `firing_setups`
 * writer is wired in task 10.10 / 11.1.
 */
export type DashboardViewPersister = (
  view: DashboardView,
  supabase: SupabaseConfig,
) => Promise<void>;

/**
 * The collaborators a scheduled run needs. Both are the pipeline/storage seam
 * (tasks 11.1 / 10.10); the runner itself stays deterministic and free of I/O
 * so it can be unit-tested with in-memory fakes and no network/DB.
 */
export interface ScheduledRunDeps {
  readonly loadEvaluations: PairEvaluationLoader;
  /** Optional persistence step; omitted (e.g. dry run) ⇒ view is not written. */
  readonly persistView?: DashboardViewPersister;
  /** Dashboard config; defaults to the shared {@link DEFAULT_DASHBOARD_CONFIG}. */
  readonly dashboardConfig?: DashboardConfig;
}

/** The outcome of one scheduled run: the produced view and whether it was persisted. */
export interface ScheduledRunResult {
  readonly decisionDate: TradingDate;
  readonly view: DashboardView;
  readonly persisted: boolean;
}

/**
 * Execute one scheduled daily run: load the deterministic per-pair evaluations
 * for the Decision_Date, produce the dashboard view via the EXACT shared
 * `dailyRun` entry point, and persist it when a persister is provided.
 *
 * Given identical stored inputs and config, this returns the same view a local
 * run would (Requirement 16.7): the only non-deterministic decisions (which
 * date, where storage lives) are resolved in `config` before this runs.
 */
export async function runScheduledDaily(
  config: ScheduledRunConfig,
  deps: ScheduledRunDeps,
): Promise<ScheduledRunResult> {
  const evaluations = await deps.loadEvaluations(config.decisionDate, config.supabase);

  // Reuse the exact deterministic entry point — no forked firing logic here.
  const view = dailyRun(
    config.decisionDate,
    evaluations,
    deps.dashboardConfig ?? DEFAULT_DASHBOARD_CONFIG,
  );

  let persisted = false;
  if (deps.persistView) {
    await deps.persistView(view, config.supabase);
    persisted = true;
  }

  return { decisionDate: config.decisionDate, view, persisted };
}
