// StagedRunner — backfill / backtest / forward-look over existing modules (Requirement 2).
//
// Wires three sequential stages in dependency order. Each stage delegates
// exclusively to existing module APIs — NO module logic is re-implemented:
//
//   backfill    → CsvLoader.loadAll → OhlcIngestion.ingest (via CsvLoader)
//                 → encodePatternVector → PatternVectorStore.upsertVector
//   backtest    → walkForwardFolds → composeGateVerdict → logGateVerdict
//   forwardLook → runScheduledDaily (which internally calls runDailyPipeline)
//
// Abort-on-missing-prerequisite (Requirement 2.7): a stage aborts with
// `ok: false` + `missingPrerequisite` when required stored data is absent,
// leaving stored data unchanged and preventing subsequent stages from running.

import { PAIRS } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import { walkForwardFolds } from "../kill-gate/walkForward.js";
import {
  composeGateVerdict,
  logGateVerdict,
  persistGateVerdict,
  type FoldGateInput,
} from "../kill-gate/verdict.js";
import type {
  Gate1FiringSample,
  GateVerdictSplit,
} from "../kill-gate/types.js";
import type { FeatureRegistryRow } from "../feature-registry/types.js";
import { SupabaseRestError } from "../storage/supabase/client.js";
import { compareTradingDates } from "../guard/tradingDate.js";
import type { WalkForwardFold } from "../kill-gate/types.js";
import type { ForwardOutcome } from "../retrieval/types.js";
import { runScheduledDaily } from "../scheduled-run/scheduledRun.js";
import type { StageName, StageResult, StagedRunnerDeps } from "./types.js";
import type { DataSourceRole } from "./types.js";

/** Default trailing window size fed to the encoder (≥40 for the widest scale). */
const DEFAULT_WINDOW_SIZE = 60;

/**
 * Backfill stage (Requirement 2.1, 2.2):
 *   1. Load candles from CSV files (and live API providers when `role="feed"`)
 *      through `CsvLoader.loadAll`, which delegates to `OhlcIngestion.ingest`.
 *   2. For every pair and every stored candle date, encode a PatternVector via
 *      `encodePatternVector` and upsert it via `PatternVectorStore.upsertVector`.
 *
 * Matured AnalogueStore outcomes are populated by the existing resolver, not
 * here (Requirement 2.2).
 */
export async function backfill(
  deps: StagedRunnerDeps,
  role: DataSourceRole,
): Promise<StageResult> {
  // Step 1: load candles through the CsvLoader (delegates to OhlcIngestion).
  await deps.csvLoader.loadAll(deps.dataDir, role);

  // Step 2: for each pair, encode and upsert a PatternVector for every stored
  // candle date that has enough history. We read from the CandleStore (via
  // ingestion's getCandles) and encode at each trading date as the decisionDate.
  for (const pair of PAIRS) {
    const candles = await deps.ingestion.getCandles(pair);
    if (candles.length === 0) {
      continue; // Nothing loaded for this pair — skip silently.
    }

    // Sort chronologically (already sorted by CandleStore, but be explicit).
    const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));

    // Encode and store one PatternVector per stored candle date so stored
    // vectors correspond 1:1 with stored candles (Requirement 2.2). The vector
    // for a candle date encodes the trailing window of candles dated STRICTLY
    // BEFORE that date (Look-Ahead safe — the decision date itself is excluded).
    // The earliest stored candle has an empty prior window; the encoder pads
    // short/empty windows to the fixed dimension, so every candle still yields
    // a vector.
    for (let i = 0; i < sorted.length; i++) {
      const decisionDate: TradingDate = sorted[i]!.date;
      // The window is the trailing candles strictly before decisionDate.
      const window = sorted.slice(Math.max(0, i - DEFAULT_WINDOW_SIZE), i);

      try {
        const vector = encodePatternVector(window, decisionDate);
        await deps.vectorStore.upsertVector(pair, decisionDate, vector);
      } catch {
        // Skip dates where encoding fails (e.g. the look-ahead guard fires for
        // an edge-case window); subsequent dates still succeed.
        continue;
      }
    }
  }

  return { ok: true };
}

