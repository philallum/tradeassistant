// End-to-End Daily-Run Pipeline Integration Test — task 11.1.
//
// Exercises the SINGLE daily-run path wired in task 11.1 as one flow:
//   ingestion (candles) → encoder → retrieval → resolver → confidence →
//   risk boundaries → dashboard `dailyRun`.
//
// It seeds the in-memory storage PORTs (the same interfaces the Supabase
// adapters implement), runs the real `runDailyPipeline` over all five pairs,
// feeds the produced `PairEvaluation[]` into the real `dailyRun`, and asserts:
//   - the pipeline returns exactly one evaluation per pair, in PAIRS order;
//   - a high-confidence pair surfaces a card carrying the pipeline-derived
//     direction / horizon / confidence / SL-TP;
//   - there is NO suppression step (the news suppressor and Gate_Auto_Block are
//     removed, Requirements 3.4, 3.5): a non-firing pair is an explicit
//     "no trade" observation, never a hidden one;
//   - the whole path is deterministic (identical inputs ⇒ identical view).

import { describe, expect, it } from "vitest";
import { InMemoryCandleStore, PAIRS, type Pair } from "../ingestion/index.js";
import { InMemoryPatternVectorStore } from "../encoder/index.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import { InMemoryAnalogueStore, type AnalogueRecord, type DirectionClass } from "../retrieval/index.js";
import type { Candle } from "../guard/types.js";
import { dailyRun } from "../dashboard/index.js";
import { DEFAULT_DASHBOARD_CONFIG } from "../dashboard/index.js";
import {
  runDailyPipeline,
  makePipelineLoader,
  DEFAULT_PIPELINE_CONFIG,
  type PipelineConfig,
  type PipelineDeps,
} from "./index.js";

// --- Fixture builders ------------------------------------------------------

/** Build a chronological run of daily candles ending strictly before `endExclusive`. */
function buildCandles(pair: Pair, startClose: number, count: number): Candle[] {
  const candles: Candle[] = [];
  let close = startClose;
  // Dates 2023-01-02 .. counting forward on weekdays (approx; only ordering matters).
  const start = new Date("2023-01-02T00:00:00Z");
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    const prev = close;
    close = close + Math.sin(i / 3) * 0.001 + 0.0005; // gentle uptrend, deterministic
    const high = Math.max(prev, close) + 0.0008;
    const low = Math.min(prev, close) - 0.0008;
    candles.push({ asset: pair, date, open: prev, high, low, close });
  }
  return candles;
}

/**
 * Seed a fully-firing neighborhood for a pair: >= 30 matured UP analogues at
 * every horizon, dated strictly before `decisionDate`, plus a stored pattern
 * vector per analogue with an embedding close to the query so retrieval admits
 * them within epsilon.
 */
async function seedFiringPair(
  pair: Pair,
  deps: PipelineDeps,
  queryEmbedding: readonly number[],
  weeklyTrendSign: "UP" | "DOWN",
): Promise<void> {
  const analogueCount = 40;
  for (let i = 0; i < analogueCount; i++) {
    const d = new Date("2022-01-03T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const analogueDate = d.toISOString().slice(0, 10);

    // Store a pattern vector near the query embedding (tiny per-analogue jitter).
    await deps.vectorStore.upsertVector(pair, analogueDate, {
      scale10: [],
      scale20: [],
      scale40: [],
      embedding: queryEmbedding.map((v) => v + i * 1e-6),
      weeklyTrendSign,
      dim: queryEmbedding.length,
    });

    // Store matured UP outcomes at all three horizons.
    for (const horizon of [1, 2, 3] as const) {
      const record: AnalogueRecord = {
        asset: pair,
        decisionDate: analogueDate,
        horizon,
        direction: "UP",
        mfePips: 20 + horizon,
        maePips: 8 + horizon,
        atr14: 15,
        matured: true,
      };
      await deps.analogueStore.upsertOutcome(record);
    }
  }
}

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    candleStore: new InMemoryCandleStore(),
    vectorStore: new InMemoryPatternVectorStore(),
    analogueStore: new InMemoryAnalogueStore(),
    ...overrides,
  };
}

const DECISION_DATE = "2023-06-01";

// --- Tests -----------------------------------------------------------------

