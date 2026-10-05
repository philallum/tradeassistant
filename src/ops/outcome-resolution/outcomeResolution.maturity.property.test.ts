// Property 28: Every written outcome's maturity flag matches the guard.
//
// Feature: operational-wiring, Property 28: For every written outcome, matured equals isMatured(decisionDate, horizon, evalDate)
//
// resolveHistoricalOutcomes delegates maturity entirely to the EXISTING
// `resolve(...)`, which stamps each row's `matured` flag as
// `isMatured(analogueDate, horizon, evalDate)` from the Look-Ahead Guard. This
// property pins that contract end-to-end: for EVERY row the pass writes, its
// stored `matured` must equal the guard's verdict for that row's own
// decisionDate / horizon and the pass's evalDate.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pair } from "../../ingestion/types.js";
import { isMatured } from "../../guard/lookAheadGuard.js";
import { resolveHistoricalOutcomes } from "./outcomeResolution.js";
import {
  ascendingCandleSeries,
  dateFromOffset,
  makeInMemoryStores,
  seedPair,
  toCandles,
} from "./testHelpers.js";

// Feature: operational-wiring, Property 28: For every written outcome, matured equals isMatured(decisionDate, horizon, evalDate)

describe("Property 28: Every written outcome's maturity flag matches the guard", () => {
  it(
    "each stored row's matured flag equals isMatured(decisionDate, horizon, evalDate)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<Pair>("EURUSD", "USDJPY", "USDCHF"),
          ascendingCandleSeries({ minLength: 2, maxLength: 20 }),
          // Vary evalDate across the whole offset range so BOTH matured and
          // not-yet-matured rows are exercised (an evalDate before the series
          // yields all-false; well after yields all-true).
          fc.integer({ min: 0, max: 2100 }),
          async (pair, series, evalOffset) => {
            const bundle = makeInMemoryStores();
            const candles = toCandles(pair, series);
            await seedPair(bundle, pair, candles, { withVectors: true });

            const evalDate = dateFromOffset(evalOffset);

            await resolveHistoricalOutcomes({ stores: bundle.stores, evalDate });

            // Inspect every stored row for this pair across every candle date.
            for (const candle of candles) {
              const rows = await bundle.analogueStore.getOutcomes(
                pair,
                candle.date,
              );
              for (const row of rows) {
                const expected = isMatured(
                  row.decisionDate,
                  row.horizon,
                  evalDate,
                );
                expect(row.matured).toBe(expected);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
