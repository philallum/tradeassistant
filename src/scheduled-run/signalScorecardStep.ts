// Daily-run wiring for the Signal Scorecard (signal-scorecard feature).
//
// A separate, fail-safe, read-only consumer bolted onto the end of the daily
// run. It does two things each trading day:
//
//   1. RECONCILE the backlog: fill the realized next-session direction of any
//      prior `signal_predictions` rows whose following session has now closed,
//      scoring each directional call against the actual move
//      (`reconcileOutcomes`). "The following day registers the actual outcome"
//      falls out naturally — a prediction made on day D matures the first run on
//      or after D+1 that has D's forward candle.
//
//   2. RECORD today's directions: build the per-run Confluence_Matrix the SAME
//      way `buildConfluenceSlice` does (same strategy bundle, engine config,
//      candles, and third-party references) and write one open row per available
//      signal cell per pair with its suggested direction (`recordPredictions`).
//
// FAIL-SAFE by construction: the whole step is wrapped so any error — a config
// problem, a store write failure, a candle read failure — is logged secret-free
// and swallowed. It writes to its OWN table only, never to firing_setups, and it
// feeds nothing the firing/confidence/Kill_Gate path reads, so a defect here can
// never change the firing view, the persisted firing rows, or the snapshot.
//
// It runs AFTER the source-of-truth firing rows are persisted, mirroring the
// confluence/edge/track-record slices' placement in `makePersistView`.

import type { TradingDate } from "../guard/types.js";
import { PAIRS, type CandleStore, type Pair } from "../ingestion/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import {
  recordPredictions,
  reconcileOutcomes,
  type SignalPredictionStore,
} from "../dashboard/signalScorecard.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import type { DisplayOnlyWrite } from "../storage/supabase/index.js";
import {
  buildConfluenceMatrix,
  createConfluenceEngine,
  confluenceConfigFromEnv,
  type PairConfluenceInput,
} from "../strategies/index.js";
import { buildStrategyBundle } from "./confluenceSlice.js";
import { HISTORY_WINDOW_DAYS, windowStartDate } from "./snapshotHistory.js";

/** The collaborators the scorecard step needs. All read-only except the store. */
export interface SignalScorecardStepDeps {
  /** The run's Decision_Date (`YYYY-MM-DD`). */
  readonly decisionDate: TradingDate;
  /** The scorecard store (Supabase adapter in prod, in-memory in tests). */
  readonly store: SignalPredictionStore;
  /** The run's deterministic per-pair evaluations (for the `custom_pattern` cell). */
  readonly evaluations: readonly PairEvaluation[];
  /** The display-only writes carrying the per-Pair third-party `reference`s. */
  readonly displayOnly: DisplayOnlyWrite | undefined;
  /** The Candle storage port (predictions read history; reconcile reads forward). */
  readonly candleStore: CandleStore;
  /** Environment for the engine config override. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Secret-free warning sink. */
  readonly warn?: (step: string, err: unknown) => void;
}

function defaultWarn(step: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(JSON.stringify({ event: "scheduled_run.signal_scorecard_failed", step, message }));
}

/** Decrement a `YYYY-MM-DD` date by one calendar day (UTC) — candles strictly before. */
function dayBefore(date: TradingDate): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the per-run Confluence_Matrix for the Decision_Date, reusing the exact
 * same strategy bundle, engine config resolution, candle window, and
 * third-party references `buildConfluenceSlice` uses — so the directions
 * recorded here are identical to the ones the dashboard's confluence slice
 * shows. Returns `null` if the engine/strategy bundle cannot be built; a
 * per-pair candle load failure simply drops that pair's input (the matrix
 * degrades it to INSUFFICIENT_DATA with unavailable cells, which record nothing).
 */
async function buildMatrix(deps: SignalScorecardStepDeps) {
  const env = deps.env ?? process.env;

  const envConfig = confluenceConfigFromEnv(env);
  let engineResult = createConfluenceEngine(envConfig.ok ? envConfig.value : undefined);
  if (!engineResult.ok) engineResult = createConfluenceEngine();
  if (!engineResult.ok) return null;
  const engine = engineResult.value;

  const strategies = buildStrategyBundle();
  if (strategies === null) return null;

  const referenceByPair = new Map<Pair, ExternalReferenceSignal | null>();
  for (const comparison of deps.displayOnly?.comparisons ?? []) {
    referenceByPair.set(comparison.pair as Pair, comparison.reference);
  }

  const evaluationByPair = new Map<Pair, PairEvaluation>();
  for (const evaluation of deps.evaluations) {
    evaluationByPair.set(evaluation.pair, evaluation);
  }

  const windowStart = windowStartDate(deps.decisionDate, HISTORY_WINDOW_DAYS);
  const endDate = dayBefore(deps.decisionDate);

  const inputs: PairConfluenceInput[] = [];
  await Promise.all(
    PAIRS.map(async (pair) => {
      try {
        const candles = await deps.candleStore.getCandles(pair, windowStart, endDate);
        inputs.push({
          pair,
          candles,
          evaluation: evaluationByPair.get(pair),
          thirdParty: referenceByPair.get(pair),
        });
      } catch {
        // Drop this pair: the matrix treats an absent input as INSUFFICIENT_DATA
        // with all cells unavailable, so nothing is recorded for it this run.
      }
    }),
  );

  return buildConfluenceMatrix({
    decisionDate: deps.decisionDate,
    inputs,
    strategies,
    engine,
  });
}

/**
 * Run the daily Signal Scorecard step: reconcile the open backlog, then record
 * today's six per-signal directions. NEVER throws — any failure is logged
 * secret-free and swallowed so the run (and every other slice) is unaffected.
 */
export async function runSignalScorecardStep(deps: SignalScorecardStepDeps): Promise<void> {
  const warn = deps.warn ?? defaultWarn;

  // 1. Reconcile the backlog first so a row recorded on a prior day matures as
  //    soon as its forward session exists. Isolated so a reconcile failure does
  //    not prevent today's recording.
  try {
    await reconcileOutcomes(deps.store, deps.decisionDate, deps.candleStore);
  } catch (err) {
    warn("reconcile", err);
  }

  // 2. Record today's directions from the per-run matrix.
  try {
    const matrix = await buildMatrix(deps);
    if (matrix === null) {
      warn("record", new Error("confluence matrix could not be built; skipping record"));
      return;
    }
    await recordPredictions(deps.store, matrix);
  } catch (err) {
    warn("record", err);
  }
}
