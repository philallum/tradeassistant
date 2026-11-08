// FCS OHLC_Feed_Provider adapter (latest-only) — Design Component 1
// (Requirements 1.2, 1.3, 1.6, 1.7, 4.1).
//
// Reuses the proven `/forex/latest?symbol=…&period=1d&access_key=…` batch call
// pattern from `src/external-signal/fcsProvider.ts`: all five pairs in ONE HTTP
// request (comma-separated symbols) to respect the Free-plan ~3 req/min limit,
// memoized per `asOf` for a short window so concurrent calls collapse to one
// request. Each response row carries an `active` sub-object with the daily OHLC;
// this adapter maps the latest daily candle to the internal `RawCandle` shape
// and stamps `source` with the provider name.
//
// Capability: `supportsLatest = true`, `supportsRange = false`. `fetchRange`
// returns `err({ mode: "range_unsupported" })` IMMEDIATELY (FCS free plan has no
// date-range series), so the Provider_Fallback_Chain advances past it for a
// Gap_Backfill — the explicit capability distinction the design calls for.
//
// Fail-safe per pair: network error → `unavailable`, non-200 → `unavailable`,
// non-JSON body → `invalid`, missing/uncoercible row → `empty`. The API key is
// a secret and never appears in a log line or an error message (Requirement 1.7).

import { err, ok, type Result } from "../../guard/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import { PAIRS } from "../types.js";
import {
  FCS_OHLC_DEFAULT_BASE_URL,
  type OhlcFeedError,
  type OhlcFeedProvider,
  type OhlcProviderConfig,
} from "./types.js";
import { redactSecrets } from "../redactSecrets.js";

/** Provider provenance tag stamped onto `RawCandle.source` and errors. */
const PROVIDER_NAME = "FCS" as const;

/** How long a batched `/forex/latest` response is reused (ms). */
const BATCH_TTL_MS = 60_000;

/** The `active` sub-object of a `/forex/latest` row carrying the daily OHLC. */
interface FcsActiveCandle {
  readonly o?: number | string;
  readonly open?: number | string;
  readonly h?: number | string;
  readonly high?: number | string;
  readonly l?: number | string;
  readonly low?: number | string;
  readonly c?: number | string;
  readonly close?: number | string;
  readonly t?: number | string; // unix seconds (optional)
  readonly tm?: string; // "YYYY-MM-DD HH:mm:ss" (optional)
  readonly date?: string; // "YYYY-MM-DD" (optional)
}

/** One row of the `/forex/latest` response (one exchange feed for a symbol). */
interface FcsLatestRow {
  readonly ticker?: string;
  readonly active?: FcsActiveCandle;
}

/** The `/forex/latest` response envelope. */
interface FcsLatestResponse {
  readonly status?: boolean;
  readonly code?: number;
  readonly msg?: string;
  readonly response?: ReadonlyArray<FcsLatestRow>;
}

/** Coerce a numeric field (number or numeric string) to a finite number, or null. */
function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Derive a `YYYY-MM-DD` date from an FCS `active` row, falling back to `asOf`. */
function dateFromActive(active: FcsActiveCandle, asOf: TradingDate): string {
  if (typeof active.date === "string" && active.date.trim() !== "") {
    return active.date.slice(0, 10);
  }
  if (typeof active.tm === "string" && active.tm.trim() !== "") {
    return active.tm.slice(0, 10);
  }
  const tSeconds = toNumber(active.t);
  if (tSeconds !== null) {
    return new Date(tSeconds * 1000).toISOString().slice(0, 10);
  }
  return asOf;
}

/**
 * Pick the row for `pair` from a `/forex/latest` response. FCS returns one row
 * per exchange feed (e.g. `FCM:EURUSD`, `FX:EURUSD`); take the first row whose
 * ticker ends with the requested pair symbol.
 */
function rowForPair(rows: readonly FcsLatestRow[], pair: Pair): FcsLatestRow | undefined {
  return rows.find((r) => typeof r.ticker === "string" && r.ticker.endsWith(pair));
}

/** A per-pair latest result parsed from a batch response. */
type PairResult = Result<readonly RawCandle[], OhlcFeedError>;

/**
 * A real {@link OhlcFeedProvider} backed by FCS over REST. Latest-only: it can
 * serve the Daily_Top_Up but not a Gap_Backfill (`fetchRange` →
 * `range_unsupported`). It never throws — every failure path is a typed,
 * secret-free {@link OhlcFeedError}.
 */
