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

import { fileURLToPath } from "node:url";

import { loadScheduledRunConfig } from "./config.js";
import type { PairEvaluationLoader, DashboardViewPersister } from "./scheduledRun.js";
import { runScheduledDaily } from "./scheduledRun.js";
import { makePipelineLoader } from "../pipeline/index.js";
import { makeGatePassingResolver } from "../pipeline/gatePassingResolver.js";
import {
  buildSupabaseStores,
  buildSupabaseGateStores,
  SupabaseGateVerdictStore,
  SupabaseRestClient,
  makeSupabaseViewPersister,
  makeDisplayDataPersister,
  type DisplayOnlyWrite,
} from "../storage/supabase/index.js";

/**
 * Load the deterministic per-pair evaluations for the Decision_Date by running
 * the wired end-to-end pipeline (task 11.1) over the Supabase-backed storage
 * ports. Because the pipeline is a pure function of the stored inputs, this
 * reproduces an equivalent local run (Requirement 16.7).
 */
export const loadEvaluations: PairEvaluationLoader = (decisionDate, supabase) => {
  // Build the gate-verdict + feature-registry adapters (design Component 3)
  // that back the read-only resolver, sharing ONE SupabaseRestClient so the
  // gate stores and the resolver's read helper reuse the same connection
  // (URL + secret key + fetch). `buildSupabaseGateStores` accepts an existing
  // client for exactly this reuse; the concrete `SupabaseGateVerdictStore` is
  // constructed on the SAME client so its `latestPassVerdict(configId)` read
  // helper (added in task 1.3) can be bound into the resolver deps — that
  // helper lives on the adapter, not on the `GateVerdictStore` PORT type.
  const gateClient = new SupabaseRestClient(supabase);
  const { gateVerdictStore, featureRegistryStore } =
    buildSupabaseGateStores(gateClient);
  const gateVerdictAdapter = new SupabaseGateVerdictStore(gateClient);
  const gatePassing = makeGatePassingResolver({
    gateVerdictStore,
    featureRegistryStore,
    activeConfigFor: (pair) => `${pair}-active`,
    latestPassVerdict: (configId) =>
      gateVerdictAdapter.latestPassVerdict(configId),
  });
  return makePipelineLoader({
    ...buildSupabaseStores(supabase),
    gatePassing,
  })(decisionDate, supabase);
};

/**
 * The already-produced display-only values for the Decision_Date (Req 20.1,
 * 20.2). These are the OUTWARD-ONLY rationale / analogue labels / research
 * proposals and the own-vs-provider reference comparisons — all produced
 * upstream of the firing decision and never fed back into scoring. The slot is
 * OPTIONAL: an absent (`undefined`) value means the run produced no display
 * values, so nothing is written to the display-only tables.
 *
 * It is wired here, at the composition seam, so the `dailyRun` firing logic and
 * the pipeline stay untouched (compute/storage separation). The upstream
 * display-only producers (rationale generation, external-signal cross-check)
 * are connected end-to-end in a later task; until then this resolves to
 * `undefined` and the display persister is a no-op.
 */
const loadDisplayOnly: (
  decisionDate: string,
) => DisplayOnlyWrite | undefined = () => undefined;

/**
 * Persist the produced dashboard view to `firing_setups`, then — as one
 * OPTIONAL composition step beside the view persister — write the already-
 * produced display-only rationale / comparison values for the Decision_Date to
 * the `signal_rationale` and `external_reference_comparison` tables via
 * `makeDisplayDataPersister` (Req 20.1-20.3). Both persisters are bound to the
 * resolved config per run so they reuse the same IPv4 pooler/REST endpoint and
 * secret key the stores use (the display writer adds NO new dependency); the key
 * is never logged. The display step runs only when display-only values exist for
 * the date, and never alters the firing view or the pipeline.
 */
const persistView: DashboardViewPersister = async (view, supabase) => {
  await makeSupabaseViewPersister(supabase)(view, supabase);
  const displayOnly = loadDisplayOnly(view.decisionDate);
  if (displayOnly !== undefined) {
    await makeDisplayDataPersister(supabase)(displayOnly);
  }
};

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
