// Per-day evaluation records (offline measurement harness).
//
// For every (pair, date) in a window this reproduces what the live pipeline would have decided
// using ONLY history strictly before that date - the same `retrieve` -> `selectHorizon` ->
// `dominantDirection` -> `earnedConfidence` calls `buildFoldInputs` uses - and attaches the
// realised next-session result computed straight from candles. Everything the evidence tasks
// slice by (neighbourhood size, mean cosine distance, ATR percentile, weekday ...) is captured
// here once, so baselines, expectancy, slices and the FLAT A/B all read the same records.
//
// Read-only and deterministic. It feeds nothing back into retrieval, confidence or firing.
import { computeAtr14 } from "../../confidence/atr.js";
import { earnedConfidence, selectHorizon } from "../../confidence/index.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../../dashboard/types.js";
import { computeCosineDistance } from "../../encoder/types.js";
import type { PatternVector, WeeklyTrendSign } from "../../encoder/types.js";
import type { Candle, TradingDate } from "../../guard/types.js";
import { PAIRS, type Pair } from "../../ingestion/types.js";
import { dominantDirection } from "../../pipeline/dailyPipeline.js";
import type { PipelineStores } from "../../pipeline/types.js";
import { DEFAULT_RETRIEVAL_CONFIG } from "../../pipeline/types.js";
import { derive as deriveRiskBoundaries } from "../../risk-boundaries/empiricalRiskBoundaries.js";
import { retrieve } from "../../retrieval/retrieve.js";
import type { AnalogueRecord, DirectionClass, RetrievalConfig } from "../../retrieval/types.js";
import { pipSize } from "../../trade-sim/pip.js";

/** Which session the realised result is measured on, relative to the record's date. */
export type TargetSession = "after_decision_date" | "on_decision_date";

export interface DayRecord {
  readonly pair: Pair;
  readonly date: TradingDate;
  /** 0 = Sunday ... 6 = Saturday (UTC calendar day of the date label). */
  readonly weekday: number;
  readonly weeklyTrendSign: WeeklyTrendSign;
  /** The model's dominant direction (FLAT = no directional view). */
  readonly direction: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly confidence: number;
  /** True when the live firing rule holds: a directional view with confidence >= threshold. */
  readonly fires: boolean;
  /** Analogue neighbourhood size n. */
  readonly n: number;
  /** Mean cosine distance of the neighbourhood to the query (null when n = 0). */
  readonly meanCosineDistance: number | null;
  /** ATR_14 over candles strictly before the date, in price units. */
  readonly atr14: number;
  /** Rank (0..1) of that ATR within the pair's prior ATR values (null with too little history). */
  readonly atrPercentile: number | null;
  /** Empirical stop (P75 of neighbourhood MAE) in pips; null below the 30-analogue floor. */
  readonly stopLossPips?: number | null;
  /** Empirical target (P50 of neighbourhood MFE) in pips; null below the 30-analogue floor. */
  readonly takeProfitPips?: number | null;
  /** Sign of the last completed session before the date (the "follow yesterday" input). */
  readonly yesterdaySign: "UP" | "DOWN" | "FLAT" | null;
  /** Realised result of the first session strictly AFTER the date (the live convention). */
  readonly realizedAfter: Realized | null;
  /** Realised result of the session labelled with the date itself. */
  readonly realizedOn: Realized | null;
}

/** A session's open-to-close result. */
export interface Realized {
  readonly sign: "UP" | "DOWN" | "FLAT";
  /** Signed open-to-close move in pips. */
  readonly pips: number;
}

/** The realised result of the chosen target session. */
export function realizedFor(record: DayRecord, session: TargetSession): Realized | null {
  return session === "on_decision_date" ? record.realizedOn : record.realizedAfter;
}

export interface DayRecordOptions {
  readonly window: { readonly start: TradingDate; readonly end: TradingDate };
  readonly retrieval?: RetrievalConfig;
  readonly confidenceThreshold?: number;
  /** Prior ATR values used for the percentile rank. */
  readonly atrPercentileLookback?: number;
  /** Optional hook to post-filter a retrieved neighbourhood (offline experiments only). */
  readonly neighbourhoodFilter?: (
    neighbourhood: readonly AnalogueRecord[],
    context: { readonly pair: Pair; readonly date: TradingDate; readonly atr14: number },
  ) => readonly AnalogueRecord[];
  readonly onProgress?: (pair: Pair, done: number, total: number) => void;
}

