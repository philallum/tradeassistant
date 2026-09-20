// End-to-End Daily-Run Pipeline Integration Test — task 11.1.
//
// Exercises the SINGLE daily-run path wired in task 11.1 as one flow:
//   ingestion (candles) → encoder → retrieval → resolver → confidence →
//   risk boundaries → (gate + news resolvers) → dashboard `dailyRun`.
//
// It seeds the in-memory storage PORTs (the same interfaces the Supabase
// adapters implement), runs the real `runDailyPipeline` over all five pairs,
// feeds the produced `PairEvaluation[]` into the real `dailyRun`, and asserts:
//   - the pipeline returns exactly one evaluation per pair, in PAIRS order;
//   - a gate-passing, high-confidence, news-permitted pair surfaces a card
//     carrying the pipeline-derived direction / horizon / confidence / SL-TP;
//   - the gate and news resolvers act as hard vetoes on the firing decision;
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

  it("surfaces a gate-passing, high-confidence, news-permitted pair through dailyRun with pipeline-derived fields", async () => {
    const deps = makeDeps({
      // Only EURUSD is gate-passing; news permits all.
      gatePassing: (pair) => pair === "EURUSD",
    });

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
    expect(eur?.gatePassing).toBe(true);
    expect(eur?.newsSuppressed).toBe(false);
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

  it("treats the gate resolver as a hard veto: a non-gate-passing pair never surfaces", async () => {
    const deps = makeDeps({ gatePassing: () => false });
    const candles = buildCandles("EURUSD", 1.1, 50);
    await deps.candleStore.upsertCandles(candles);
    const query = encodePatternVector(candles, DECISION_DATE);
    await seedFiringPair("EURUSD", deps, query.embedding, query.weeklyTrendSign);

    const evaluations = await runDailyPipeline(DECISION_DATE, deps);
    const view = dailyRun(DECISION_DATE, evaluations);
    expect(view.cards).toHaveLength(0); // silent by default
  });

  it("treats the news resolver as a hard veto: a suppressed pair never surfaces even when it would otherwise fire", async () => {
    const deps = makeDeps({
      gatePassing: () => true,
      news: () => ({ suppressed: true, reason: "elevated event risk" }),
    });
    const candles = buildCandles("EURUSD", 1.1, 50);
    await deps.candleStore.upsertCandles(candles);
    const query = encodePatternVector(candles, DECISION_DATE);
    await seedFiringPair("EURUSD", deps, query.embedding, query.weeklyTrendSign);

    const evaluations = await runDailyPipeline(DECISION_DATE, deps);
    const eur = evaluations.find((e) => e.pair === "EURUSD");
    expect(eur?.newsSuppressed).toBe(true);
    const view = dailyRun(DECISION_DATE, evaluations);
    expect(view.cards).toHaveLength(0);
  });

  it("is deterministic: identical stored inputs and config yield an identical view (Requirement 3.1, 16.7)", async () => {
    const build = async (): Promise<PipelineDeps> => {
      const deps = makeDeps({ gatePassing: (p) => p === "EURUSD" });
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

  it("makePipelineLoader adapts the pipeline to the scheduled-runner loader seam", async () => {
    const deps = makeDeps({ gatePassing: () => false });
    for (const pair of PAIRS) {
      await deps.candleStore.upsertCandles(buildCandles(pair, 1.2, 45));
    }
    const loader = makePipelineLoader(deps);
    const supabase = { target: "local", url: "http://localhost", key: "k" } as const;
    const evaluations = await loader(DECISION_DATE, supabase);
    expect(evaluations.map((e) => e.pair)).toEqual([...PAIRS]);
  });
});
