import { describe, expect, it } from "vitest";
import { InMemoryYieldStore } from "./types.js";
import { YieldIngestion } from "./yieldIngestion.js";
import type { RawYield } from "./types.js";

describe("Yield Feed Ingestion and Spread Calculation (Requirement 13.8)", () => {
  it("ingests per-country 10Y sovereign bond yields keyed by (country, date)", async () => {
    const store = new InMemoryYieldStore();
    const service = new YieldIngestion(store);

    const rawYields: RawYield[] = [
      { country: "US", date: "2026-01-05", yield10y: 4.25, source: "treasury" },
      { country: "US", date: "2026-01-06", yield10y: 4.28, source: "treasury" },
      { country: "DE", date: "2026-01-05", yield10y: 2.35, source: "bund" },
      { country: "DE", date: "2026-01-06", yield10y: 2.38, source: "bund" },
    ];

    const report = await service.ingestYields(rawYields);
    expect(report.totalReceived).toBe(4);
    expect(report.accepted).toBe(4);
    expect(report.rejected).toBe(0);

    const usYields = await service.getYields("US");
    expect(usYields).toHaveLength(2);
    expect(usYields.map((y) => y.date)).toEqual(["2026-01-05", "2026-01-06"]);
  });

  it("performs idempotent upsert without duplicates when re-ingesting", async () => {
    const store = new InMemoryYieldStore();
    const service = new YieldIngestion(store);

    const rawYields: RawYield[] = [
      { country: "JP", date: "2026-01-05", yield10y: 0.85 },
      { country: "JP", date: "2026-01-06", yield10y: 0.88 },
    ];

    await service.ingestYields(rawYields);
    await service.ingestYields(rawYields);
    await service.ingestYields(rawYields);

    const jpYields = await service.getYields("JP");
    expect(jpYields).toHaveLength(2);
  });

  it("computes yield spread under strict look-ahead guard (date < decisionDate)", async () => {
    const store = new InMemoryYieldStore();
    const service = new YieldIngestion(store);

    // Yields on Jan 05, Jan 06, and Jan 07 (future)
    await service.ingestYields([
      { country: "DE", date: "2026-01-05", yield10y: 2.30 },
      { country: "DE", date: "2026-01-06", yield10y: 2.35 },
      { country: "DE", date: "2026-01-07", yield10y: 2.50 }, // Future relative to decisionDate Jan 07
      { country: "US", date: "2026-01-05", yield10y: 4.20 },
      { country: "US", date: "2026-01-06", yield10y: 4.25 },
      { country: "US", date: "2026-01-07", yield10y: 4.40 }, // Future relative to decisionDate Jan 07
    ]);

    // Decision date: 2026-01-07
    // Guard MUST pick Jan 06 yield (latest strictly before Jan 07)
    // EURUSD: base DE (2.35) minus quote US (4.25) = -1.90
    const spread = await service.yieldSpread10y("2026-01-07", "EURUSD");
    expect(spread).toBeCloseTo(2.35 - 4.25, 6);
  });

  it("fail-safe: returns null (unavailable) when either country yield is missing", async () => {
    const store = new InMemoryYieldStore();
    const service = new YieldIngestion(store);

    // Only US yields present, DE yields absent
    await service.ingestYields([
      { country: "US", date: "2026-01-05", yield10y: 4.25 },
    ]);

    const spread = await service.yieldSpread10y("2026-01-06", "EURUSD");
    expect(spread).toBeNull();
  });

  it("fail-safe: returns null when yields exist only on or after decisionDate", async () => {
    const store = new InMemoryYieldStore();
    const service = new YieldIngestion(store);

    // Yields only on Jan 07 (no history before Jan 07)
    await service.ingestYields([
      { country: "DE", date: "2026-01-07", yield10y: 2.35 },
      { country: "US", date: "2026-01-07", yield10y: 4.25 },
    ]);

    // At decisionDate Jan 07, observations on Jan 07 cannot be used
    const spread = await service.yieldSpread10y("2026-01-07", "EURUSD");
    expect(spread).toBeNull();
  });
});