/**
 * Backtest stage (Requirement 2.3, 2.4, 2.7):
 *   1. Check that candles and pattern vectors are present (prerequisite).
 *   2. Call `walkForwardFolds(pair, history)` for all pairs, build
 *      `FoldGateInput[]` from stored data, then call `composeGateVerdict`.
 *   3. Append the verdict to RESEARCH-LOG.md via `logGateVerdict`.
 *   4. Abort with `ok: false` + `missingPrerequisite` if no data is available.
 */
export async function backtest(
  deps: StagedRunnerDeps,
): Promise<StageResult> {
  // Prerequisite: at least one pair must have stored candles and vectors.
  let hasData = false;
  for (const pair of PAIRS) {
    const candles = await deps.ingestion.getCandles(pair);
    const vectors = await deps.vectorStore.getVectorsByAsset(pair);
    if (candles.length > 0 && vectors.length > 0) {
      hasData = true;
      break;
    }
  }
  if (!hasData) {
    return {
      ok: false,
      missingPrerequisite:
        "backtest: no candles or pattern vectors stored — run backfill first",
    };
  }

  // For each pair, build walk-forward folds over stored candle dates.
  // We aggregate all fold inputs across pairs into a single verdict.
  const foldInputs: FoldGateInput[] = [];
  // Collect every constructed fold so the GateVerdictSplit can be derived from
  // the walk-forward fold bounds already available in this stage.
  const allFolds: WalkForwardFold[] = [];

  // Monotonic fold index assigned GLOBALLY across pairs. `walkForwardFolds`
  // restarts its per-pair `fold.foldIndex` at 0,1,2… for every pair, so reusing
  // that raw index across multiple pairs produces DUPLICATE foldIndex values in
  // the aggregated verdict. Because the persisted `gate_fold_verdicts` row is
  // keyed by `(verdict_id, fold_index)`, duplicate indices collide on that PK.
  // Assigning a globally-unique index here keeps every persisted fold row
  // distinct. This is pure wiring: the per-fold gate evaluation inputs
  // (firingSubset, modelOutcomes, baselineOutcomes) are independent of the
  // index, and `composeGateVerdict` only sorts by foldIndex, so the verdict
  // result is unchanged — only the fold_index identifiers become unique.
  let globalFoldIndex = 0;

  for (const pair of PAIRS) {
    const candles = await deps.ingestion.getCandles(pair);
    if (candles.length === 0) continue;

    const history: TradingDate[] = candles.map((c) => c.date);
    const folds = walkForwardFolds(pair, history);
    allFolds.push(...folds);

    for (const fold of folds) {
      // Build the firing subset and outcome arrays for each fold.
      // We read stored vectors to get dates; the actual gate evaluation
      // receives empty firingSubset / outcomes when no resolved data is
      // available — composeGateVerdict marks those folds as skipped
      // (sample size < 30 floor).
      const firingSubset: Gate1FiringSample[] = [];
      const modelOutcomes: ForwardOutcome[] = [];
      const baselineOutcomes: ForwardOutcome[] = [];

      // Read matured analogue outcomes for this fold's test window.
      const maturedOutcomes = await deps.analogueStore.getMaturedOutcomes(
        pair,
        fold.testEnd,
      );

      for (const outcome of maturedOutcomes) {
        if (
          outcome.decisionDate >= fold.testStart &&
          outcome.decisionDate <= fold.testEnd &&
          outcome.matured
        ) {
          // Build a Gate1FiringSample from the matured record.
          // `baselinePrediction` is the Weekly_Trend_Follow baseline.
          // The vector store holds the weeklyTrendSign for each date.
          const vec = await deps.vectorStore.getVector(
            pair,
            outcome.decisionDate,
          );
          if (vec === null) continue;

          const modelDirection = outcome.direction;
          // Baseline: weeklyTrendSign mapped to UP/DOWN/FLAT direction.
          const baselineDirection =
            vec.weeklyTrendSign === "UP" ? "UP" : "DOWN";

          firingSubset.push({
            decisionDate: outcome.decisionDate,
            modelPrediction: modelDirection,
            baselinePrediction: baselineDirection,
            actual: outcome.direction,
          } satisfies Gate1FiringSample);

          // Build the ForwardOutcome for Gate 2.
          const forwardOutcome: ForwardOutcome = {
            perHorizon: {
              1: { direction: outcome.direction, mfePips: outcome.mfePips, maePips: outcome.maePips },
              2: { direction: outcome.direction, mfePips: outcome.mfePips, maePips: outcome.maePips },
              3: { direction: outcome.direction, mfePips: outcome.mfePips, maePips: outcome.maePips },
            },
          };

          modelOutcomes.push(forwardOutcome);
          // Baseline: same excursions but direction from weeklyTrendSign.
          const baselineForwardOutcome: ForwardOutcome = {
            perHorizon: {
              1: { direction: baselineDirection, mfePips: outcome.mfePips, maePips: outcome.maePips },
              2: { direction: baselineDirection, mfePips: outcome.mfePips, maePips: outcome.maePips },
              3: { direction: baselineDirection, mfePips: outcome.mfePips, maePips: outcome.maePips },
            },
          };
          baselineOutcomes.push(baselineForwardOutcome);
        }
      }

      foldInputs.push({
        // Globally-unique index across pairs (see `globalFoldIndex` above) so
        // the persisted (verdict_id, fold_index) rows never collide. The
        // per-pair `fold.foldIndex` is intentionally NOT used here.
        foldIndex: globalFoldIndex,
        pair,
        horizon: 1,
        firingSubset,
        modelOutcomes,
        baselineOutcomes,
      });
      globalFoldIndex += 1;
    }
  }

  // Compose the verdict across all folds and append to RESEARCH-LOG.md.
  const verdict = composeGateVerdict(deps.configId, foldInputs);
  await logGateVerdict(deps.docs, verdict);

  // Persist the verdict through the injected GateVerdictStore IN ADDITION to the
  // Research_Log append (persistence is additive — the log is preserved). The
  // Data_Split bounds are derived from the walk-forward fold bounds already
  // constructed above: `testStart` from the earliest fold's test window,
  // `testEnd` from the latest fold's test window, and `trainEnd` from the
  // train/test boundary of that earliest fold (every fold satisfies
  // `trainEnd < testStart`). `composeGateVerdict` remains the sole verdict
  // producer — nothing is recomputed here.
  const split = deriveGateVerdictSplit(allFolds);
  if (split !== null) {
    // Capture the persist report — its `verdictId` is the justifying id written
    // onto any PASS→included feature_registry rows below (spec Req 2.4). A
    // persist rejection is surfaced with the affected configId (spec Req 2.6):
    // it is NOT swallowed and the stage does NOT return `{ ok: true }` as though
    // the verdict were recorded.
    let report;
    try {
      report = await persistGateVerdict(deps.gateVerdictStore, verdict, split);
    } catch (err) {
      throw withConfigIdContext(err, deps.configId);
    }

    // On a PASS, record each admitted candidate feature as an `included`
    // feature_registry row carrying the justifying PASS verdictId (spec Req
    // 2.4). The admitted set is injected by the caller — the stage makes NO
    // admission decision and validates NO ceiling (spec Req 1.8). When no
    // features are admitted (undefined/empty), nothing is upserted and this is
    // a valid no-op.
    if (verdict.verdict === "PASS") {
      const admitted = deps.admittedFeatures ?? [];
      for (const featureId of admitted) {
        const row: FeatureRegistryRow = {
          featureId,
          status: "included",
          verdictId: report.verdictId,
        };
        await deps.featureRegistryStore.upsert(row);
      }
    }
  }

  return { ok: true };
}

