// StagedRunner — backfill / backtest / forward-look over existing modules (Requirement 2).
//
// What remains of the StagedRunner after the legacy PASS/CUT verdict path was removed
// (codebase-housekeeping Task 5). Everything here delegates to existing module APIs;
// NO module logic is re-implemented:
//
//   backfill          → CsvLoader.loadAll → OhlcIngestion.ingest (via CsvLoader)
//                       → encodePatternVector → PatternVectorStore.upsertVector
//   hasBacktestData   → the evaluation-report prerequisite check (candles + vectors)
//   buildFoldInputs   → the fold construction `src/ops/evaluation-run/main.ts` feeds to
//                       `composeEvaluationReport` (the live measurement producer)
//
// The former `backtest` (composeGateVerdict + persistGateVerdict), `forwardLook` and
// `runAll` stages had no production caller left and were removed with `ops/gate-run`.

import { PAIRS } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { encodeAllForPair } from "../encoder/encodeStoredCandles.js";
import { walkForwardFolds } from "../kill-gate/walkForward.js";
import type { FoldGateInput } from "../kill-gate/verdict.js";
import type { Gate1FiringSample, WalkForwardFold } from "../kill-gate/types.js";
import type {
  AnalogueRecord,
  ForwardOutcome,
  RetrievalConfig,
} from "../retrieval/types.js";
import { retrieve } from "../retrieval/retrieve.js";
import {
  dominantDirection,
  excursionProfileAt,
} from "../pipeline/dailyPipeline.js";
import { DEFAULT_RETRIEVAL_CONFIG } from "../pipeline/types.js";
import { earnedConfidence, selectHorizon } from "../confidence/index.js";
import type {
  AnalogueStore as AnalogueStorePort,
} from "../retrieval/types.js";
import { InMemoryAnalogueStore } from "../retrieval/types.js";
import type {
  PatternVector,
  PatternVectorStore as PatternVectorStorePort,
  StoredPatternVector,
} from "../encoder/types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import type { StageResult, StagedRunnerDeps } from "./types.js";
import type { DataSourceRole } from "./types.js";

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
  // candle date so stored vectors correspond 1:1 with stored candles
  // (Requirement 2.2). This now delegates to the SHARED look-ahead-safe encode
  // helper (`encodeAllForPair`) — the same path the Candle_Freshness_Stage uses
  // — rather than inlining the window-slice + encode flow. The helper encodes
  // the trailing window of candles dated STRICTLY BEFORE each date (the decision
  // date itself is excluded) and skips dates whose encode throws.
  for (const pair of PAIRS) {
    await encodeAllForPair(deps.candleStore, deps.vectorStore, pair);
  }

  return { ok: true };
}

/**
 * True when at least one pair has BOTH stored candles and stored pattern
 * vectors — the Backtest_Stage / evaluation-report prerequisite (Requirement
 * 2.7). Extracted so the evaluation report path can run the SAME check.
 */
