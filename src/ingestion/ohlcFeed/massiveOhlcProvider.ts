// Massive OHLC_Feed_Provider adapter (latest + range) — Design Component 1.
//
// Fetches HOURLY aggregates and lets the shared session aggregator build the system's own daily
// candles on the 17:00 America/New_York close (closed + complete sessions only). Massive's `/prev`
// and 1-day aggregates are UTC calendar days, which are not the system's session
// (docs/state/RISKS.md, DAILY CANDLE DATA INTEGRITY).
//
//   GET /v2/aggs/ticker/C:<PAIR>/range/1/hour/<from>/<to>
//       ?adjusted=true&sort=asc&limit=50000&apiKey=<key>
//
// `t` is the bar START in epoch ms. Weekend bars are omitted; the aggregator tolerates a few
// missing hours. Ticker `EURUSD` becomes `C:EURUSD`.
//
// Fail-safe: network error → `unavailable`, non-200 → `unavailable`, non-JSON → `invalid`,
// absent/empty `results` or no complete session → `empty`. The API key is a secret and never
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
import { redactSecrets } from "../redactSecrets.js";
import type { HourlyBar } from "../sessionAggregation.js";
import { latestSessionCandle, rangeSessionCandles } from "./hourlySessionFeed.js";

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

/** Map one hourly aggregate result to an {@link HourlyBar}, or null if uncoercible. */
function toHourlyBar(result: MassiveResult): HourlyBar | null {
  const openMs = toNumber(result.t);
  const open = toNumber(result.o);
  const high = toNumber(result.h);
  const low = toNumber(result.l);
  const close = toNumber(result.c);
  if (openMs === null || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { openMs, open, high, low, close };
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

  readonly #now: () => Date;

  constructor(
    config: OhlcProviderConfig,
    fetchImpl: typeof fetch = fetch,
    now: () => Date = () => new Date(),
  ) {
    if (config.apiKey === "") {
      throw new Error("MassiveOhlcFeedProvider requires a non-empty API key");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl =
      config.baseUrl.trim() === "" ? MASSIVE_DEFAULT_BASE_URL : config.baseUrl.trim();
    this.#fetch = fetchImpl;
    this.#now = now;
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

  async #fetchHourly(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly HourlyBar[], OhlcFeedError>> {
    const base = this.#baseUrl.replace(/\/+$/, "");
    const url =
      `${base}/v2/aggs/ticker/${encodeURIComponent(toMassiveTicker(pair))}` +
      `/range/1/hour/${encodeURIComponent(fromDate)}/${encodeURIComponent(toDate)}` +
      `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(this.#apiKey)}`;
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

    const bars: HourlyBar[] = [];
    for (const result of results) {
      const bar = toHourlyBar(result);
      if (bar !== null) bars.push(bar);
    }
    if (bars.length === 0) {
      return err(this.#fail(pair, "empty", `Massive returned no usable hourly bar for ${pair}`));
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
