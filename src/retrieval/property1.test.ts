import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { retrieve } from "./retrieve.js";
import { InMemoryAnalogueStore } from "./types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import type { AnalogueRecord } from "./types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 1 (Retrieval Scope): Deterministic reproducibility
//
// For all identical inputs, retrieval returns identical analogue sets.
//
// Validates: Requirements 3.1, 9.7.

function buildWindow(
  startDateStr: string,
  count: number,
  pair: Pair,
  basePrice: number,
): Candle[] {
  const start = new Date(startDateStr + "T00:00:00Z");
  const window: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    let dt = new Date(start.getTime() + i * 86_400_000);
    while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) {
      dt = new Date(dt.getTime() + 86_400_000);
    }
    const date = dt.toISOString().slice(0, 10);
    price = Math.max(0.5, price + 0.001);
    window.push({
      asset: pair,
      date,
      open: price,
      high: price + 0.003,
      low: price - 0.003,
      close: price,
      source: "test",
    });
  }
  return window;
}

function addDays(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

describe("Property 1 (Retrieval Scope): Deterministic Reproducibility", () => {
  it(
    "calling retrieve twice with identical inputs returns identical analogue sets",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 8 }),
          fc.double({ min: 1.0, max: 1.5, noNaN: true }),
          async (numAnalogues, basePrice) => {
            const pair: Pair = "EURUSD";
            const vectorStore = new InMemoryPatternVectorStore();
            const analogueStore = new InMemoryAnalogueStore();

            const queryDate = "2025-06-01";
            const evalDate = "2025-09-01";

            // Seed analogues deterministically (same data both calls use)
            for (let i = 0; i < numAnalogues; i++) {
              const date = addDays("2025-01-01", i * 4);
              const window = buildWindow(date, 50, pair, basePrice + i * 0.01);
              const vec = encodePatternVector(window, addDays(date, 1));
              await vectorStore.upsertVector(pair, date, vec);
              const record: AnalogueRecord = {
                asset: pair,
                decisionDate: date,
                horizon: 1,
                direction: "UP",
                mfePips: 12,
                maePips: 6,
                atr14: 0.008,
                matured: true,
              };
              await analogueStore.upsertOutcome(record);
            }

            // Seed the query vector
            const queryWindow = buildWindow("2025-01-01", 50, pair, basePrice);
            const queryVec = encodePatternVector(queryWindow, queryDate);
            await vectorStore.upsertVector(pair, queryDate, queryVec);

            const config = { k: 10, epsilon: 2.0 };

            // Call retrieve twice with exactly the same inputs
            const run1 = await retrieve(queryVec, pair, queryDate, evalDate, vectorStore, analogueStore, config);
            const run2 = await retrieve(queryVec, pair, queryDate, evalDate, vectorStore, analogueStore, config);

            // Property 1: identical inputs → identical output (Req 3.1, 9.7)
            expect(run1.length).toBe(run2.length);
            for (let i = 0; i < run1.length; i++) {
              const a = run1[i]!;
              const b = run2[i]!;
              expect(a.decisionDate).toBe(b.decisionDate);
              expect(a.asset).toBe(b.asset);
              expect(a.horizon).toBe(b.horizon);
              expect(a.direction).toBe(b.direction);
              expect(a.mfePips).toBe(b.mfePips);
              expect(a.maePips).toBe(b.maePips);
              expect(a.cosineDistance).toBe(b.cosineDistance);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
