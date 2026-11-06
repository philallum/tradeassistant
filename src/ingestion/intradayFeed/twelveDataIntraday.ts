// Twelve Data intraday 4H client — Task 1 (intraday-validation feature).
//
// A SMALL, ISOLATED client that fetches the currently-forming 4H candle(s) from
// Twelve Data's `time_series` endpoint with `interval=4h`. It is deliberately
// SEPARATE from the daily OHLC provider layer (`src/ingestion/ohlcFeed/`): it
// does NOT implement `OhlcFeedProvider`, is not part of the provider chain, and
// never touches the daily ingestion path. The daily system is untouched.
//
//   GET /time_series?symbol=EUR/USD&interval=4h&apikey=<key>&format=JSON
//       &outputsize=<n>&timezone=UTC
//
// CRITICAL DIFFERENCE FROM THE DAILY ADAPTER: the daily adapter slices
// `datetime` to its first 10 chars (`YYYY-MM-DD`), which would COLLAPSE the six
// 4H bars of a day onto one date. This client keeps the FULL timestamp and
// normalizes it to a UTC ISO instant (`openTimeUtc`) so the forming-bar selector
// can screen it against the fixed UTC 4H boundaries. `timezone=UTC` is requested
// explicitly so the provider's `datetime` is unambiguous.
//
// FAIL-SAFE: it NEVER throws. Network error / non-200 → `unavailable`, non-JSON
// → `invalid`, `{ status: "error" }` / missing / empty `values` → `invalid` /
// `empty`, a row with non-finite OHLC is dropped; an all-dropped response →
// `empty`. The API key is a SECRET, read by name only and never placed in a log
// line or an error message.

import { err, ok, type Result } from "../../guard/types.js";
import type { Pair } from "../../ingestion/types.js";
import { TWELVE_DATA_DEFAULT_BASE_URL } from "../../ingestion/ohlcFeed/types.js";
import { toTwelveDataSymbol } from "../../ingestion/ohlcFeed/twelveDataOhlcProvider.js";
import type { Intraday4hBar } from "../../intraday-validation/types.js";

/** Provider provenance tag (never a secret). */
export const INTRADAY_PROVIDER_NAME = "TwelveData" as const;

/** The Twelve Data interval literal for a 4-hour bar. */
const INTERVAL_4H = "4h" as const;

/** How many of the most recent 4H bars to request (enough to find the forming one). */
const DEFAULT_OUTPUTSIZE = 3 as const;

/** The modelled failure modes for an intraday fetch (secret-free). */
export type IntradayFeedFailureMode = "unconfigured" | "unavailable" | "invalid" | "empty";

/** A typed, SECRET-FREE intraday-feed failure for a Pair. */
export interface IntradayFeedError {
  readonly reason: "intraday_feed_error";
  readonly mode: IntradayFeedFailureMode;
  /** Provider provenance tag — never a secret. */
  readonly provider: string;
  readonly pair: Pair;
  /** Human-readable, secret-free explanation. */
  readonly message: string;
}

/** Config for the client: the API key (by value, construct-only) + base URL. */
export interface IntradayClientConfig {
  /** The Twelve Data API key value (secret — construct-only, never logged). */
  readonly apiKey: string;
  /** The resolved base URL (defaults to the shared Twelve Data default). */
  readonly baseUrl?: string;
}

/** One row of a `time_series` response (numeric fields may be strings). */
interface TwelveDataValue {
  readonly datetime?: string;
  readonly open?: number | string;
  readonly high?: number | string;
  readonly low?: number | string;
  readonly close?: number | string;
}

/** The `time_series` response envelope. */
interface TwelveDataResponse {
  readonly status?: string;
  readonly code?: number;
  readonly message?: string;
  readonly values?: ReadonlyArray<TwelveDataValue>;
}

/** Coerce a numeric field (number or numeric string) to a finite number, or null. */
function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a Twelve Data `datetime` (requested as UTC) to a canonical UTC ISO
 * instant. Twelve Data returns intraday datetimes as `"YYYY-MM-DD HH:mm:ss"`
 * (no zone) when `timezone=UTC`; treat that as UTC by inserting the `T`/`Z`.
 * Returns null when unparseable.
 */