export async function hasBacktestData(
  deps: StagedRunnerDeps,
): Promise<boolean> {
  for (const pair of PAIRS) {
    const candles = await deps.ingestion.getCandles(pair);
    const vectors = await deps.vectorStore.getVectorsByAsset(pair);
    if (candles.length > 0 && vectors.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Build the per-fold {@link FoldGateInput}s (and the underlying walk-forward
 * folds) from the stored candles / pattern vectors / matured analogue outcomes.
 *
 * This is the fold-construction the evaluation-report path
 * (`composeEvaluationReport`) consumes. (Historically it was shared with the legacy
 * `composeGateVerdict` path, removed in codebase-housekeeping Task 5.) It
 * re-implements NO gate math: it only reads stored rows and maps them to the
 * fold-input shape the composers expect.
 *
 * `foldIndex` is assigned GLOBALLY across pairs (monotonic) so the aggregated
 * fold inputs never collide on index — `walkForwardFolds` restarts its per-pair
 * index at 0, so reusing the raw index across pairs would duplicate. The
 * per-fold evaluation inputs are independent of the index and the composers only
 * sort by it, so the result is unchanged — only the identifiers become unique.
 *
 * LOOK-AHEAD SAFETY (Requirement 9.1): the model's directional prediction for a
 * Decision_Date is NOT read from that date's matured forward outcome (which
 * would be a tautological leak — the model would be scored against the very
 * value it was derived from). Instead it is sourced HONESTLY from the Analogue_
 * Neighborhood retrieved AS OF the Decision_Date, exactly as the live daily
 * pipeline does (`src/pipeline/dailyPipeline.ts`):
 *
 *   1. use the STORED pattern vector at the Decision_Date as the query — it was
 *      encoded over the trailing window strictly BEFORE that date during
 *      backfill, so it carries no future information;
 *   2. `retrieve(...)` the neighborhood (pre-date, matured-only, self-exclusion,
 *      epsilon cutoff) — the Decision_Date's own future outcome is structurally
 *      excluded, so no leak is possible;
 *   3. `selectHorizon` + `dominantDirection` → the model prediction;
 *      `earnedConfidence` → the model's earned strength;
 *      `excursionProfileAt` → the model's OWN excursion profile.
 *
 * The matured outcome supplies ONLY `actual` (the realized direction scored
 * against) and the Weekly_Trend_Follow baseline's excursions. A Decision_Date
 * whose neighborhood is empty / below the directional floor yields a FLAT
 * (non-fire) model: it does NOT contribute a firing sample, mirroring the live
 * path, so the Sample_Size_Floor behaviour is preserved and no prediction is
 * fabricated.
 *
 * PERFORMANCE (simplify-to-cloud-minimal, task 8): `retrieve(...)` is called
 * once per firing Decision_Date, and each hosted call does ~2 PostgREST
 * round-trips (`queryNearest` over-fetch + `getMaturedOutcomes`). Across all
 * pairs × all OOS trading days that is thousands of sequential round-trips —
 * enough to exceed the Cloud_Run_Job task timeout. The DATA ACCESS, not the
 * MEASUREMENT, is the bottleneck. So for each pair we bulk-load its stored
 * vectors and matured outcomes from the injected (hosted) stores EXACTLY ONCE,
 * mirror them into a fresh {@link InMemoryPatternVectorStore} /
 * {@link InMemoryAnalogueStore}, and serve every per-date `retrieve(...)` from
 * those in-memory mirrors. The in-memory stores implement the SAME ports with
 * the SAME `queryNearest` filtering + tie-break ordering + `computeCosineDistance`
 * and the SAME `getMaturedOutcomes` (`matured && decisionDate < beforeDate`)
 * filter as the Supabase adapters, so serving `retrieve(...)` from the mirror
 * yields BYTE-IDENTICAL results — only the round-trip count collapses (~10
 * bulk reads instead of thousands of per-date reads). The look-ahead-safe
 * filters are UNCHANGED: they run against the mirror, which holds the same rows.
 */

/** Map a bulk-loaded {@link StoredPatternVector} to the {@link PatternVector}
 * shape `InMemoryPatternVectorStore.upsertVector` / `retrieve` expect. This is
 * the SAME mapping the per-date path uses when it builds the retrieval query
 * from a stored vector (`dim = embedding.length`); no embedding value is
 * dropped or altered. */
function storedToPatternVector(vec: StoredPatternVector): PatternVector {
  return {
    scale10: vec.scaleDims.scale10,
    scale20: vec.scaleDims.scale20,
    scale40: vec.scaleDims.scale40,
    embedding: vec.embedding,
    weeklyTrendSign: vec.weeklyTrendSign,
    dim: vec.embedding.length,
  };
}

/**
 * A `beforeDate` sentinel strictly greater than any real trading date, used to
 * bulk-load the FULL matured-outcome set for a pair in one call. The per-date
 * `getMaturedOutcomes(pair, D)` served from the in-memory mirror then re-applies
 * the real `decisionDate < D` filter, reproducing every original per-date call
 * exactly (the mirror is a superset; the store filters it down per call).
 */
const FAR_FUTURE_BEFORE_DATE: TradingDate = "9999-12-31";

export async function buildFoldInputs(deps: StagedRunnerDeps): Promise<{
  readonly foldInputs: readonly FoldGateInput[];
  readonly allFolds: readonly WalkForwardFold[];
}> {
  const foldInputs: FoldGateInput[] = [];
  const allFolds: WalkForwardFold[] = [];
  let globalFoldIndex = 0;

  // Reuse the live daily pipeline's committed retrieval knobs unless the caller
  // overrides them, so evaluation fold inputs are produced under the SAME
  // Analogue_Neighborhood parameters the live firing path uses (Requirement 9.1).
  const retrievalConfig: RetrievalConfig =
    deps.retrieval ?? DEFAULT_RETRIEVAL_CONFIG;

  for (const pair of PAIRS) {
    const candles = await deps.ingestion.getCandles(pair);
    if (candles.length === 0) continue;

    const history: TradingDate[] = candles.map((c) => c.date);
    const folds = walkForwardFolds(pair, history);
    allFolds.push(...folds);

    // --- PRE-LOAD per pair ONCE (performance; byte-identical reads) ---------
    // Bulk-load this pair's stored vectors and its full matured-outcome set from
    // the injected (hosted) stores in just two round-trips, then mirror them
    // into fresh in-memory stores. Every per-fold / per-date read below is then
    // served from `vectorMirror` / `analogueMirror` — the SAME ports with the
    // SAME filtering + ordering as the hosted adapters — so results are
    // identical while the per-date hosted round-trips disappear.
    const vectorMirror = new InMemoryPatternVectorStore();
    const analogueMirror = new InMemoryAnalogueStore();

    const storedVectors = await deps.vectorStore.getVectorsByAsset(pair);
    for (const vec of storedVectors) {
      await vectorMirror.upsertVector(
        vec.asset,
        vec.decisionDate,
        storedToPatternVector(vec),
      );
    }

    // The full matured set for the pair (sentinel beforeDate → superset). The
    // in-memory store re-applies `decisionDate < beforeDate` on each per-date /
    // per-fold `getMaturedOutcomes` call below, so loading the superset once and
    // letting the mirror re-filter reproduces every original call's result.
    const allMatured = await deps.analogueStore.getMaturedOutcomes(
      pair,
      FAR_FUTURE_BEFORE_DATE,
    );
    for (const record of allMatured) {
      await analogueMirror.upsertOutcome(record);
    }

    // From here on, read ONLY from the mirrors for this pair. Keep the port
    // types so the swap is purely about WHERE the rows come from.
    const vectorStore: PatternVectorStorePort = vectorMirror;
    const analogueStore: AnalogueStorePort = analogueMirror;

    for (const fold of folds) {
      // Build the firing subset and outcome arrays for each fold.
      // We read stored vectors to get dates; the actual gate evaluation
      // receives empty firingSubset / outcomes when no resolved data is
      // available — the composers mark those folds as skipped
      // (sample size < 30 floor).
      const firingSubset: Gate1FiringSample[] = [];
      const modelOutcomes: ForwardOutcome[] = [];
      const baselineOutcomes: ForwardOutcome[] = [];

      // Read matured analogue outcomes for this fold's test window (from the
      // in-memory mirror; same `matured && decisionDate < fold.testEnd` filter).
      const maturedOutcomes = await analogueStore.getMaturedOutcomes(
        pair,
        fold.testEnd,
      );

      for (const outcome of maturedOutcomes) {
        if (
          !(
            outcome.decisionDate >= fold.testStart &&
            outcome.decisionDate <= fold.testEnd &&
            outcome.matured
          )
        ) {
          continue;
        }

        // The stored pattern vector at this Decision_Date is BOTH the baseline's
        // weekly-trend source AND the query for honest model retrieval. Absent →
        // the date cannot be evaluated (no query, no baseline), so skip it.
        const vec = await vectorStore.getVector(pair, outcome.decisionDate);
        if (vec === null) continue;

        // --- MODEL prediction, sourced HONESTLY as of the Decision_Date ---
        // Retrieve the Analogue_Neighborhood using the stored vector as the
        // query. The look-ahead-safe filters inside `retrieve` (strictly
        // pre-date + matured-only + self-exclusion) structurally exclude this
        // date's own outcome, so the model never sees the value it is scored
        // against.
        const query: PatternVector = {
          scale10: vec.scaleDims.scale10,
          scale20: vec.scaleDims.scale20,
          scale40: vec.scaleDims.scale40,
          embedding: vec.embedding,
          weeklyTrendSign: vec.weeklyTrendSign,
          dim: vec.embedding.length,
        };
        const neighborhood: readonly AnalogueRecord[] = await retrieve(
          query,
          pair,
          outcome.decisionDate,
          outcome.decisionDate,
          vectorStore,
          analogueStore,
          retrievalConfig,
        );

        const horizon = selectHorizon(neighborhood);
        const modelDirection = dominantDirection(neighborhood, horizon);

        // No directional view (empty / below-floor neighborhood) ⇒ the model
        // does NOT fire on this date, mirroring the live pipeline. The date
        // simply contributes no firing sample (Sample_Size_Floor preserved).
        if (modelDirection === "FLAT") continue;

        const modelConfidence = earnedConfidence(neighborhood, horizon);
        const modelProfile = excursionProfileAt(neighborhood, horizon);

        // --- BASELINE prediction: Weekly_Trend_Follow (unchanged mapping) ---
        const baselineDirection =
          vec.weeklyTrendSign === "UP" ? "UP" : "DOWN";

        firingSubset.push({
          decisionDate: outcome.decisionDate,
          modelPrediction: modelDirection,
          baselinePrediction: baselineDirection,
          actual: outcome.direction,
          // Populate the model's Earned_Confidence so the Evaluation_Report's
          // strengthBreakdown buckets correctly (Design C1). It NEVER affects
          // any gate math — it is an annotation only.
          confidence: modelConfidence,
        } satisfies Gate1FiringSample);

        // Gate 2 model ForwardOutcome: the model's OWN retrieved-neighborhood
        // excursion profile (favorable/adverse pips at the selected horizon),
        // NOT the realized outcome's mfe/mae. The model direction is attached.
        // The profile is written to every horizon slot so whichever `horizon`
        // the composer reads from `fold.horizon`, it reads the model's own
        // excursions (the fold's horizon is 1 below, matching the live default).
        const modelHorizonOutcome = {
          direction: modelDirection,
          mfePips: modelProfile.favorablePips,
          maePips: modelProfile.adversePips,
        };
        const forwardOutcome: ForwardOutcome = {
          perHorizon: {
            1: modelHorizonOutcome,
            2: modelHorizonOutcome,
            3: modelHorizonOutcome,
          },
        };
        modelOutcomes.push(forwardOutcome);

        // Baseline ForwardOutcome keeps its OWN derivation: the realized
        // outcome's excursions with the Weekly_Trend_Follow direction. Because
        // the model excursions now come from the retrieved neighborhood, the
        // model and baseline ForwardOutcomes are NOT byte-identical by
        // construction (the former leak symptom).
        const baselineForwardOutcome: ForwardOutcome = {
          perHorizon: {
            1: { direction: baselineDirection, mfePips: outcome.mfePips, maePips: outcome.maePips },
            2: { direction: baselineDirection, mfePips: outcome.mfePips, maePips: outcome.maePips },
            3: { direction: baselineDirection, mfePips: outcome.mfePips, maePips: outcome.maePips },
          },
        };
        baselineOutcomes.push(baselineForwardOutcome);
      }

      foldInputs.push({
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

  return { foldInputs, allFolds };
}
