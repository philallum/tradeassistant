// Twelve Data OHLC_Feed_Provider adapter (latest + range) — Design Component 1
// (Requirements 1.2, 1.3, 1.6).
//
// Calls Twelve Data's daily `time_series` endpoint over the built-in `fetch`
// (no SDK). It supports BOTH the Daily_Top_Up (`outputsize=1`) and the
// Gap_Backfill (`start_date` / `end_date` range), so it is the first provider in
// the chain able to close a multi-day gap (FCS cannot).
//
//   GET /time_series?symbol=EUR/USD&interval=1day
//       &start_date=<from>&end_date=<to>&apikey=<key>&format=JSON&outputsize=5000
//
// Symbol mapping: the internal `EURUSD` form becomes Twelve Data's `EUR/USD`
// (slash inserted after the first three characters). The response is
// `{ status: "ok", values: [{ datetime: "YYYY-MM-DD", open, high, low, close }] }`
// with numeric fields as strings; this adapter coerces them to numbers and maps
// each row to the internal `RawCandle` shape, stamping `source`.
//
// Fail-safe: network error → `unavailable`, non-200 → `unavailable`, non-JSON →
// `invalid`, `{ status: "error" }` or missing/empty `values` → `invalid`/`empty`.
// The API key is a secret and never appears in a log line or an error message.

import { err, ok, type Result } from "../../guard/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import {
  TWELVE_DATA_DEFAULT_BASE_URL,
  type OhlcFeedError,
  type OhlcFeedProvider,
  type OhlcProviderConfig,
} from "./types.js";

/** Provider provenance tag stamped onto `RawCandle.source` and errors. */
const PROVIDER_NAME = "TwelveData" as const;

/** One row of a `time_series` response. */
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

/** Map the internal `EURUSD` form to Twelve Data's `EUR/USD` symbol. */
export function toTwelveDataSymbol(pair: Pair): string {
  return `${pair.slice(0, 3)}/${pair.slice(3)}`;
}

/** Map one `time_series` value to a `RawCandle`, or null if uncoercible. */
function toRawCandle(pair: Pair, value: TwelveDataValue): RawCandle | null {
  const date = typeof value.datetime === "string" ? value.datetime.slice(0, 10) : undefined;
  const open = toNumber(value.open);
  const high = toNumber(value.high);
  const low = toNumber(value.low);
  const close = toNumber(value.close);
  if (date === undefined || date === "" || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { asset: pair, pair, date, open, high, low, close, source: PROVIDER_NAME };
}

/**
 * A real {@link OhlcFeedProvider} backed by Twelve Data over REST. Supports both
 * latest and date-range fetches. It never throws — every failure path is a
 * typed, secret-free {@link OhlcFeedError}.
 */
export class TwelveDataOhlcFeedProvider implements OhlcFeedProvider {
  readonly name = PROVIDER_NAME;
  readonly supportsLatest = true;
  readonly supportsRange = true;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: OhlcProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (config.apiKey === "") {
      throw new Error("TwelveDataOhlcFeedProvider requires a non-empty API key");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl =
      config.baseUrl.trim() === "" ? TWELVE_DATA_DEFAULT_BASE_URL : config.baseUrl.trim();
    this.#fetch = fetchImpl;
  }

  async fetchLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
  ): Promise<ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>> {
    // The newest daily candle is requested with `outputsize=1`; `asOf` is not
    // part of a latest request (Twelve Data returns the most recent itself).
    void asOf;
    const out = new Map<Pair, Result<readonly RawCandle[], OhlcFeedError>>();
    // Per-pair loop (Twelve Data's time_series symbol param is single-symbol on
    // the common plans); each pair is independently fail-safe.
    await Promise.all(
      pairs.map(async (pair) => {
        out.set(pair, await this.#fetchSeries(pair, { outputsize: 1 }));
      }),
    );
    return out;
  }

  fetchRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    return this.#fetchSeries(pair, { startDate: fromDate, endDate: toDate, outputsize: 5000 });
  }

  async #fetchSeries(
    pair: Pair,
    opts: { startDate?: TradingDate; endDate?: TradingDate; outputsize: number },
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    const params = new URLSearchParams({
      symbol: toTwelveDataSymbol(pair),
      interval: "1day",
      apikey: this.#apiKey,
      format: "JSON",
      outputsize: String(opts.outputsize),
    });
    if (opts.startDate !== undefined) params.set("start_date", opts.startDate);
    if (opts.endDate !== undefined) params.set("end_date", opts.endDate);
    const url = `${this.#baseUrl.replace(/\/+$/, "")}/time_series?${params.toString()}`;

    let response: Response;
    try {
      response = await this.#fetch(url, { method: "GET" });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(this.#fail(pair, "unavailable", `TwelveData request failed: ${detail}`));
    }

    if (!response.ok) {
      return err(this.#fail(pair, "unavailable", `TwelveData returned HTTP ${response.status}`));
    }

    let body: TwelveDataResponse;
    try {
      body = (await response.json()) as TwelveDataResponse;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(this.#fail(pair, "invalid", `TwelveData returned non-JSON body: ${detail}`));
    }

    if (body.status === "error") {
      return err(this.#fail(pair, "invalid", `TwelveData error ${body.code ?? "?"}`));
    }
    const values = body.values;
    if (values === undefined || values.length === 0) {
      return err(this.#fail(pair, "empty", `TwelveData returned no values for ${pair}`));
    }

    const candles: RawCandle[] = [];
    for (const value of values) {
      const candle = toRawCandle(pair, value);
      if (candle !== null) candles.push(candle);
    }
    if (candles.length === 0) {
      return err(this.#fail(pair, "empty", `TwelveData returned no usable candle for ${pair}`));
    }
    return ok(candles);
  }

  #fail(pair: Pair, mode: OhlcFeedError["mode"], message: string): OhlcFeedError {
    return { reason: "ohlc_feed_error", mode, provider: PROVIDER_NAME, pair, message };
  }
}