export function parseUtcDatetime(datetime: string | undefined): string | null {
  if (typeof datetime !== "string" || datetime.trim() === "") return null;
  const trimmed = datetime.trim();
  // If it already carries a zone / `T`, let Date.parse handle it; else assume UTC.
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const hasT = trimmed.includes("T");
  const candidate = hasZone
    ? trimmed
    : hasT
      ? `${trimmed}Z`
      : `${trimmed.replace(" ", "T")}Z`;
  const t = Date.parse(candidate);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Map one `time_series` value to an {@link Intraday4hBar}, or null if uncoercible. */
function toBar(value: TwelveDataValue): Intraday4hBar | null {
  const openTimeUtc = parseUtcDatetime(value.datetime);
  const open = toNumber(value.open);
  const high = toNumber(value.high);
  const low = toNumber(value.low);
  const close = toNumber(value.close);
  if (openTimeUtc === null || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { openTimeUtc, open, high, low, currentPrice: close };
}

/**
 * The isolated Twelve Data 4H client. Fetches the most recent 4H bars for one
 * pair; the caller selects the forming bar. Never throws — every failure path is
 * a typed, secret-free {@link IntradayFeedError}.
 */
export class TwelveDataIntradayClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: IntradayClientConfig, fetchImpl: typeof fetch = fetch) {
    if (config.apiKey === "") {
      throw new Error("TwelveDataIntradayClient requires a non-empty API key");
    }
    this.#apiKey = config.apiKey;
    const base = config.baseUrl?.trim();
    this.#baseUrl = base === undefined || base === "" ? TWELVE_DATA_DEFAULT_BASE_URL : base;
    this.#fetch = fetchImpl;
  }

  /** Provider provenance tag (never a secret). */
  get name(): string {
    return INTRADAY_PROVIDER_NAME;
  }

  /**
   * Fetch the most recent 4H bars for `pair` (newest-first, as Twelve Data
   * returns them). Returns a typed, secret-free error on any failure.
   */
  async fetch4h(
    pair: Pair,
    outputsize: number = DEFAULT_OUTPUTSIZE,
  ): Promise<Result<readonly Intraday4hBar[], IntradayFeedError>> {
    const params = new URLSearchParams({
      symbol: toTwelveDataSymbol(pair),
      interval: INTERVAL_4H,
      apikey: this.#apiKey,
      format: "JSON",
      outputsize: String(outputsize),
      timezone: "UTC",
    });
    const url = `${this.#baseUrl.replace(/\/+$/, "")}/time_series?${params.toString()}`;

    let response: Response;
    try {
      response = await this.#fetch(url, { method: "GET" });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(this.#fail(pair, "unavailable", `TwelveData 4h request failed: ${detail}`));
    }

    if (!response.ok) {
      return err(this.#fail(pair, "unavailable", `TwelveData 4h returned HTTP ${response.status}`));
    }

    let body: TwelveDataResponse;
    try {
      body = (await response.json()) as TwelveDataResponse;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(this.#fail(pair, "invalid", `TwelveData 4h returned non-JSON body: ${detail}`));
    }

    if (body.status === "error") {
      return err(this.#fail(pair, "invalid", `TwelveData 4h error ${body.code ?? "?"}`));
    }
    const values = body.values;
    if (values === undefined || values.length === 0) {
      return err(this.#fail(pair, "empty", `TwelveData 4h returned no values for ${pair}`));
    }

    const bars: Intraday4hBar[] = [];
    for (const value of values) {
      const bar = toBar(value);
      if (bar !== null) bars.push(bar);
    }
    if (bars.length === 0) {
      return err(this.#fail(pair, "empty", `TwelveData 4h returned no usable bar for ${pair}`));
    }
    return ok(bars);
  }

  #fail(pair: Pair, mode: IntradayFeedFailureMode, message: string): IntradayFeedError {
    return { reason: "intraday_feed_error", mode, provider: INTRADAY_PROVIDER_NAME, pair, message };
  }
}
