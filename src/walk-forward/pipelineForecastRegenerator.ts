// Pipeline-backed ForecastRegenerator — trader-edge-validation Stage D (task 12;
// design R7). The PRODUCTION seam the walk-forward harness uses to regenerate a
// window's forecasts under a FROZEN Parameter_Set by running the live pipeline
// (`evaluatePair`) — the signal is NEVER re-implemented (R7.1, R7.3).
//
// It maps the frozen `ParameterSet` to a `PipelineConfig` (so retrieval /
// windowSize / SL-TP percentiles are the frozen values), enumerates the OOS
// trading dates per pair from the candle store, evaluates each (pair, date)
// through the pipeline, and projects each `PairEvaluation` to a `LedgerForecast`.
// Horizon selection is governed by the frozen set and performed inside the
// pipeline's `selectHorizon`, so the OOS data cannot re-choose it (R7.4).
//
// Pure wrt the live decision: it only READS stored candles/vectors/analogues and
// computes forecasts; it writes nothing and touches no firing/scoring path.

import type { PipelineConfig, PipelineStores } from "../pipeline/types.js";
import { evaluatePair } from "../pipeline/dailyPipeline.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { LedgerForecast } from "../trade-ledger/buildTradeLedger.js";
import type { ForecastRegenerator, DateWindow } from "./walkForward.js";
import type { ParameterSet } from "./parameterSet.js";

/** Project a frozen {@link ParameterSet} onto the pipeline's {@link PipelineConfig}. */
export function parameterSetToPipelineConfig(params: ParameterSet): PipelineConfig {
  return {
    retrieval: { k: params.retrievalK, epsilon: params.similarityEpsilon },
    windowSize: params.windowSize,
    riskBoundaries: {
      stopLossPercentile: params.stopLossPercentile,
      takeProfitPercentile: params.takeProfitPercentile,
    },
  };
}

/**
 * Build a {@link ForecastRegenerator} bound to the pipeline stores. Each call
 * regenerates forecasts for the OOS window under the frozen set, projecting the
 * pipeline's `PairEvaluation` to a `LedgerForecast` and computing `fired` from
 * the frozen Confidence_Threshold so the firing bar is itself part of the frozen
 * set (R7.3). The narrative resolver is left at its empty default (LLM-free).
 */
export function pipelineForecastRegenerator(
  stores: PipelineStores,
): ForecastRegenerator {
  return async (
    params: ParameterSet,
    outOfSample: DateWindow,
    strategyId: string,
  ): Promise<readonly LedgerForecast[]> => {
    const config = parameterSetToPipelineConfig(params);
    const forecasts: LedgerForecast[] = [];

    for (const pair of PAIRS) {
      const dates = await oosTradingDates(stores, pair, outOfSample);
      for (const decisionDate of dates) {
        const evaluation = await evaluatePair(pair, decisionDate, stores, config);
        const fired =
          evaluation.direction !== "FLAT" &&
          evaluation.earnedConfidence >= params.confidenceThreshold;
        forecasts.push({
          strategyId,
          pair,
          decisionDate,
          fired,
          direction: evaluation.direction,
          horizon: evaluation.horizon,
          earnedConfidence: evaluation.earnedConfidence,
          stopLossPips: evaluation.stopLossPips,
          takeProfitPips: evaluation.takeProfitPips,
        });
      }
    }

    // Deterministic order: date, then pair (mirrors the ledger's own sort).
    forecasts.sort(
      (a, b) => a.decisionDate.localeCompare(b.decisionDate) || a.pair.localeCompare(b.pair),
    );
    return forecasts;
  };
}

/** The stored trading dates for a pair within the inclusive OOS span. */
async function oosTradingDates(
  stores: PipelineStores,
  pair: Pair,
  window: DateWindow,
): Promise<readonly TradingDate[]> {
  const candles = await stores.candleStore.getCandles(pair, window.start, window.end);
  const dates = candles
    .filter((c) => c.asset === pair && c.date >= window.start && c.date <= window.end)
    .map((c) => c.date);
  // De-dupe + ascending (the store usually sorts, but be defensive).
  return [...new Set(dates)].sort((a, b) => a.localeCompare(b));
}
