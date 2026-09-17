import { describe, expect, it } from "vitest";
import { retrieve } from "./retrieve.js";
import { InMemoryAnalogueStore } from "./types.js";
import { InMemoryPatternVectorStore, computeCosineDistance } from "../encoder/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import type { AnalogueRecord } from "./types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// Integration test: ANN retrieval ordering and metadata pre-filter.
// Validates: Requirement 9.1.

const PAIR: Pair = "EURUSD";

/** Build a simple synthetic candle window with a deterministic price trend. */
function buildWindow(
  startDateStr: string,
  count: number,
  stepPerDay: number,
  basePrice = 1.1,
): Candle[] {
  const start = new Date(startDateStr + "T00:00:00Z");
  const candles: Candle[] = [];
  let price = basePrice;
  let inserted = 0;
  let offset = 0;

  while (inserted < count) {
    const dt = new Date(start.getTime() + offset * 86_400_000);
    if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 5) {
      const date = dt.toISOString().slice(0, 10);
      price = Math.max(0.5, price + stepPerDay);
      candles.push({
        asset: PAIR,
        date,
        open: price,
        high: price + 0.004,
        low: price - 0.004,
        close: price,
        source: "test",
      });
      inserted++;
    }
    offset++;
  }
  return candles;
}

function addDays(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Derive a look-ahead-safe decision date: the day strictly after the last
 * candle in the window, so every candle is dated strictly before it.
 */
function decisionAfter(window: Candle[]): string {
  const last = window[window.length - 1]!;
  return addDays(last.date, 1);
}

describe("Integration: ANN retrieval ordering and metadata pre-filter (Requirement 9.1)", () => {
  it("retrieves analogues in cosine-distance ascending order (closest first)", async () => {
    const vectorStore = new InMemoryPatternVectorStore();
    const analogueStore = new InMemoryAnalogueStore();

    const queryDate = "2025-07-01";
    const evalDate = "2025-10-01";

    // Build a query window with an uptrend pattern
    const queryWindow = buildWindow("2025-01-01", 50, +0.002, 1.10);
    const queryVec = encodePatternVector(queryWindow, queryDate);
    await vectorStore.upsertVector(PAIR, queryDate, queryVec);

    // Analogue A: very similar to query (same uptrend)
    const windowA = buildWindow("2024-01-01", 50, +0.002, 1.10);
    const vecA = encodePatternVector(windowA, decisionAfter(windowA));
    await vectorStore.upsertVector(PAIR, "2024-02-20", vecA);
    const distA = computeCosineDistance([...queryVec.embedding], [...vecA.embedding]);

    // Analogue B: moderately similar (uptrend but slightly different magnitude)
    const windowB = buildWindow("2023-01-01", 50, +0.003, 1.10);
    const vecB = encodePatternVector(windowB, decisionAfter(windowB));
    await vectorStore.upsertVector(PAIR, "2023-02-20", vecB);
    const distB = computeCosineDistance([...queryVec.embedding], [...vecB.embedding]);

    // Analogue C: least similar (downtrend)
    const windowC = buildWindow("2022-01-01", 50, -0.002, 1.20);
    const vecC = encodePatternVector(windowC, decisionAfter(windowC));
    await vectorStore.upsertVector(PAIR, "2022-02-20", vecC);

    // Seed matured outcomes for A and B (same weeklyTrendSign as query)
    const seedRecord = (date: string): AnalogueRecord => ({
      asset: PAIR,
      decisionDate: date,
      horizon: 1,
      direction: "UP",
      mfePips: 20,
      maePips: 8,
      atr14: 0.009,
      matured: true,
    });
    await analogueStore.upsertOutcome(seedRecord("2024-02-20"));
    await analogueStore.upsertOutcome(seedRecord("2023-02-20"));
    // C gets no outcome — it will be filtered out regardless

    const results = await retrieve(
      queryVec,
      PAIR,
      queryDate,
      evalDate,
      vectorStore,
      analogueStore,
      { k: 10, epsilon: 2.0 },
    );

    // Must have retrieved at most the analogues with matured outcomes and matching trend
    expect(results.length).toBeGreaterThan(0);

    // Verify all returned analogues are strictly pre-date
    for (const r of results) {
      expect(r.decisionDate < queryDate).toBe(true);
      expect(r.matured).toBe(true);
    }

    // Ordering: cosine distance ascending (closest first)
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]!;
      const curr = results[i]!;
      expect((prev.cosineDistance ?? 0) <= (curr.cosineDistance ?? Infinity)).toBe(true);
    }

    // If both A and B survived (same weeklyTrendSign) and A is closer, A comes first
    const dateOrder = results.map((r) => r.decisionDate);
    if (dateOrder.includes("2024-02-20") && dateOrder.includes("2023-02-20")) {
      // Only assert order if A is actually closer than B
      if (distA < distB) {
        expect(dateOrder.indexOf("2024-02-20")).toBeLessThan(dateOrder.indexOf("2023-02-20"));
      }
    }
  });

  it("excludes analogues whose weeklyTrendSign does not match the query", async () => {
    const vectorStore = new InMemoryPatternVectorStore();
    const analogueStore = new InMemoryAnalogueStore();

    const queryDate = "2025-07-01";
    const evalDate = "2025-10-01";

    // Query with uptrend
    const queryWindow = buildWindow("2025-01-01", 50, +0.002, 1.10);
    const queryVec = encodePatternVector(queryWindow, queryDate);
    await vectorStore.upsertVector(PAIR, queryDate, queryVec);

    // Analogue with strong downtrend — likely different weeklyTrendSign
    const downtrendWindow = buildWindow("2023-01-01", 50, -0.003, 1.30);
    const downtrendVec = encodePatternVector(downtrendWindow, decisionAfter(downtrendWindow));
    await vectorStore.upsertVector(PAIR, "2023-02-20", downtrendVec);
    await analogueStore.upsertOutcome({
      asset: PAIR,
      decisionDate: "2023-02-20",
      horizon: 1,
      direction: "DOWN",
      mfePips: 5,
      maePips: 15,
      atr14: 0.009,
      matured: true,
    });

    const results = await retrieve(
      queryVec,
      PAIR,
      queryDate,
      evalDate,
      vectorStore,
      analogueStore,
      { k: 10, epsilon: 2.0 },
    );

    // If the downtrend analogue has a different weeklyTrendSign, it must not appear
    if (downtrendVec.weeklyTrendSign !== queryVec.weeklyTrendSign) {
      const found = results.find((r) => r.decisionDate === "2023-02-20");
      expect(found).toBeUndefined();
    }
  });

  it("excludes the query date from results (self-exclusion)", async () => {
    const vectorStore = new InMemoryPatternVectorStore();
    const analogueStore = new InMemoryAnalogueStore();

    const queryDate = "2025-07-01";
    const evalDate = "2025-10-01";

    const queryWindow = buildWindow("2025-01-01", 50, +0.002, 1.10);
    const queryVec = encodePatternVector(queryWindow, queryDate);
    await vectorStore.upsertVector(PAIR, queryDate, queryVec);

    // Also seed a matured outcome for queryDate — it must still be excluded
    await analogueStore.upsertOutcome({
      asset: PAIR,
      decisionDate: queryDate,
      horizon: 1,
      direction: "UP",
      mfePips: 20,
      maePips: 5,
      atr14: 0.009,
      matured: true,
    });

    const results = await retrieve(
      queryVec,
      PAIR,
      queryDate,
      evalDate,
      vectorStore,
      analogueStore,
      { k: 10, epsilon: 2.0 },
    );

    const selfFound = results.find((r) => r.decisionDate === queryDate);
    expect(selfFound).toBeUndefined();
  });

  it("returns analogues tagged with their cosine distance", async () => {
    const vectorStore = new InMemoryPatternVectorStore();
    const analogueStore = new InMemoryAnalogueStore();

    const queryDate = "2025-07-01";
    const evalDate = "2025-10-01";

    const queryWindow = buildWindow("2025-01-01", 50, +0.002, 1.10);
    const queryVec = encodePatternVector(queryWindow, queryDate);
    await vectorStore.upsertVector(PAIR, queryDate, queryVec);

    const analogueWindow = buildWindow("2024-01-01", 50, +0.002, 1.10);
    const analogueVec = encodePatternVector(analogueWindow, decisionAfter(analogueWindow));
    await vectorStore.upsertVector(PAIR, "2024-02-20", analogueVec);
    await analogueStore.upsertOutcome({
      asset: PAIR,
      decisionDate: "2024-02-20",
      horizon: 1,
      direction: "UP",
      mfePips: 18,
      maePips: 7,
      atr14: 0.009,
      matured: true,
    });

    const results = await retrieve(
      queryVec,
      PAIR,
      queryDate,
      evalDate,
      vectorStore,
      analogueStore,
      { k: 10, epsilon: 2.0 },
    );

    // Every returned record must have a cosineDistance attached
    for (const r of results) {
      expect(r.cosineDistance).toBeDefined();
      expect(r.cosineDistance!).toBeGreaterThanOrEqual(0);
      expect(r.cosineDistance!).toBeLessThanOrEqual(2.0);
    }
  });
});
