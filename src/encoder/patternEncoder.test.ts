import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIM,
  InMemoryPatternVectorStore,
  computeCosineDistance,
  encodePatternVector,
  normalizeShapeSlice,
  weeklyTrendSign,
} from "./index.js";
import type { Candle } from "../guard/types.js";

function makeCandles(
  count: number,
  baseClose = 1.1,
  trendStep = 0.001,
  startDate = "2026-01-01",
): Candle[] {
  const candles: Candle[] = [];
  const start = new Date(startDate);

  for (let i = 0; i < count; i++) {
    const dt = new Date(start.getTime() + i * 86_400_000);
    const dateStr = dt.toISOString().slice(0, 10);
    const close = baseClose + i * trendStep;
    candles.push({
      asset: "EURUSD",
      date: dateStr,
      open: close - 0.0005,
      high: close + 0.001,
      low: close - 0.001,
      close,
      source: "test-feed",
    });
  }
  return candles;
}

describe("Pattern Vector Encoder (Requirement 8)", () => {
  it("encodes 40-candle window into 70-dimensional embedding and multi-scale slices", () => {
    const candles = makeCandles(40, 1.1, 0.002, "2026-01-01");
    // Last candle is on 2026-02-09, so decisionDate is 2026-02-10
    const decisionDate = "2026-02-10";

    const vector = encodePatternVector(candles, decisionDate);

    expect(vector.dim).toBe(70);
    expect(vector.embedding).toHaveLength(70);
    expect(vector.scale10).toHaveLength(10);
    expect(vector.scale20).toHaveLength(20);
    expect(vector.scale40).toHaveLength(40);
    expect(vector.embedding).toEqual([
      ...vector.scale10,
      ...vector.scale20,
      ...vector.scale40,
    ]);
  });

  it("calculates weeklyTrendSign correctly (5-day rolling ROC)", () => {
    // Upward trend: Close_T > Close_{T-5}
    const upCandles = makeCandles(40, 1.1, 0.002, "2026-01-01");
    expect(weeklyTrendSign(upCandles, "2026-02-10")).toBe("UP");

    // Downward trend: Close_T < Close_{T-5}
    const downCandles = makeCandles(40, 1.2, -0.002, "2026-01-01");
    expect(weeklyTrendSign(downCandles, "2026-02-10")).toBe("DOWN");
  });

  it("enforces the Look-Ahead Guard and rejects windows with future candles", () => {
    const candles = makeCandles(10, 1.1, 0.001, "2026-01-01");
    // Decision date set to 2026-01-05, but candles exist up to 2026-01-10
    expect(() => encodePatternVector(candles, "2026-01-05")).toThrow(
      /Look-ahead violation/i,
    );
    expect(() => weeklyTrendSign(candles, "2026-01-05")).toThrow(
      /Look-ahead violation/i,
    );
  });

  it("handles degenerate (zero-variance) windows cleanly with zero vectors (Requirement 8.6)", () => {
    const flatCandles = makeCandles(40, 1.1, 0.0, "2026-01-01"); // all closes = 1.1
    const vector = encodePatternVector(flatCandles, "2026-02-10");

    expect(vector.dim).toBe(EMBEDDING_DIM);
    expect(vector.embedding).toHaveLength(70);
    expect(vector.embedding.every((v) => v === 0)).toBe(true);
    expect(vector.scale10.every((v) => v === 0)).toBe(true);
    expect(vector.scale20.every((v) => v === 0)).toBe(true);
    expect(vector.scale40.every((v) => v === 0)).toBe(true);
    expect(vector.weeklyTrendSign).toBe("UP"); // flat difference >= 0 is UP
  });

  it("normalizes shape slices with zero mean and unit variance", () => {
    const prices = [1.1, 1.12, 1.15, 1.13, 1.16, 1.18, 1.14, 1.17, 1.2, 1.19];
    const normalized = normalizeShapeSlice(prices);

    expect(normalized).toHaveLength(10);
    const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
    const variance =
      normalized.reduce((a, b) => a + (b - mean) ** 2, 0) / normalized.length;

    expect(mean).toBeCloseTo(0.0, 9);
    expect(variance).toBeCloseTo(1.0, 9);
  });
});

describe("Pattern Vector Storage & Retrieval (Requirement 8.4, 9.1, 9.2)", () => {
  it("persists and reads back pattern vectors with metadata", async () => {
    const store = new InMemoryPatternVectorStore();
    const candles = makeCandles(40, 1.1, 0.001, "2026-01-01");
    const vector = encodePatternVector(candles, "2026-02-10");

    await store.upsertVector("EURUSD", "2026-02-10", vector);

    const stored = await store.getVector("EURUSD", "2026-02-10");
    expect(stored).not.toBeNull();
    expect(stored?.asset).toBe("EURUSD");
    expect(stored?.decisionDate).toBe("2026-02-10");
    expect(stored?.embedding).toEqual(vector.embedding);
    expect(stored?.weeklyTrendSign).toBe("UP");
    expect(stored?.scaleDims.scale10).toEqual(vector.scale10);
    expect(stored?.scaleDims.scale20).toEqual(vector.scale20);
    expect(stored?.scaleDims.scale40).toEqual(vector.scale40);
  });

  it("queries nearest vectors by cosine distance pre-filtering on weeklyTrendSign", async () => {
    const store = new InMemoryPatternVectorStore();

    const upCandles1 = makeCandles(40, 1.1, 0.002, "2026-01-01");
    const upVector1 = encodePatternVector(upCandles1, "2026-02-10");
    await store.upsertVector("EURUSD", "2026-02-10", upVector1);

    const upCandles2 = makeCandles(40, 1.15, 0.0019, "2026-01-01");
    const upVector2 = encodePatternVector(upCandles2, "2026-02-11");
    await store.upsertVector("EURUSD", "2026-02-11", upVector2);

    const downCandles = makeCandles(40, 1.2, -0.002, "2026-01-01");
    const downVector = encodePatternVector(downCandles, "2026-02-12");
    await store.upsertVector("EURUSD", "2026-02-12", downVector);

    // Query for UP regime
    const nearestUp = await store.queryNearest(upVector1.embedding, "UP");
    expect(nearestUp).toHaveLength(2);
    expect(nearestUp.every((r) => r.vector.weeklyTrendSign === "UP")).toBe(true);
    // Closest match should be upVector1 itself (distance 0)
    expect(nearestUp[0]?.cosineDistance).toBeCloseTo(0.0, 6);

    // Query for DOWN regime should only return downVector
    const nearestDown = await store.queryNearest(upVector1.embedding, "DOWN");
    expect(nearestDown).toHaveLength(1);
    expect(nearestDown[0]?.vector.weeklyTrendSign === "DOWN");
  });

  it("computes cosine distance correctly", () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];
    const c = [-1, -2, -3];

    expect(computeCosineDistance(a, b)).toBeCloseTo(0.0, 9);
    expect(computeCosineDistance(a, c)).toBeCloseTo(2.0, 9);
  });
});
