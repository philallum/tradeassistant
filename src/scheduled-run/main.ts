// Container entry point for the GCP-scheduled daily refresh (Requirement 16.7).
//
// This is the runnable script the Cloud Run Job executes to completion once per
// day (triggered by Cloud Scheduler). It:
//   1. reads its runtime configuration from the environment — non-secret config
//      (project/region/model/decision date) from plain env vars and the secret
//      Supabase URL/keys that Cloud Run injects from Google Secret Manager;
//   2. resolves the Supabase connection over the IPv4-reachable pooler/REST
//      endpoint (Cloud Run has no IPv6 egress, so the IPv6-only direct DB host
//      is never used); and
//   3. invokes the SAME deterministic `runScheduledDaily` → `dailyRun` path the
//      local dashboard uses, then persists the result.
//
// It contains NO firing logic of its own; all business logic lives in the
// shared modules so an unattended run reproduces an equivalent local run.
//
// The pipeline loader / persister are the task-11.1 / task-10.10 integration
// seam. They are marked as NOT-YET-WIRED here: the script fails fast with a
// clear message rather than fabricating data, until the end-to-end pipeline is
// connected. Wiring only replaces these two collaborators; the entry point and
// the deterministic path stay exactly as they are.

import { loadScheduledRunConfig } from "./config.js";
import type { PairEvaluationLoader, DashboardViewPersister } from "./scheduledRun.js";
import { runScheduledDaily } from "./scheduledRun.js";
import { makePipelineLoader } from "../pipeline/index.js";
import {
  buildSupabaseStores,
  makeSupabaseViewPersister,
} from "../storage/supabase/index.js";

/**
 * Load the deterministic per-pair evaluations for the Decision_Date by running
 * the wired end-to-end pipeline (task 11.1) over the Supabase-backed storage
 * ports. Because the pipeline is a pure function of the stored inputs, this
 * reproduces an equivalent local run (Requirement 16.7).
 */
const loadEvaluations: PairEvaluationLoader = (decisionDate, supabase) => {
  const stores = buildSupabaseStores(supabase);
  return makePipelineLoader(stores)(decisionDate, supabase);
};

/**
 * Persist the produced dashboard view (firing cards + currency-concentration /
 * choppiness suppressions) to `firing_setups` via the Supabase connection. The
 * persister is bound to the resolved config per run so it uses the same IPv4
 * pooler/REST endpoint and secret key the stores use; the key is never logged.
 */
const persistView: DashboardViewPersister = (view, supabase) =>
  makeSupabaseViewPersister(supabase)(view, supabase);

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

  const result = await runScheduledDaily(config, { loadEvaluations, persistView });

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
