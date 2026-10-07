// Container entry point for the one-shot hosted SEED run (Feature:
// operational-wiring).
//
// This is the runnable script a Cloud Run Job executes once to bring a fresh
// hosted Supabase backend from empty to decision-ready. Its purpose is to fix
// the "every pair non-firing" symptom: nothing currently drives the EXISTING
// forward-outcome `resolve(...)` across history, so `analogue_outcomes` is empty
// in hosted → no analogue neighbourhood matures → no pair fires → no
// Decision_Date is persisted. The seed run closes that gap by running, in order:
//
//   1. Hosted_Candle_Seeding — the EXISTING `StagedRunner.backfill("backfill")`
//      (via `runHostedBackfill`) imports candles and encodes pattern vectors
//      into the hosted stores; and
//   2. Historical Outcome Resolution — `resolveHistoricalOutcomes` drives the
//      EXISTING resolver over all stored history so `analogue_outcomes` is
//      populated.
//
// It contains NO ingestion/encoding/resolver/ATR logic of its own — every piece
// is a shared module reached through the storage PORTs, mirroring the structure
// of `src/scheduled-run/main.ts`. Both stages run against ONE set of hosted
// stores so the backfilled candles/vectors are exactly what outcome resolution
// reads.
//
// Secret confidentiality (spec Req 6.2, 6.3, 7.6): the Supabase `Secret_Key` is
// NEVER logged. The structured logs carry only non-secret references — the
// decision date, the Supabase target label and REST URL, per-pair coverage
// counts, and the total outcome-row count.
//
// This module only BUILDS the entry point; wiring a Cloud Run Job / deploy is a
// later live step.

import { fileURLToPath } from "node:url";

import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import { buildSupabaseStores } from "../../storage/supabase/index.js";
import { runHostedBackfill } from "../hosted-backfill/index.js";
import { resolveHistoricalOutcomes } from "../outcome-resolution/index.js";

/**
 * Run the one-shot hosted seed: resolve config → build hosted stores →
 * backfill → resolve historical outcomes. Emits structured, secret-free JSON
 * logs at each milestone. Pure of its own business logic; all work is delegated
 * to the shared modules.
 */
export async function main(): Promise<void> {
  const config = loadScheduledRunConfig();

  // Build the three hosted storage PORTs ONCE and share them across both
  // stages, so outcome resolution reads exactly the candles/vectors backfill
  // wrote. The Supabase key is held inside the client and never logged.
  const stores = buildSupabaseStores(config.supabase);

  // Structured, secret-free startup log. The Supabase key is never logged.
  console.log(
    JSON.stringify({
      event: "seed_run.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
    }),
  );

  // Stage 1 — Hosted_Candle_Seeding via the EXISTING backfill stage.
  const backfillResult = await runHostedBackfill({ config, stores });
  console.log(
    JSON.stringify({
      event: "seed_run.backfill_complete",
      complete: backfillResult.complete,
      coverage: backfillResult.coverage.map((c) => ({
        pair: c.pair,
        count: c.count,
        earliestDate: c.earliestDate,
        latestDate: c.latestDate,
      })),
    }),
  );

  // Stage 2 — Historical Outcome Resolution over all stored history. The
  // production vector gate (requireVector) stays on by default so only dates
  // with a stored pattern vector are resolved.
  const outcomes = await resolveHistoricalOutcomes({
    stores,
    evalDate: config.decisionDate,
  });
  console.log(
    JSON.stringify({
      event: "seed_run.outcomes_complete",
      totalOutcomesWritten: outcomes.totalOutcomesWritten,
    }),
  );
}

/**
 * True iff this module is the process entry point (invoked as
 * `node .../seed-run/main.js`), so importing it (e.g. from a test) does NOT
 * start a run. Mirrors the direct-invocation guard pattern of the scheduled
 * runner's container entry.
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
    console.error(JSON.stringify({ event: "seed_run.error", message }));
    process.exitCode = 1;
  });
}
