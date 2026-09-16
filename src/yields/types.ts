// Yield Feed Ingestion Types (Requirements 13.8, 17.1).

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

/** Sovereign country codes for 10-year government bond yields. */
export const COUNTRIES = ["US", "DE", "JP", "CH", "CA", "GB"] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export function isCountryCode(value: string): value is CountryCode {
  return COUNTRIES.includes(value as CountryCode);
}

/** Mapping of 5 major FX pairs to their base and quote sovereign yield countries. */
export const PAIR_YIELD_COUNTRIES: Record<
  Pair,
  { readonly baseCountry: CountryCode; readonly quoteCountry: CountryCode }
> = {
  EURUSD: { baseCountry: "DE", quoteCountry: "US" },
  GBPUSD: { baseCountry: "GB", quoteCountry: "US" },
  USDJPY: { baseCountry: "US", quoteCountry: "JP" },
  USDCHF: { baseCountry: "US", quoteCountry: "CH" },
  USDCAD: { baseCountry: "US", quoteCountry: "CA" },
};

/** Raw yield record from an external feed. */
export interface RawYield {
  readonly country: string;
  readonly date: string;
  readonly yield10y: number;
  readonly source?: string;
}

/** Stored yield record corresponding to the `yields` table. */
export interface YieldRecord {
  readonly country: CountryCode;
  readonly date: TradingDate;
  readonly yield10y: number;
  readonly source: string;
  readonly ingestedAt?: string;
}

/** Result of a yield ingestion run. */
export interface YieldIngestReport {
  readonly totalReceived: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly errors: readonly string[];
}

/**
 * Storage PORT for yields table (Requirement 17.1).
 */
export interface YieldStore {
  /** Idempotent upsert keyed by (country, date). (Requirement 13.8) */
  upsertYields(yields: readonly YieldRecord[]): Promise<void>;

  /** Query latest yield strictly before decisionDate. (Look-ahead safe) */
  getLatestYieldBefore(
    country: CountryCode,
    decisionDate: TradingDate,
  ): Promise<YieldRecord | null>;

  /** Query all stored yields for a country. */
  getYields(country: CountryCode): Promise<readonly YieldRecord[]>;
}

/**
 * In-memory reference implementation of YieldStore.
 */
export class InMemoryYieldStore implements YieldStore {
  // Key format: `${country}:${date}`
  private readonly store = new Map<string, YieldRecord>();

  upsertYields(yields: readonly YieldRecord[]): Promise<void> {
    for (const y of yields) {
      const key = `${y.country}:${y.date}`;
      this.store.set(key, y);
    }
    return Promise.resolve();
  }

  getLatestYieldBefore(
    country: CountryCode,
    decisionDate: TradingDate,
  ): Promise<YieldRecord | null> {
    const candidates: YieldRecord[] = [];
    for (const record of this.store.values()) {
      if (record.country === country && record.date < decisionDate) {
        candidates.push(record);
      }
    }
    if (candidates.length === 0) {
      return Promise.resolve(null);
    }
    candidates.sort((a, b) => b.date.localeCompare(a.date)); // descending
    return Promise.resolve(candidates[0] ?? null);
  }

  getYields(country: CountryCode): Promise<readonly YieldRecord[]> {
    const records: YieldRecord[] = [];
    for (const record of this.store.values()) {
      if (record.country === country) {
        records.push(record);
      }
    }
    return Promise.resolve(records.sort((a, b) => a.date.localeCompare(b.date)));
  }

  clear(): void {
    this.store.clear();
  }
}
