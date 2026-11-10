// Operator entry: measure the confluence and intraday layers from the live ledgers (READ-ONLY).
//
// Reads two small tables (`signal_predictions`, `intraday_validations`) and writes ONE measurement
// note to RESEARCH-LOG.md. Reading them touches the hosted project, so it needs the explicit
// `--allow-hosted-read` flag (a few rows per day; no heavy backtest, no writes to the database).
// SECRET-FREE: credentials are read from the environment by name and never logged.
//
// Usage: EDGE_EVAL_DOCS_DIR=. node dist/ops/layer-measurements/main.js --allow-hosted-read
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { SignalPredictionStore } from "../../dashboard/signalScorecard.js";
import type { IntradayValidationStore } from "../../intraday-validation/store.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import { SupabaseRestClient } from "../../storage/supabase/client.js";
import { SupabaseIntradayValidationStore } from "../../storage/supabase/intradayValidationStore.js";
import { SupabaseSignalPredictionStore } from "../../storage/supabase/signalPredictionStore.js";
import { evaluateConfluenceQuestion, evaluateIntradayQuestion, type QuestionResult } from "./layerMeasurements.js";

export interface LayerMeasurementDeps {
  readonly predictionStore: SignalPredictionStore;
  readonly intradayStore: IntradayValidationStore;
}

export async function runLayerMeasurements(deps: LayerMeasurementDeps): Promise<{
  readonly lines: readonly string[];
  readonly results: readonly QuestionResult[];
}> {
  const [predictions, validations] = await Promise.all([deps.predictionStore.getAll(), deps.intradayStore.getAll()]);
  const results = [evaluateConfluenceQuestion(predictions), evaluateIntradayQuestion(validations, predictions)];
  const lines = [
    `Read-only join of ${predictions.length} recorded signal predictions and ${validations.length} intraday validations; nothing written to the database; live behaviour unchanged. Realised outcome = the recorded next-session direction of the system's own call.`,
    ...results.map((r) => `${r.id}: ${r.summary}`),
    "Note: evidence for human interpretation. The 4H confidence delta stays labelled unvalidated in the UI until the operator decides, on this evidence, to keep or remove it.",
  ];
  return { lines, results };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--allow-hosted-read")) {
    throw new Error("layer-measurements reads the hosted ledgers; re-run with --allow-hosted-read to confirm");
  }
  const config = loadScheduledRunConfig();
  const client = new SupabaseRestClient(config.supabase);
  const { lines } = await runLayerMeasurements({
    predictionStore: new SupabaseSignalPredictionStore(client),
    intradayStore: new SupabaseIntradayValidationStore(client),
  });
  for (const l of lines) console.log(l);
  const configured = process.env.EDGE_EVAL_DOCS_DIR;
  const docs = new LivingDocs(new FsDocStore(configured !== undefined && configured.length > 0 ? configured : tmpdir()));
  await docs.appendEdgeEvaluation("confluence and intraday layer measurements (pre-registered questions)", lines);
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "layer_measurements.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