describe("End-to-end daily-run pipeline wiring (task 11.1)", () => {
  it("returns exactly one PairEvaluation per pair, in canonical PAIRS order", async () => {
    const deps = makeDeps();
    // Give every pair some history so the encoder can run.
    for (const pair of PAIRS) {
      await deps.candleStore.upsertCandles(buildCandles(pair, 1.1, 50));
    }

    const evaluations = await runDailyPipeline(DECISION_DATE, deps);

    expect(evaluations.map((e) => e.pair)).toEqual([...PAIRS]);
  });

  it("surfaces a high-confidence pair through dailyRun with pipeline-derived fields", async () => {
    const deps = makeDeps();

    // Build EURUSD history and derive the exact query embedding the pipeline
    // will encode, so the seeded analogues sit within epsilon of the query.
    const candles = buildCandles("EURUSD", 1.1, 50);
    await deps.candleStore.upsertCandles(candles);
    const window = candles; // all dated before the decision date
    const query = encodePatternVector(window, DECISION_DATE);
    await seedFiringPair("EURUSD", deps, query.embedding, query.weeklyTrendSign);

    const evaluations = await runDailyPipeline(DECISION_DATE, deps);
    const eur = evaluations.find((e) => e.pair === "EURUSD");
    expect(eur).toBeDefined();
    // Dominant matured direction is UP; confidence is high with 40 analogues.
    expect(eur?.direction).toBe<DirectionClass>("UP");
    expect(eur?.earnedConfidence).toBeGreaterThanOrEqual(DEFAULT_DASHBOARD_CONFIG.confidenceThreshold);
    // >= 30 analogues ⇒ empirical boundaries are actionable (not null).
    expect(eur?.stopLossPips).not.toBeNull();
    expect(eur?.takeProfitPips).not.toBeNull();

    // Feed the pipeline output into the real dashboard entry point.
    const view = dailyRun(DECISION_DATE, evaluations);
    const card = view.cards.find((c) => c.pair === "EURUSD");
    expect(card).toBeDefined();
    expect(card?.direction).toBe<DirectionClass>("UP");
    expect(card?.horizon).toBe(eur?.horizon);
    expect(card?.stopLossPips).toBe(eur?.stopLossPips);
    expect(card?.takeProfitPips).toBe(eur?.takeProfitPips);
  });

  it("applies no suppression step: every pair is represented and a no-history pair is an explicit non-firing 'no trade' observation (Req 3.5)", async () => {
    const deps = makeDeps();
    // Only EURUSD gets history; the other four pairs have no candles at all, so
    // the pipeline must still represent them — as explicit non-firing FLAT
    // observations, never silently dropped.
    const candles = buildCandles("EURUSD", 1.1, 50);
    await deps.candleStore.upsertCandles(candles);
    const query = encodePatternVector(candles, DECISION_DATE);
    await seedFiringPair("EURUSD", deps, query.embedding, query.weeklyTrendSign);

    const evaluations = await runDailyPipeline(DECISION_DATE, deps);

    // Every one of the five pairs is represented in the observation set.
    expect(evaluations.map((e) => e.pair)).toEqual([...PAIRS]);

    // The no-history pairs are explicit non-firing FLAT observations.
    for (const pair of PAIRS) {
      if (pair === "EURUSD") continue;
      const ev = evaluations.find((e) => e.pair === pair);
      expect(ev).toBeDefined();
      expect(ev?.direction).toBe<DirectionClass>("FLAT");
    }

    // The firing EURUSD pair surfaces; the FLAT pairs render no directional
    // card (an explicit "no trade", not a suppressed one).
    const view = dailyRun(DECISION_DATE, evaluations);
    expect(view.cards.map((c) => c.pair)).toEqual(["EURUSD"]);
  });

  it("is deterministic: identical stored inputs and config yield an identical view (Requirement 3.1, 16.7)", async () => {
    const build = async (): Promise<PipelineDeps> => {
      const deps = makeDeps();
      const candles = buildCandles("EURUSD", 1.1, 50);
      await deps.candleStore.upsertCandles(candles);
      const query = encodePatternVector(candles, DECISION_DATE);
      await seedFiringPair("EURUSD", deps, query.embedding, query.weeklyTrendSign);
      return deps;
    };

    const first = dailyRun(DECISION_DATE, await runDailyPipeline(DECISION_DATE, await build()));
    const second = dailyRun(DECISION_DATE, await runDailyPipeline(DECISION_DATE, await build()));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  // --- Risk-boundaries is DISPLAY-ONLY (Requirement 7.6) -------------------
  //
  // Component 15 (`src/risk-boundaries/`) is retained ONLY to produce the
  // firing-card SL/TP (`stopLossPips` / `takeProfitPips`). This test proves it
  // feeds NO scoring path: perturbing the risk-boundary percentile config moves
  // the derived SL/TP but leaves every scoring field — Direction_Class, Horizon,
  // Earned_Confidence, the excursion profile, and the choppiness metric —
  // byte-for-byte identical. If any scoring value depended on the risk
  // boundaries, changing the config would perturb it; the equality below is the
  // display-only guarantee.
  it("is display-only: changing the risk-boundary config moves SL/TP but leaves all scoring fields byte-for-byte identical (Requirement 7.6)", async () => {
    // A firing neighborhood whose MAE/MFE excursions SPREAD across a range (not
    // a single constant), so distinct SL/TP percentiles yield distinct
    // boundaries and the config change is observable on the display fields.
    const seedSpreadFiringPair = async (
      deps: PipelineDeps,
      embedding: readonly number[],
      weeklyTrendSign: "UP" | "DOWN",
    ): Promise<void> => {
      const analogueCount = 40;
      for (let i = 0; i < analogueCount; i++) {
        const d = new Date("2022-01-03T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        const analogueDate = d.toISOString().slice(0, 10);
        await deps.vectorStore.upsertVector("EURUSD", analogueDate, {
          scale10: [],
          scale20: [],
          scale40: [],
          embedding: embedding.map((v) => v + i * 1e-6),
          weeklyTrendSign,
          dim: embedding.length,
        });
        for (const horizon of [1, 2, 3] as const) {
          const record: AnalogueRecord = {
            asset: "EURUSD",
            decisionDate: analogueDate,
            horizon,
            direction: "UP",
            // Spread deterministically across the 40 analogues so 0th/75th and
            // 50th/100th percentiles differ.
            mfePips: 20 + i,
            maePips: 8 + i * 0.5,
            atr14: 15,
            matured: true,
          };
          await deps.analogueStore.upsertOutcome(record);
        }
      }
    };

    const build = async (): Promise<PipelineDeps> => {
      const deps = makeDeps();
      const candles = buildCandles("EURUSD", 1.1, 50);
      await deps.candleStore.upsertCandles(candles);
      const query = encodePatternVector(candles, DECISION_DATE);
      await seedSpreadFiringPair(deps, query.embedding, query.weeklyTrendSign);
      return deps;
    };

    // Two configurations identical except for the risk-boundary percentiles.
    // The second drives SL to the sample MIN (0th pct) and TP to the MAX
    // (100th pct) of the SAME neighborhood, maximally diverging the boundaries.
    const baseConfig: PipelineConfig = DEFAULT_PIPELINE_CONFIG;
    const perturbedConfig: PipelineConfig = {
      ...DEFAULT_PIPELINE_CONFIG,
      riskBoundaries: { stopLossPercentile: 0, takeProfitPercentile: 100 },
    };

    const baseDeps = { ...(await build()), config: baseConfig };
    const perturbedDeps = { ...(await build()), config: perturbedConfig };

    const baseEvals = await runDailyPipeline(DECISION_DATE, baseDeps);
    const perturbedEvals = await runDailyPipeline(DECISION_DATE, perturbedDeps);

    const baseEur = baseEvals.find((e) => e.pair === "EURUSD");
    const perturbedEur = perturbedEvals.find((e) => e.pair === "EURUSD");
    expect(baseEur).toBeDefined();
    expect(perturbedEur).toBeDefined();

    // Precondition: the firing neighborhood is above the floor, so the boundary
    // config actually bites. Both SL and TP must be actionable (non-null).
    expect(baseEur?.stopLossPips).not.toBeNull();
    expect(baseEur?.takeProfitPips).not.toBeNull();
    expect(perturbedEur?.stopLossPips).not.toBeNull();
    expect(perturbedEur?.takeProfitPips).not.toBeNull();

    // The ONLY observable effect of the config change is on the SL/TP display
    // fields: the different percentiles produce different boundaries.
    expect(perturbedEur?.stopLossPips).not.toBe(baseEur?.stopLossPips);
    expect(perturbedEur?.takeProfitPips).not.toBe(baseEur?.takeProfitPips);

    // Every SCORING field is byte-for-byte identical across the two runs — the
    // risk boundaries never cross into the firing / scoring computation.
    for (const pair of PAIRS) {
      const a = baseEvals.find((e) => e.pair === pair)!;
      const b = perturbedEvals.find((e) => e.pair === pair)!;
      expect(b.direction).toBe(a.direction);
      expect(b.horizon).toBe(a.horizon);
      expect(b.earnedConfidence).toBe(a.earnedConfidence);
      expect(b.excursionProfile).toEqual(a.excursionProfile);
      expect(b.choppiness).toBe(a.choppiness);
    }
  });

  it("makePipelineLoader adapts the pipeline to the scheduled-runner loader seam", async () => {
    const deps = makeDeps();
    for (const pair of PAIRS) {
      await deps.candleStore.upsertCandles(buildCandles(pair, 1.2, 45));
    }
    const loader = makePipelineLoader(deps);
    const supabase = { target: "local", url: "http://localhost", key: "k" } as const;
    const evaluations = await loader(DECISION_DATE, supabase);
    expect(evaluations.map((e) => e.pair)).toEqual([...PAIRS]);
  });
});
