import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { retrieve } from "./retrieve.js";
import { InMemoryAnalogueStore } from "./types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import type { AnalogueRecord } from "./types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 3: Retrieval self-exclusion, pre-date, matured-only
//
// For all queries and backing data, every analogue in the returned
// Analogue_Neighborhood is dated strictly before the query Decision_Date,
// is a Matured_Outcome, and is not the query pattern itself.
//
// Validates: Requirements 9.3, 9.4, 9.5.

/**
 * Build a window of N weekday candles starting at startDateStr,
 * returning { candles, decisionDate } where decisionDate is the calendar day
 * after the last candle (always a weekday or the next weekday).
 */
function buildWindow(
  startDateStr: string,
  count: number,
  pair: Pair,
  basePrice = 1.1,
): { candles: Candle[]; decisionDate: string } {
  const start = new Date(startDateStr + "T00:00:00Z");
  const candles: Candle[] = [];
  let price = basePrice;
  let dayOffset = 0;

  while (candles.length < count) {
    const dt = new Date(start.getTime() + dayOffset * 86_400_000);
    if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 5) {
      const date = dt.toISOString().slice(0, 10);
      price = Math.max(0.5, price + 0.001);
      candles.push({
        asset: pair,
        date,
        open: price,
        high: price + 0.005,
        low: price - 0.005,
        close: price,
        source: "test",
      });
    }
    dayOffset++;
  }

  // Decision date = next calendar day after the last candle (skip weekends)
  const lastCandle = candles[candles.length - 1]!;
  let decisionDt = new Date(lastCandle.date + "T00:00:00Z");
  decisionDt = new Date(decisionDt.getTime() + 86_400_000);
  while (decisionDt.getUTCDay() === 0 || decisionDt.getUTCDay() === 6) {
    decisionDt = new Date(decisionDt.getTime() + 86_400_000);
  }
  const decisionDate = decisionDt.toISOString().slice(0, 10);

  return { candles, decisionDate };
}

/** Advance a date string by N calendar days. */
function addDays(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

describe("Property 3: Retrieval self-exclusion, pre-date, matured-only", () => {
  it(
    "all returned analogues are strictly-pre-date, matured, and not the query itself",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 3, max: 10 }),   // number of analogue dates to seed
          fc.integer({ min: 1, max: 3 }),     // horizon (1|2|3) for seeded outcomes
          async (numAnalogues, horizonRaw) => {
            const horizon = horizonRaw as 1 | 2 | 3;
            const pair: Pair = "EURUSD";
            const vectorStore = new InMemoryPatternVectorStore();
            const analogueStore = new InMemoryAnalogueStore();

            // The query: start 200 trading days before end of dataset
            const { candles: queryCandles, decisionDate: queryDate } =
              buildWindow("2025-05-01", 10, pair);

            const queryVec = encodePatternVector(queryCandles, queryDate);
            await vectorStore.upsertVector(pair, queryDate, queryVec);

            // evalDate must be far enough ahead for outcomes to be matured
            const evalDate = addDays(queryDate, 60);

            // Seed N analogue dates, all strictly before queryDate
            for (let i = 0; i < numAnalogues; i++) {
              // Each analogue starts 100 + i*5 days before queryDate
              const startDate = addDays("2024-01-01", i * 5);
              const { candles: analogueCandles, decisionDate: analogueDate } =
                buildWindow(startDate, 10, pair);

              if (analogueDate >= queryDate) continue; // safety — skip if too close

              const vec = encodePatternVector(analogueCandles, analogueDate);
              await vectorStore.upsertVector(pair, analogueDate, vec);

              const record: AnalogueRecord = {
                asset: pair,
                decisionDate: analogueDate,
                horizon,
                direction: "UP",
                mfePips: 15,
                maePips: 5,
                atr14: 0.008,
                matured: true,
              };
              await analogueStore.upsertOutcome(record);
            }

            // Also seed an un-matured outcome at a date before query — must be excluded
            const unmaturedStart = addDays("2024-08-01", 0);
            const { candles: unmaturedCandles, decisionDate: unmaturedDate } =
              buildWindow(unmaturedStart, 10, pair);
            if (unmaturedDate < queryDate) {
              const vec = encodePatternVector(unmaturedCandles, unmaturedDate);
              await vectorStore.upsertVector(pair, unmaturedDate, vec);
              await analogueStore.upsertOutcome({
                asset: pair,
                decisionDate: unmaturedDate,
                horizon,
                direction: "DOWN",
                mfePips: 5,
                maePips: 10,
                atr14: 0.008,
                matured: false,
              });
            }

            const results = await retrieve(
              queryVec,
              pair,
              queryDate,
              evalDate,
              vectorStore,
              analogueStore,
              { k: 50, epsilon: 2.0 },
            );

            for (const analogue of results) {
              // Property 3a: strictly-pre-date (Req 9.3)
              expect(analogue.decisionDate < queryDate).toBe(true);
              // Property 3b: matured (Req 9.5)
              expect(analogue.matured).toBe(true);
              // Property 3c: not the query itself (Req 9.4)
              expect(analogue.decisionDate).not.toBe(queryDate);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