/**
 * Augment a {@link persistGateVerdict} failure with the affected `configId` so
 * the surfaced error identifies which config's verdict failed to persist (spec
 * Req 2.6). A {@link SupabaseRestError} is already secret-free (it never carries
 * the Supabase key); it is re-raised with the `configId` appended to its message
 * while preserving its `status` and `table`. Any other error is wrapped in an
 * `Error` naming the `configId`, chaining the original via `cause`. In all cases
 * the failure propagates — it is never swallowed.
 */
function withConfigIdContext(err: unknown, configId: string): unknown {
  if (err instanceof SupabaseRestError) {
    if (err.message.includes(`config_id=${configId}`)) {
      // The adapter already named this config — do not double-annotate.
      return err;
    }
    return new SupabaseRestError(
      `${err.message} (config_id=${configId})`,
      err.status,
      err.table,
    );
  }
  return new Error(
    `Failed to persist gate verdict for config_id=${configId}`,
    { cause: err },
  );
}

/**
 * Derive the {@link GateVerdictSplit} recorded alongside a persisted verdict
 * from the walk-forward fold bounds constructed in the Backtest_Stage.
 *
 * The out-of-sample set is the union of the test windows, so:
 *   - `testStart` is the earliest fold's `testStart` (earliest test boundary),
 *   - `testEnd`   is the latest fold's `testEnd` (latest test boundary),
 *   - `trainEnd`  is the earliest fold's `trainEnd` — the train/test split
 *                 boundary adjacent to the earliest test window
 *                 (`trainEnd < testStart` holds for every fold).
 *
 * Returns `null` when no folds were constructed (e.g. histories too short for a
 * single full train/test span), in which case there is no split to record.
 */
