// Massive OHLC_Feed_Provider adapter (latest + range) — Design Component 1
// (Requirements 1.2, 1.3, 1.6).
//
// Calls Massive's aggregates endpoints over the built-in `fetch` (no SDK). It
// supports BOTH the Daily_Top_Up (the "prev" aggregate) and the Gap_Backfill
// (the date-range aggregates), so it is the final fallback able to close a
// multi-day gap.
//
//   Range:  GET /v2/aggs/ticker/C:<PAIR>/range/1/day/<from>/<to>
//               ?adjusted=true&sort=asc&limit=50000&apiKey=<key>
//   Latest: GET /v2/aggs/ticker/C:<PAIR>/prev?adjusted=true&apiKey=<key>
//
// Ticker form: the internal `EURUSD` becomes `C:EURUSD` (the `C:` forex prefix).
// Auth is the `apiKey` query parameter. The response is
// `{ status: "OK", results: [{ o, h, l, c, t }] }` where `t` is epoch
// milliseconds; this adapter derives the `YYYY-MM-DD` date from `t` (UTC) and
// maps each result to the internal `RawCandle` shape, stamping `source`.
//
// Fail-safe: network error → `unavailable`, non-200 → `unavailable`, non-JSON →
// `invalid`, absent/empty `results` → `empty`. The API key is a secret and never
// appears in a log line or an error message.

import { err, ok, type Result } from "../../guard/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import {
  MASSIVE_DEFAULT_BASE_URL,
  type OhlcFeedError,
  type OhlcFeedProvider,
  type OhlcProviderConfig,
} from "./types.js";

/** Provider provenance tag stamped onto `RawCandle.source` and errors. */
const PROVIDER_NAME = "Massive" as const;

/** One aggregate result row. */
interface MassiveResult {
  readonly o?: number | string;
  readonly h?: number | string;
  readonly l?: number | string;
  readonly c?: number | string;
  readonly t?: number | string; // epoch milliseconds
}

/** The aggregates response envelope. */
interface MassiveResponse {
  readonly status?: string;
  readonly error?: string;
  readonly results?: ReadonlyArray<MassiveResult>;
}

/** Coerce a numeric field (number or numeric string) to a finite number, or null. */
function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Map the internal `EURUSD` form to Massive's `C:EURUSD` ticker. */
export function toMassiveTicker(pair: Pair): string {
  return `C:${pair}`;
}

/** Derive a `YYYY-MM-DD` date (UTC) from an epoch-ms timestamp, or null. */
function dateFromMillis(t: number | string | undefined): string | null {
  const ms = toNumber(t);
  if (ms === null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Map one aggregate result to a `RawCandle`, or null if uncoercible. */
function toRawCandle(pair: Pair, result: MassiveResult): RawCandle | null {
  const date = dateFromMillis(result.t);
  const open = toNumber(result.o);
  const high = toNumber(result.h);
  const low = toNumber(result.l);
  const close = toNumber(result.c);
  if (date === null || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { asset: pair, pair, date, open, high, low, close, source: PROVIDER_NAME };
}

/**
 * A real {@link OhlcFeedProvider} backed by Massive over REST. Supports both
 * latest and date-range fetches. It never throws — every failure path is a
 * typed, secret-free {@link OhlcFeedError}.
 */
export class MassiveOhlcFeedProvider implements OhlcFeedProvider {
  readonly name = PROVIDER_NAME;
  readonly supportsLatest = true;
  readonly supportsRange = true;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: OhlcProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (config.apiKey === "") {
      throw new Error("MassiveOhlcFeedProvider requires a non-empty API key");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl =
      config.baseUrl.trim() === "" ? MASSIVE_DEFAULT_BASE_URL : config.baseUrl.trim();
    this.#fetch = fetchImpl;
  }

  async fetchLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
  ): Promise<ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>> {
    // The "prev" aggregate is the most recent completed daily candle; `asOf` is
    // not part of the request.
    void asOf;
    const out = new Map<Pair, Result<readonly RawCandle[], OhlcFeedError>>();
    await Promise.all(
      pairs.map(async (pair) => {
        const base = this.#baseUrl.replace(/\/+$/, "");
        const url =
          `${base}/v2/aggs/ticker/${encodeURIComponent(toMassiveTicker(pair))}/prev` +
          `?adjusted=true&apiKey=${encodeURIComponent(this.#apiKey)}`;
        out.set(pair, await this.#fetchAggs(pair, url));
      }),
    );
    return out;
  }

  fetchRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    const base = this.#baseUrl.replace(/\/+$/, "");
    const url =
      `${base}/v2/aggs/ticker/${encodeURIComponent(toMassiveTicker(pair))}` +
      `/range/1/day/${encodeURIComponent(fromDate)}/${encodeURIComponent(toDate)}` +
      `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(this.#apiKey)}`;
    return this.#fetchAggs(pair, url);
  }

  async #fetchAggs(
    pair: Pair,
    url: string,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    let response: Response;
    try {
      response = await this.#fetch(url, { method: "GET" });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(this.#fail(pair, "unavailable", `Massive request failed: ${detail}`));
    }

    if (!response.ok) {
      return err(this.#fail(pair, "unavailable", `Massive returned HTTP ${response.status}`));
    }

    let body: MassiveResponse;
    try {
      body = (await response.json()) as MassiveResponse;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(this.#fail(pair, "invalid", `Massive returned non-JSON body: ${detail}`));
    }

    const results = body.results;
    if (results === undefined || results.length === 0) {
      return err(this.#fail(pair, "empty", `Massive returned no results for ${pair}`));
    }

    const candles: RawCandle[] = [];
    for (const result of results) {
      const candle = toRawCandle(pair, result);
      if (candle !== null) candles.push(candle);
    }
    if (candles.length === 0) {
      return err(this.#fail(pair, "empty", `Massive returned no usable candle for ${pair}`));
    }
    return ok(candles);
  }

  #fail(pair: Pair, mode: OhlcFeedError["mode"], message: string): OhlcFeedError {
    return { reason: "ohlc_feed_error", mode, provider: PROVIDER_NAME, pair, message };
  }
}
