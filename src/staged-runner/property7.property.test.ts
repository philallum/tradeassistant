// Property 7: Stored pattern vectors correspond to stored candles after backfill.
//
// Feature: operational-wiring, Property 7: Stored pattern vectors correspond to stored candles after backfill
// Validates: Requirements 2.2

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import { EMBEDDING_DIM } from "../encoder/patternEncoder.js";
import { backfill } from "./stagedRunner.js";
import { buildCsvContent, makeTestDeps } from "./testHelpers.js";

// Feature: operational-wiring, Property 7: Stored pattern vectors correspond to stored candles after backfill

describe("Property 7: Stored pattern vectors correspond to stored candles after backfill", () => {
  it(
    "the set of stored vector dates corresponds exactly to the set of stored candle dates for every pair",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Give each pair in a chosen subset its own distinct set of dates so
          // the correspondence is checked across multiple pairs at once and so
          // the test cannot be satisfied by a single shared date set.
          fc.uniqueArray(fc.constantFrom<Pair>(...PAIRS), {
            minLength: 1,
            maxLength: PAIRS.length,
          }),
          fc.array(
            fc.array(
              fc.integer({ min: 0, max: 3000 }).map((d) => {
                const dt = new Date(Date.UTC(2015, 0, 5) + d * 86_400_000);
                return dt.toISOString().slice(0, 10);
              }),
              { minLength: 2, maxLength: 25 },
            ),
            { minLength: 1, maxLength: PAIRS.length },
          ),
          async (chosenPairs, dateSets) => {
            // Build per-pair CSV contents using de-duplicated, sorted dates.
            // NOTE: we track which pairs were FED data, not the exact dates —
            // the ingestion module normalizes to the Session_Close boundary and
            // may shift or reject rows (e.g. weekends), which is its job, not
            // Property 7's. Property 7 is about correspondence between whatever
            // candles end up stored and the vectors stored for them.
            const csvContents: Partial<Record<Pair, string>> = {};
            const fedPairs = new Set<Pair>();

            chosenPairs.forEach((pair, idx) => {
              const rawDates = dateSets[idx % dateSets.length]!;
              const dates = [...new Set(rawDates)].sort();
              if (dates.length < 1) return;
              csvContents[pair] = buildCsvContent(dates);
              fedPairs.add(pair);
            });

            // Nothing to assert if no pair ended up with data.
            if (fedPairs.size === 0) return;

            const deps = makeTestDeps(csvContents);

            // Feature: operational-wiring, Property 7: Stored pattern vectors correspond to stored candles after backfill
            const result = await backfill(deps, "backfill");
            expect(result.ok).toBe(true);

            for (const pair of PAIRS) {
              const candles = await deps.ingestion.getCandles(pair);
              const vectors = await deps.vectorStore.getVectorsByAsset(pair);

              const candleDates = new Set(candles.map((c) => c.date));
              const vectorDates = new Set(vectors.map((v) => v.decisionDate));

              // (1) Correspondence: stored vectors exist for exactly the stored
              // candle dates — no missing vector, no fabricated vector date.
              // The backfill window for each date is the trailing candles
              // STRICTLY BEFORE that date, so the look-ahead guard never fires
              // and every stored candle yields exactly one stored vector.
              expect(vectorDates.size).toBe(candleDates.size);
              expect(vectorDates.size).toBe(vectors.length); // no duplicate dates
              for (const d of candleDates) {
                expect(vectorDates.has(d)).toBe(true);
              }
              for (const d of vectorDates) {
                expect(candleDates.has(d)).toBe(true);
              }

              // (2) Each stored vector is a genuine encoded vector keyed to a
              // real candle date — retrievable by (pair, date) with a
              // well-formed fixed-dimension embedding, not a placeholder.
              for (const date of candleDates) {
                const stored = await deps.vectorStore.getVector(pair, date);
                expect(stored).not.toBeNull();
                expect(stored!.decisionDate).toBe(date);
                expect(stored!.embedding.length).toBe(EMBEDDING_DIM);
              }

              // (3) Pairs that were fed no data have neither candles nor
              // vectors — backfill never fabricates vectors for empty pairs.
              if (!fedPairs.has(pair)) {
                expect(candleDates.size).toBe(0);
                expect(vectorDates.size).toBe(0);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
