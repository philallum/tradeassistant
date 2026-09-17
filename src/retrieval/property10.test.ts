import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { retrieve } from "./retrieve.js";
import { InMemoryAnalogueStore } from "./types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import type { AnalogueRecord } from "./types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 10: Neighborhood weekly-trend regime match
//
// For all queries and backing data, every analogue in the returned neighborhood
// has the same Weekly_Trend_Sign as the query.
//
// Validates: Requirement 9.2.

/**
 * Build N weekday candles starting at startDateStr, with a consistent trend direction.
 * Returns { candles, decisionDate } where decisionDate is the next weekday after the last candle.
 */
function buildWindow(
  startDateStr: string,
  count: number,
  pair: Pair,
  trendUp: boolean,
): { candles: Candle[]; decisionDate: string } {
  const start = new Date(startDateStr + "T00:00:00Z");
  const candles: Candle[] = [];
  let price = 1.1;
  let dayOffset = 0;

  while (candles.length < count) {
    const dt = new Date(start.getTime() + dayOffset * 86_400_000);
    if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 5) {
      const date = dt.toISOString().slice(0, 10);
      price = Math.max(0.5, price + (trendUp ? 0.001 : -0.001));
      candles.push({
        asset: pair,
        date,
        open: price,
        high: price + 0.003,
        low: price - 0.003,
        close: price,
        source: "test",
      });
    }
    dayOffset++;
  }

  const lastCandle = candles[candles.length - 1]!;
  let decisionDt = new Date(lastCandle.date + "T00:00:00Z");
  decisionDt = new Date(decisionDt.getTime() + 86_400_000);
  while (decisionDt.getUTCDay() === 0 || decisionDt.getUTCDay() === 6) {
    decisionDt = new Date(decisionDt.getTime() + 86_400_000);
  }
  return { candles, decisionDate: decisionDt.toISOString().slice(0, 10) };
}

function addDays(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

describe("Property 10: Neighborhood weekly-trend regime match", () => {
  it(
    "every analogue in the neighborhood has the same Weekly_Trend_Sign as the query",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(), // query trend direction: true=UP, false=DOWN
          fc.integer({ min: 2, max: 6 }),
          fc.integer({ min: 1, max: 3 }),
          async (queryTrendUp, sameTrendCount, oppTrendCount) => {
            const pair: Pair = "GBPUSD";
            const vectorStore = new InMemoryPatternVectorStore();
            const analogueStore = new InMemoryAnalogueStore();

            // Build query vector
            const { candles: queryCandles, decisionDate: queryDate } =
              buildWindow("2025-05-01", 10, pair, queryTrendUp);
            const queryVec = encodePatternVector(queryCandles, queryDate);
            await vectorStore.upsertVector(pair, queryDate, queryVec);
            const evalDate = addDays(queryDate, 60);

            // Seed same-trend analogues — start well before query
            for (let i = 0; i < sameTrendCount; i++) {
              const startDate = addDays("2024-01-01", i * 15);
              const { candles, decisionDate } = buildWindow(startDate, 10, pair, queryTrendUp);
              if (decisionDate >= queryDate) continue;
              const vec = encodePatternVector(candles, decisionDate);
              await vectorStore.upsertVector(pair, decisionDate, vec);
              await analogueStore.upsertOutcome({
                asset: pair,
                decisionDate,
                horizon: 1,
                direction: "UP",
                mfePips: 10,
                maePips: 5,
                atr14: 0.008,
                matured: true,
              } as AnalogueRecord);
            }

            // Seed opposite-trend analogues — should be filtered by weeklyTrendSign pre-filter
            for (let i = 0; i < oppTrendCount; i++) {
              const startDate = addDays("2023-01-01", i * 15);
              const { candles, decisionDate } = buildWindow(startDate, 10, pair, !queryTrendUp);
              if (decisionDate >= queryDate) continue;
              const vec = encodePatternVector(candles, decisionDate);
              await vectorStore.upsertVector(pair, decisionDate, vec);
              await analogueStore.upsertOutcome({
                asset: pair,
                decisionDate,
                horizon: 1,
                direction: "DOWN",
                mfePips: 5,
                maePips: 10,
                atr14: 0.008,
                matured: true,
              } as AnalogueRecord);
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

            const expectedTrend = queryVec.weeklyTrendSign;

            for (const analogue of results) {
              const stored = await vectorStore.getVector(pair, analogue.decisionDate);
              expect(stored).not.toBeNull();
              // Property 10: same weeklyTrendSign as query (Req 9.2)
              expect(stored!.weeklyTrendSign).toBe(expectedTrend);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