/** Minimum prior ATR values before a percentile is reported. */
const MIN_ATR_HISTORY = 60;

function percentileRank(prior: readonly number[], value: number): number {
  let below = 0;
  for (const p of prior) if (p < value) below += 1;
  return below / prior.length;
}

/** Generate the evaluation records for every pair over the window. */
export async function collectDayRecords(
  stores: PipelineStores,
  options: DayRecordOptions,
): Promise<readonly DayRecord[]> {
  const retrievalConfig = options.retrieval ?? DEFAULT_RETRIEVAL_CONFIG;
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const atrLookback = options.atrPercentileLookback ?? 250;
  const records: DayRecord[] = [];

  for (const pair of PAIRS) {
    const candles: readonly Candle[] = await stores.candleStore.getCandles(pair);
    if (candles.length === 0) continue;

    // ATR_14 as the live pipeline sees it for each date: candles strictly before the date.
    const atrByIndex: number[] = new Array<number>(candles.length).fill(0);
    for (let i = 0; i < candles.length; i += 1) {
      atrByIndex[i] = computeAtr14(candles.slice(Math.max(0, i - 60), i));
    }

    const inWindow = candles
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.date >= options.window.start && c.date <= options.window.end);

    let done = 0;
    for (const { c, i } of inWindow) {
      done += 1;
      options.onProgress?.(pair, done, inWindow.length);
      const stored = await stores.vectorStore.getVector(pair, c.date);
      if (stored === null) continue;
      const query: PatternVector = {
        scale10: stored.scaleDims.scale10,
        scale20: stored.scaleDims.scale20,
        scale40: stored.scaleDims.scale40,
        embedding: stored.embedding,
        weeklyTrendSign: stored.weeklyTrendSign,
        dim: stored.embedding.length,
      };
      let neighbourhood = await retrieve(
        query,
        pair,
        c.date,
        c.date,
        stores.vectorStore,
        stores.analogueStore,
        retrievalConfig,
      );
      const atr14 = atrByIndex[i] ?? 0;
      if (options.neighbourhoodFilter !== undefined) {
        neighbourhood = options.neighbourhoodFilter(neighbourhood, { pair, date: c.date, atr14 });
      }
      const horizon = selectHorizon(neighbourhood);
      const direction = dominantDirection(neighbourhood, horizon);
      const confidence = earnedConfidence(neighbourhood, horizon);

      let distanceSum = 0;
      let distanceCount = 0;
      for (const a of neighbourhood) {
        const v = await stores.vectorStore.getVector(a.asset, a.decisionDate);
        if (v === null) continue;
        distanceSum += computeCosineDistance(query.embedding, v.embedding);
        distanceCount += 1;
      }

      const boundaries = deriveRiskBoundaries(neighbourhood, horizon);

      const priorAtr = atrByIndex.slice(Math.max(0, i - atrLookback), i).filter((x) => x > 0);
      const atrPercentile =
        priorAtr.length >= MIN_ATR_HISTORY && atr14 > 0 ? percentileRank(priorAtr, atr14) : null;

      const toRealized = (session: Candle | undefined): Realized | null => {
        if (session === undefined) return null;
        const move = session.close - session.open;
        return {
          sign: move > 0 ? "UP" : move < 0 ? "DOWN" : "FLAT",
          pips: Math.round((move / pipSize(pair)) * 10) / 10,
        };
      };

      records.push({
        pair,
        date: c.date,
        weekday: new Date(`${c.date}T00:00:00Z`).getUTCDay(),
        weeklyTrendSign: stored.weeklyTrendSign,
        direction,
        horizon,
        confidence,
        fires: direction !== "FLAT" && confidence >= threshold,
        stopLossPips: boundaries?.stopLossPips ?? null,
        takeProfitPips: boundaries?.takeProfitPips ?? null,
        n: neighbourhood.length,
        meanCosineDistance: distanceCount === 0 ? null : distanceSum / distanceCount,
        atr14,
        atrPercentile,
        yesterdaySign: toRealized(candles[i - 1])?.sign ?? null,
        realizedAfter: toRealized(candles[i + 1]),
        realizedOn: toRealized(c),
      });
    }
  }
  return records;
}
