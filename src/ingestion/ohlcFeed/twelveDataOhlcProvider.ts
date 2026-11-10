// Twelve Data OHLC_Feed_Provider adapter (latest + range) — Design Component 1.
//
// Fetches HOURLY bars (`interval=1h`, `timezone=UTC`) and lets the shared session aggregator build
// the system's own daily candles on the 17:00 America/New_York close (closed + complete sessions
// only). Twelve Data's own `1day` bars are NOT used: they roll at 20:00 UTC, include weekend bars
// and, after the roll, return a brand-new empty bar (docs/state/RISKS.md, DAILY CANDLE DATA INTEGRITY).
//
//   GET /time_series?symbol=EUR/USD&interval=1h&timezone=UTC
//       &start_date=<from> 00:00:00&end_date=<to> 23:59:59&outputsize=5000&apikey=<key>&format=JSON
//
// `datetime` is the bar START ("YYYY-MM-DD HH:mm:ss", UTC). Symbol `EURUSD` becomes `EUR/USD`.
//
// Fail-safe: network error → `unavailable`, non-200 → `unavailable`, non-JSON → `invalid`,
// `{ status: "error" }` → `invalid`, no values / no complete session → `empty`. The API key is a
// secret and never appears in a log line or an error message.

import { err, ok, type Result } from "../../guard/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import {
  TWELVE_DATA_DEFAULT_BASE_URL,
  type OhlcFeedError,
  type OhlcFeedProvider,
  type OhlcProviderConfig,
} from "./types.js";
import { redactSecrets } from "../redactSecrets.js";
import type { HourlyBar } from "../sessionAggregation.js";
import { latestSessionCandle, rangeSessionCandles } from "./hourlySessionFeed.js";

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

/**
 * Optional observer of every successfully fetched hourly batch (for the hourly archive).
 * Failures it throws are swallowed by the provider; it never influences the returned bars.
 */
export type HourlyBarsObserver = (pair: Pair, bars: readonly HourlyBar[]) => Promise<void> | void;

/** Map the internal `EURUSD` form to Twelve Data's `EUR/USD` symbol. */
export function toTwelveDataSymbol(pair: Pair): string {
  return `${pair.slice(0, 3)}/${pair.slice(3)}`;
}

/** Map one hourly `time_series` value to an {@link HourlyBar}, or null if uncoercible. */
function toHourlyBar(value: TwelveDataValue): HourlyBar | null {
  const dt = value.datetime;
  if (typeof dt !== "string") return null;
  // "YYYY-MM-DD HH:mm:ss" (UTC, because the request pins timezone=UTC).
  const openMs = Date.parse(`${dt.trim().replace(" ", "T")}Z`);
  const open = toNumber(value.open);
  const high = toNumber(value.high);
  const low = toNumber(value.low);
  const close = toNumber(value.close);
  if (!Number.isFinite(openMs) || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { openMs, open, high, low, close };
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

  readonly #now: () => Date;
  readonly #onHourlyBars: HourlyBarsObserver | undefined;

  constructor(
    config: OhlcProviderConfig,
    fetchImpl: typeof fetch = fetch,
    now: () => Date = () => new Date(),
    onHourlyBars?: HourlyBarsObserver,
  ) {
    if (config.apiKey === "") {
      throw new Error("TwelveDataOhlcFeedProvider requires a non-empty API key");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl =
      config.baseUrl.trim() === "" ? TWELVE_DATA_DEFAULT_BASE_URL : config.baseUrl.trim();
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#onHourlyBars = onHourlyBars;
  }

  async fetchLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
  ): Promise<ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>> {
    const out = new Map<Pair, Result<readonly RawCandle[], OhlcFeedError>>();
    const nowMs = this.#now().getTime();
    await Promise.all(
      pairs.map(async (pair) => {
        out.set(
          pair,
          await latestSessionCandle(PROVIDER_NAME, pair, asOf, nowMs, (p, f, t) =>
            this.#fetchHourly(p, f, t),
          ),
        );
      }),
    );
    return out;
  }

  fetchRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    return rangeSessionCandles(PROVIDER_NAME, pair, fromDate, toDate, this.#now().getTime(), (p, f, t) =>
      this.#fetchHourly(p, f, t),
    );
  }

  /**
   * The raw hourly bars for the UTC calendar dates `[fromDate, toDate]` (inclusive), exactly as
   * the daily-candle builder sees them. Exposed so an offline tool can archive them; it never
   * throws and applies the same observer as the daily path.
   */
  fetchHourlyBars(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly HourlyBar[], OhlcFeedError>> {
    return this.#fetchHourly(pair, fromDate, toDate);
  }

  async #fetchHourly(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly HourlyBar[], OhlcFeedError>> {
    const params = new URLSearchParams({
      symbol: toTwelveDataSymbol(pair),
      interval: "1h",
      timezone: "UTC",
      apikey: this.#apiKey,
      format: "JSON",
      outputsize: "5000",
      start_date: `${fromDate} 00:00:00`,
      end_date: `${toDate} 23:59:59`,
    });
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

    const bars: HourlyBar[] = [];
    for (const value of values) {
      const bar = toHourlyBar(value);
      if (bar !== null) bars.push(bar);
    }
    if (bars.length === 0) {
      return err(this.#fail(pair, "empty", `TwelveData returned no usable hourly bar for ${pair}`));
    }
    // Optional archive hook. FAIL-SAFE: an observer failure can never fail or alter the fetch.
    if (this.#onHourlyBars !== undefined) {
      try {
        await this.#onHourlyBars(pair, bars);
      } catch {
        /* the archive is a measurement aid; the daily-candle path must not depend on it */
      }
    }
    return ok(bars);
  }

  #fail(pair: Pair, mode: OhlcFeedError["mode"], message: string): OhlcFeedError {
    return {
      reason: "ohlc_feed_error",
      mode,
      provider: PROVIDER_NAME,
      pair,
      message: redactSecrets(message, [this.#apiKey]),
    };
  }
}