function deriveGateVerdictSplit(
  folds: readonly WalkForwardFold[],
): GateVerdictSplit | null {
  if (folds.length === 0) return null;

  let earliest = folds[0]!;
  let latest = folds[0]!;
  for (const fold of folds) {
    if (compareTradingDates(fold.testStart, earliest.testStart) < 0) {
      earliest = fold;
    }
    if (compareTradingDates(fold.testEnd, latest.testEnd) > 0) {
      latest = fold;
    }
  }

  return {
    trainEnd: earliest.trainEnd,
    testStart: earliest.testStart,
    testEnd: latest.testEnd,
  };
}

/**
 * ForwardLook stage (Requirement 2.5, 2.7):
 *   Call `runScheduledDaily(config, { loadEvaluations, persistView })` for the
 *   current/most-recent matured Decision_Date. Aborts with `ok: false` +
 *   `missingPrerequisite` if vectors or matured outcomes are missing.
 *
 *   Does NOT duplicate the pipeline or `dailyRun` firing logic (Requirement 2.5).
 */
export async function forwardLook(
  deps: StagedRunnerDeps,
): Promise<StageResult> {
  // Prerequisite: at least one pair must have stored vectors.
  let hasVectors = false;
  for (const pair of PAIRS) {
    const vectors = await deps.vectorStore.getVectorsByAsset(pair);
    if (vectors.length > 0) {
      hasVectors = true;
      break;
    }
  }
  if (!hasVectors) {
    return {
      ok: false,
      missingPrerequisite:
        "forwardLook: no pattern vectors stored — run backfill first",
    };
  }

  // Prerequisite: at least one pair must have matured analogue outcomes.
  let hasMaturedOutcomes = false;
  for (const pair of PAIRS) {
    const outcomes = await deps.analogueStore.getMaturedOutcomes(
      pair,
      deps.config.decisionDate,
    );
    if (outcomes.length > 0) {
      hasMaturedOutcomes = true;
      break;
    }
  }
  if (!hasMaturedOutcomes) {
    return {
      ok: false,
      missingPrerequisite:
        "forwardLook: no matured analogue outcomes stored — run backfill and wait for outcomes to mature",
    };
  }

  // Delegate to the exact shared runScheduledDaily path — no forked logic here
  // (Requirement 2.5). The firing / pipeline logic lives entirely in
  // runScheduledDaily → runDailyPipeline → dailyRun.
  const scheduledDeps = deps.persistView !== undefined
    ? { loadEvaluations: deps.loadEvaluations, persistView: deps.persistView }
    : { loadEvaluations: deps.loadEvaluations };

  await runScheduledDaily(deps.config, scheduledDeps);

  return { ok: true };
}

/**
 * Composed ordered run: backfill → backtest → forwardLook (Requirement 2.6, 2.9).
 *
 * Each stage consumes the prior stage's stored output. The run stops at the
 * first failed stage so no subsequent stage runs on incomplete stored data.
 * Returns the name of the stage that failed (or undefined on full success).
 */
export async function runAll(
  deps: StagedRunnerDeps,
  role: DataSourceRole,
): Promise<{
  readonly stages: ReadonlyArray<{
    readonly stage: StageName;
    readonly result: StageResult;
  }>;
}> {
  const results: Array<{ stage: StageName; result: StageResult }> = [];

  const backfillResult = await backfill(deps, role);
  results.push({ stage: "backfill", result: backfillResult });
  if (!backfillResult.ok) {
    return { stages: results };
  }

  const backtestResult = await backtest(deps);
  results.push({ stage: "backtest", result: backtestResult });
  if (!backtestResult.ok) {
    return { stages: results };
  }

  const forwardLookResult = await forwardLook(deps);
  results.push({ stage: "forwardLook", result: forwardLookResult });

  return { stages: results };
}
