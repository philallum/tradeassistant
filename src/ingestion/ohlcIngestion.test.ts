import { describe, expect, it } from "vitest";
import { OhlcIngestion } from "./ohlcIngestion.js";
import { InMemoryCandleStore, PAIRS } from "./types.js";
import type { RawCandle } from "./types.js";

describe("OHLC Ingestion & Coverage Summary (Requirements 7.1, 7.6)", () => {
  it("ingests daily candles for all 5 major pairs and produces coverage summary", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);

    // Initial coverage should show zero counts for all pairs
    const initialCoverage = await ingestion.coverageSummary();
    expect(initialCoverage).toHaveLength(5);
    for (const cov of initialCoverage) {
      expect(cov.count).toBe(0);
      expect(cov.earliestDate).toBeNull();
      expect(cov.latestDate).toBeNull();
    }

    // Ingest data for each pair
    const testDates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];

    for (const pair of PAIRS) {
      const rawCandles: RawCandle[] = testDates.map((date, idx) => ({
        asset: pair,
        date,
        open: 1.0 + idx * 0.01,
        high: 1.05 + idx * 0.01,
        low: 0.95 + idx * 0.01,
        close: 1.02 + idx * 0.01,
        source: "test-feed",
      }));

      const report = await ingestion.ingest(pair, rawCandles);
      expect(report.pair).toBe(pair);
      expect(report.totalReceived).toBe(5);
      expect(report.accepted).toBe(5);
      expect(report.rejected).toBe(0);
    }

    // Coverage summary should report exactly 5 candles with min/max date per pair
    const summary = await ingestion.coverageSummary();
    expect(summary).toHaveLength(5);

    for (const cov of summary) {
      expect(cov.count).toBe(5);
      expect(cov.earliestDate).toBe("2026-01-05");
      expect(cov.latestDate).toBe("2026-01-09");
    }

    // Querying candles for a specific range works
    const eurusdCandles = await ingestion.getCandles(
      "EURUSD",
      "2026-01-06",
      "2026-01-08",
    );
    expect(eurusdCandles).toHaveLength(3);
    expect(eurusdCandles.map((c) => c.date)).toEqual([
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ]);
  });

  it("handles mixed batches with invalid candles and reports errors", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);

    const rawCandles: RawCandle[] = [
      { date: "2026-01-05", open: 1.1, high: 1.2, low: 1.0, close: 1.15 }, // valid
      { date: "2026-01-06", open: 1.1, high: 1.0, low: 1.2, close: 1.15 }, // invalid: high < low
      { date: "2026-01-07", open: 1.5, high: 1.2, low: 1.0, close: 1.15 }, // invalid: open > high
    ];

    const report = await ingestion.ingest("EURUSD", rawCandles);
    expect(report.totalReceived).toBe(3);
    expect(report.accepted).toBe(1);
    expect(report.rejected).toBe(2);
    expect(report.errors).toHaveLength(2);

    const stored = await ingestion.getCandles("EURUSD");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.date).toBe("2026-01-05");
  });
});
