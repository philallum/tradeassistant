import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { OhlcIngestion } from "./ohlcIngestion.js";
import { InMemoryCandleStore, PAIRS } from "./types.js";
import type { Pair, RawCandle } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 33: Idempotent ingestion
//
// For all source candle sets, ingesting the set once and ingesting it multiple
// times produce the same stored result with no duplicate (Asset, Date) rows.
//
// Validates: Requirement 7.4.

const validRawCandleArb = (pair: Pair): fc.Arbitrary<RawCandle> =>
  fc
    .tuple(
      fc.integer({ min: 2020, max: 2026 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
      fc.double({ min: 0.5, max: 150.0, noNaN: true }),
      fc.double({ min: 0.001, max: 2.0, noNaN: true }),
    )
    .map(([y, m, d, low, height]) => {
      const date = `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
      return {
        asset: pair,
        date,
        open: low + height * 0.3,
        high: low + height,
        low,
        close: low + height * 0.7,
        source: "idempotent-test",
      };
    });

describe("Property 33: Idempotent ingestion", () => {
  it("ingesting once vs multiple times produces the identical stored result with no duplicates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Pair>(...PAIRS),
        fc.array(
          fc.constantFrom<Pair>(...PAIRS).chain((p) => validRawCandleArb(p)),
          { minLength: 1, maxLength: 30 },
        ),
        fc.integer({ min: 2, max: 5 }), // Number of duplicate ingestion cycles
        async (pair, rawCandles, repeatCount) => {
          const store = new InMemoryCandleStore();
          const ingestion = new OhlcIngestion(store);

          // First ingestion pass
          await ingestion.ingest(pair, rawCandles);
          const firstStored = await ingestion.getCandles(pair);

          // Ingest same batch multiple additional times
          for (let i = 0; i < repeatCount; i++) {
            await ingestion.ingest(pair, rawCandles);
          }
          const repeatedStored = await ingestion.getCandles(pair);

          // 1. Stored array must be strictly identical after repeated ingestion
          expect(repeatedStored).toEqual(firstStored);

          // 2. There must be zero duplicate dates stored for the pair
          const dates = repeatedStored.map((c) => c.date);
          const uniqueDates = new Set(dates);
          expect(dates.length).toBe(uniqueDates.size);

          // 3. Every row has matching asset
          expect(repeatedStored.every((c) => c.asset === pair)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