export class FcsOhlcFeedProvider implements OhlcFeedProvider {
  readonly name = PROVIDER_NAME;
  readonly supportsLatest = true;
  readonly supportsRange = false;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  /** The in-flight / cached batch keyed by `asOf` (dedupes parallel calls). */
  #batch:
    | { asOf: TradingDate; at: number; promise: Promise<ReadonlyMap<Pair, PairResult>> }
    | undefined;

  constructor(config: OhlcProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (config.apiKey === "") {
      throw new Error("FcsOhlcFeedProvider requires a non-empty API key");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl.trim() === "" ? FCS_OHLC_DEFAULT_BASE_URL : config.baseUrl.trim();
    this.#fetch = fetchImpl;
  }

  async fetchLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
  ): Promise<ReadonlyMap<Pair, PairResult>> {
    const byPair = await this.#batchFor(asOf);
    const out = new Map<Pair, PairResult>();
    for (const pair of pairs) {
      out.set(
        pair,
        byPair.get(pair) ?? err(this.#fail(pair, "empty", `no row for ${pair}`)),
      );
    }
    return out;
  }

  fetchRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    // FCS is latest-only; the range bounds are intentionally unused.
    void fromDate;
    void toDate;
    return Promise.resolve(
      err(this.#fail(pair, "range_unsupported", "FCS free plan has no date-range series")),
    );
  }

  /**
   * Return the memoized batch result for `asOf`, issuing exactly ONE
   * `/forex/latest` request for all five pairs. Concurrent calls share the
   * single in-flight promise, so the Free-plan rate limit is never tripped.
   */
  #batchFor(asOf: TradingDate): Promise<ReadonlyMap<Pair, PairResult>> {
    const now = Date.now();
    const cached = this.#batch;
    if (cached !== undefined && cached.asOf === asOf && now - cached.at < BATCH_TTL_MS) {
      return cached.promise;
    }
    const promise = this.#fetchBatch(asOf);
    this.#batch = { asOf, at: now, promise };
    return promise;
  }

  /** Fetch and parse all five pairs in one request; map each to a per-pair result. */
  async #fetchBatch(asOf: TradingDate): Promise<ReadonlyMap<Pair, PairResult>> {
    const symbols = PAIRS.join(",");
    const url =
      `${this.#baseUrl.replace(/\/+$/, "")}/forex/latest` +
      `?symbol=${encodeURIComponent(symbols)}&period=1d&access_key=${encodeURIComponent(this.#apiKey)}`;

    const out = new Map<Pair, PairResult>();
    const failAll = (
      mode: OhlcFeedError["mode"],
      message: string,
    ): ReadonlyMap<Pair, PairResult> => {
      for (const p of PAIRS) out.set(p, err(this.#fail(p, mode, message)));
      return out;
    };

    let response: Response;
    try {
      response = await this.#fetch(url, { method: "GET" });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return failAll("unavailable", `FCS request failed: ${detail}`);
    }

    if (!response.ok) {
      return failAll("unavailable", `FCS returned HTTP ${response.status}`);
    }

    let body: FcsLatestResponse;
    try {
      body = (await response.json()) as FcsLatestResponse;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return failAll("invalid", `FCS returned non-JSON body: ${detail}`);
    }

    if (body.status !== true || !Array.isArray(body.response)) {
      return failAll("invalid", `FCS error ${body.code ?? "?"}: ${body.msg ?? "no response"}`);
    }

    for (const pair of PAIRS) {
      const row = rowForPair(body.response, pair);
      const active = row?.active;
      if (active === undefined) {
        out.set(pair, err(this.#fail(pair, "empty", `no usable row for ${pair}`)));
        continue;
      }
      const open = toNumber(active.o ?? active.open);
      const high = toNumber(active.h ?? active.high);
      const low = toNumber(active.l ?? active.low);
      const close = toNumber(active.c ?? active.close);
      if (open === null || high === null || low === null || close === null) {
        out.set(pair, err(this.#fail(pair, "empty", `no usable OHLC for ${pair}`)));
        continue;
      }
      const candle: RawCandle = {
        asset: pair,
        pair,
        date: dateFromActive(active, asOf),
        open,
        high,
        low,
        close,
        source: PROVIDER_NAME,
      };
      out.set(pair, ok([candle]));
    }
    return out;
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
