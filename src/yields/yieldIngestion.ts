// Yield Feed Ingestion and Look-Ahead Safe Spread Calculation (Requirement 13.8).
//
// Keyed by (country, date); idempotent upsert; fail-safe unavailable path.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  InMemoryYieldStore,
  PAIR_YIELD_COUNTRIES,
  isCountryCode,
} from "./types.js";
import type {
  CountryCode,
  RawYield,
  YieldIngestReport,
  YieldRecord,
  YieldStore,
} from "./types.js";

/**
 * Service for 10-year sovereign government bond yield ingestion and spread calculation.
 */
export class YieldIngestion {
  private readonly store: YieldStore;

  constructor(store: YieldStore = new InMemoryYieldStore()) {
    this.store = store;
  }

  /**
   * Ingest raw yields idempotently into storage keyed by (country, date).
   * Requirement 13.8.
   */
  async ingestYields(
    rawYields: readonly RawYield[],
  ): Promise<YieldIngestReport> {
    const validRecords: YieldRecord[] = [];
    const errors: string[] = [];

    for (const raw of rawYields) {
      if (!isCountryCode(raw.country)) {
        errors.push(
          `Invalid sovereign country code: "${raw.country}". Expected one of: US, DE, JP, CH, CA, GB`,
        );
        continue;
      }

      if (
        typeof raw.yield10y !== "number" ||
        Number.isNaN(raw.yield10y) ||
        !Number.isFinite(raw.yield10y)
      ) {
        errors.push(
          `Invalid yield10y value for ${raw.country} on ${raw.date}: must be a finite number`,
        );
        continue;
      }

      const dateStr = raw.date.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        errors.push(
          `Invalid date format for ${raw.country}: "${raw.date}". Expected YYYY-MM-DD`,
        );
        continue;
      }

      validRecords.push({
        country: raw.country,
        date: dateStr,
        yield10y: raw.yield10y,
        source: raw.source ?? "yield-feed",
      });
    }

    // Idempotent upsert into storage
    await this.store.upsertYields(validRecords);

    return {
      totalReceived: rawYields.length,
      accepted: validRecords.length,
      rejected: errors.length,
      errors,
    };
  }

  /**
   * Compute the 10-year yield spread (base-country 10Y minus quote-country 10Y)
   * for a currency pair on a Decision_Date (Requirement 13.8).
   *
   * Look-ahead safety: uses only yield records dated strictly before decisionDate.
   * Fail-safe: returns null (unavailable) if either yield is missing/unavailable.
   * Never fabricates, interpolates, or looks into future dates.
   */
  async yieldSpread10y(
    decisionDate: TradingDate,
    pair: Pair,
  ): Promise<number | null> {
    const pairConfig = PAIR_YIELD_COUNTRIES[pair];
    if (!pairConfig) {
      return null;
    }

    const { baseCountry, quoteCountry } = pairConfig;

    // Look-ahead safe queries: only rows dated strictly before decisionDate
    const baseRecord = await this.store.getLatestYieldBefore(
      baseCountry,
      decisionDate,
    );
    const quoteRecord = await this.store.getLatestYieldBefore(
      quoteCountry,
      decisionDate,
    );

    // Fail-safe path: if either yield observation is absent, the feature is UNAVAILABLE
    if (!baseRecord || !quoteRecord) {
      return null;
    }

    // Compute differential: base sovereign yield minus quote sovereign yield
    return baseRecord.yield10y - quoteRecord.yield10y;
  }

  /** Query all stored yields for a country. */
  async getYields(country: CountryCode): Promise<readonly YieldRecord[]> {
    return this.store.getYields(country);
  }
}
