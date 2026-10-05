// Property 29: The last candle date never produces an outcome row.
//
// Feature: operational-wiring, Property 29: No outcome is written for a date with no forward candles
//
// `resolve(...)` can only resolve a forward outcome for an analogue date that
// has at least one candle dated strictly AFTER it. The latest stored candle
// date has no such forward candle, so resolveHistoricalOutcomes must never
// write any `analogue_outcomes` row keyed to it — and the number of resolved
// dates can never exceed (candleCount - 1).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pair } from "../../ingestion/types.js";
import { resolveHistoricalOutcomes } from "./outcomeResolution.js";
import {
  ascendingCandleSeries,
  dateFromOffset,
  makeInMemoryStores,
  seedPair,
  toCandles,
} from "./testHelpers.js";

// Feature: operational-wiring, Property 29: No outcome is written for a date with no forward candles

describe("Property 29: The last candle date never produces an outcome row", () => {
  it(
    "no row is keyed to the latest candle date, and datesResolved <= candleCount - 1",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<Pair>("EURUSD", "USDJPY", "USDCAD"),
          ascendingCandleSeries({ minLength: 1, maxLength: 25 }),
          fc.integer({ min: 0, max: 2100 }),
          // Exercise both production (vector gate on) and the test-disabled
          // gate: the forward-candle guard must hold either way.
          fc.boolean(),
          async (pair, series, evalOffset, requireVector) => {
            const bundle = makeInMemoryStores();
            const candles = toCandles(pair, series);
            await seedPair(bundle, pair, candles, { withVectors: true });

            const evalDate = dateFromOffset(evalOffset);

            const result = await resolveHistoricalOutcomes({
              stores: bundle.stores,
              evalDate,
              requireVector,
            });

            // The latest stored candle date.
            const lastDate = candles[candles.length - 1]!.date;

            // No analogue_outcomes row is keyed to the last candle date.
            const lastRows = await bundle.analogueStore.getOutcomes(
              pair,
              lastDate,
            );
            expect(lastRows.length).toBe(0);

            // datesResolved can never exceed candleCount - 1 (the last date is
            // always excluded). A single-candle series resolves nothing.
            const pairSummary = result.perPair.find((p) => p.pair === pair)!;
            expect(pairSummary.datesResolved).toBeLessThanOrEqual(
              candles.length - 1,
            );
            if (candles.length === 1) {
              expect(pairSummary.datesResolved).toBe(0);
              expect(pairSummary.outcomesWritten).toBe(0);
            }

            // Rows-written accounting: exactly 3 horizon rows per resolved date.
            expect(pairSummary.outcomesWritten).toBe(
              pairSummary.datesResolved * 3,
            );
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
