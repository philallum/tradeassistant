// Property 27: Historical outcome resolution is idempotent.
//
// Feature: operational-wiring, Property 27: Running resolveHistoricalOutcomes twice over the same stores yields identical analogue_outcomes state
//
// resolveHistoricalOutcomes drives the EXISTING `resolve(...)`, which upserts
// per-horizon rows keyed on (asset, decision_date, horizon). Running the pass
// twice over the same in-memory stores must therefore leave the
// `analogue_outcomes` state byte-for-byte identical — the second pass overwrites
// each row with an equal value and adds nothing.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pair } from "../../ingestion/types.js";
import { resolveHistoricalOutcomes } from "./outcomeResolution.js";
import {
  ascendingCandleSeries,
  dateFromOffset,
  makeInMemoryStores,
  seedPair,
  snapshotAnalogueOutcomes,
  toCandles,
} from "./testHelpers.js";

// Feature: operational-wiring, Property 27: Running resolveHistoricalOutcomes twice over the same stores yields identical analogue_outcomes state

describe("Property 27: Historical outcome resolution is idempotent", () => {
  it(
    "a second pass over the same stores leaves the analogue_outcomes state unchanged",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<Pair>("EURUSD", "USDJPY", "GBPUSD"),
          ascendingCandleSeries({ minLength: 1, maxLength: 20 }),
          // An evalDate well after the series so some rows mature; the exact
          // value is irrelevant to idempotence (both passes use the same one).
          fc.integer({ min: 0, max: 2100 }),
          async (pair, series, evalOffset) => {
            const bundle = makeInMemoryStores();
            const candles = toCandles(pair, series);
            await seedPair(bundle, pair, candles, { withVectors: true });

            const evalDate = dateFromOffset(evalOffset);

            // First pass.
            await resolveHistoricalOutcomes({ stores: bundle.stores, evalDate });
            const after1 = await snapshotAnalogueOutcomes(
              bundle.analogueStore,
              [pair],
              candles.map((c) => c.date),
            );

            // Second pass over the SAME stores.
            await resolveHistoricalOutcomes({ stores: bundle.stores, evalDate });
            const after2 = await snapshotAnalogueOutcomes(
              bundle.analogueStore,
              [pair],
              candles.map((c) => c.date),
            );

            // The state is identical: same keys, same values, same count.
            expect(after2).toStrictEqual(after1);
            expect(Object.keys(after2).length).toBe(Object.keys(after1).length);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
