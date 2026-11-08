// FCS API ExternalSignalProvider adapter (Requirement 23.4; Design Component 17
// — "a concrete provider / FX signals API adapter implements only this method").
//
// This is the real, swappable vendor adapter behind the
// `EXTERNAL_SIGNAL_PROVIDER=FCS` env contract. It fetches a CURRENT third-party
// read for a pair at daily-run time (Requirement 23.6) and maps it to the
// outward-only `ExternalReferenceSignal` the dashboard shows BESIDE the system's
// own output for human comparison (Requirements 23.1, 23.7).
//
// AI/Deterministic + display-only boundary: like the whole external-signal
// module, this adapter sits entirely OUTSIDE the deterministic core. It returns
// a `Result<ExternalReferenceSignal, ExternalSignalError>` from the `guard`
// vocabulary — never a Direction_Class, probability, or verdict — so by its type
// it cannot reach a scoring path. It uses ONLY the global `fetch` (no SDK) and
// is fail-safe: any network error, non-200, or unusable body becomes a typed
// `ExternalSignalError` and the orchestrator marks that pair "reference
// unavailable" (Requirement 23.5).
//
// FCS plan note: the signal/indicator endpoints (`/forex/indicators`,
// `/forex/ma_avg`, `/forex/signals`) require an upgraded plan. The widely-
// available `/forex/latest` endpoint returns the daily candle plus the daily
// change percent (`chp`), from which this adapter derives a BUY / SELL / HOLD
// reference direction with a small neutral band — a legitimate "what is the
// third party seeing today" read for side-by-side comparison. The daily change
// percent is carried through as the provider `score`.
//
// RATE LIMIT: the Free plan allows only ~3 requests/minute. The orchestrator
// (`fetchAllReferences`) calls `fetchReference` once per pair IN PARALLEL, which
// would be five requests and trip the limit. So this adapter fetches ALL
// requested pairs in ONE batched `/forex/latest` call (comma-separated symbols)
// and memoizes that response per Decision_Date for a short window; the five
// per-pair calls then collapse to a single HTTP request (and a single API
// credit). The batch is still fail-safe per pair: a pair missing from the batch
// response resolves to an `invalid`/`unavailable` reference without affecting
// the others.

import { err, ok, type Result } from "../guard/types.js";
import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type {
  ExternalReferenceSignal,
  ExternalSignalConfig,
  ExternalSignalError,
  ExternalSignalProvider,
  ReferenceDirection,
} from "./types.js";
import { redactSecrets } from "../ingestion/redactSecrets.js";

/** Default FCS API v4 base URL (used when `EXTERNAL_SIGNAL_BASE_URL` is blank). */
export const FCS_DEFAULT_BASE_URL = "https://api-v4.fcsapi.com" as const;

/**
 * Daily change-percent band (in %) within which the reference is treated as
 * `HOLD` ("no strong view"). Outside the band a positive change maps to `BUY`
 * and a negative change to `SELL`. 0.1% ≈ a flat FX session.
 */
const HOLD_BAND_PCT = 0.1 as const;

/** The `active` sub-object of a `/forex/latest` row we read. */
interface FcsActiveCandle {
  readonly c?: number | string;
  readonly chp?: number | string;
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

/** Coerce an FCS numeric field (number or numeric string) to a finite number, or null. */
function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Map a daily change percent to a reference direction with a neutral HOLD band. */
export function directionFromChangePercent(chp: number): ReferenceDirection {
  if (chp > HOLD_BAND_PCT) return "BUY";
  if (chp < -HOLD_BAND_PCT) return "SELL";
  return "HOLD";
}

/**
 * Pick the row for `pair` from a `/forex/latest` response. FCS returns one row
 * per exchange feed (e.g. `FCM:EURUSD`, `FX:EURUSD`); we take the first row
 * whose ticker ends with the requested pair symbol.
 */
function rowForPair(rows: readonly FcsLatestRow[], pair: Pair): FcsLatestRow | undefined {
  return rows.find((r) => typeof r.ticker === "string" && r.ticker.endsWith(pair));
}

/**
 * A real {@link ExternalSignalProvider} backed by the FCS API over REST.
 *
 * `fetchReference(pair, decisionDate)` calls `/forex/latest` for the pair,
 * derives a BUY/SELL/HOLD reference from the daily change percent, and returns
 * it as an `ExternalReferenceSignal` (the orchestrator re-stamps `provider` and
 * `fetchedAt`). It never throws: every failure path returns a typed
 * `ExternalSignalError` so one pair's outage cannot affect another pair or the
 * system's own output (Requirement 23.5).
 */
/** How long a batched `/forex/latest` response is reused (ms). */
const BATCH_TTL_MS = 60_000;

/** A per-pair result parsed from a batch response. */
type PairResult = Result<ExternalReferenceSignal, ExternalSignalError>;

export class FcsExternalSignalProvider implements ExternalSignalProvider {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #provider: string;
  readonly #fetch: typeof fetch;

  /** The in-flight / cached batch keyed by Decision_Date (dedupes parallel calls). */
  #batch: { decisionDate: TradingDate; at: number; promise: Promise<ReadonlyMap<Pair, PairResult>> } | undefined;

  constructor(config: ExternalSignalConfig, fetchImpl: typeof fetch = fetch) {
    if (config.apiKey === undefined || config.apiKey === "") {
      throw new Error("FcsExternalSignalProvider requires EXTERNAL_SIGNAL_API_KEY");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = (config.baseUrl ?? "").trim() === "" ? FCS_DEFAULT_BASE_URL : config.baseUrl!.trim();
    this.#provider = config.provider;
    this.#fetch = fetchImpl;
  }

  async fetchReference(
    pair: Pair,
    decisionDate: TradingDate,
  ): Promise<PairResult> {
    const byPair = await this.#batchFor(decisionDate);
    return (
      byPair.get(pair) ??
      err(this.#fail(pair, "invalid", `FCS batch had no row for ${pair}`))
    );
  }

  /**
   * Return the memoized batch result for the Decision_Date, issuing exactly ONE
   * `/forex/latest` request for all five pairs. Concurrent `fetchReference`
   * calls (the orchestrator fires all pairs in parallel) share the single
   * in-flight promise, so the Free-plan rate limit is never tripped.
   */
  #batchFor(decisionDate: TradingDate): Promise<ReadonlyMap<Pair, PairResult>> {
    const now = Date.now();
    const cached = this.#batch;
    if (cached !== undefined && cached.decisionDate === decisionDate && now - cached.at < BATCH_TTL_MS) {
      return cached.promise;
    }
    const promise = this.#fetchBatch(decisionDate);
    this.#batch = { decisionDate, at: now, promise };
    return promise;
  }

  /** Fetch and parse all five pairs in one request; map each to a per-pair result. */
  async #fetchBatch(decisionDate: TradingDate): Promise<ReadonlyMap<Pair, PairResult>> {
    const symbols = PAIRS.join(",");
    const url =
      `${this.#baseUrl.replace(/\/+$/, "")}/forex/latest` +
      `?symbol=${encodeURIComponent(symbols)}&period=1d&access_key=${encodeURIComponent(this.#apiKey)}`;

    const out = new Map<Pair, PairResult>();
    const failAll = (mode: ExternalSignalError["mode"], message: string): ReadonlyMap<Pair, PairResult> => {
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
      return failAll("unavailable", `FCS error ${body.code ?? "?"}: ${body.msg ?? "no response"}`);
    }

    for (const pair of PAIRS) {
      const row = rowForPair(body.response, pair);
      const chp = toNumber(row?.active?.chp);
      if (row === undefined || chp === null) {
        out.set(pair, err(this.#fail(pair, "invalid", `FCS response had no usable change for ${pair}`)));
        continue;
      }
      const signal: ExternalReferenceSignal = {
        pair,
        decisionDate,
        direction: directionFromChangePercent(chp),
        // The daily change percent is the provider's own numeric read; carry it
        // as the display-only score (rounded for a tidy dashboard value).
        score: Math.round(chp * 1000) / 1000,
        provider: this.#provider,
        fetchedAt: "1970-01-01T00:00:00.000Z", // re-stamped by the orchestrator
      };
      out.set(pair, ok(signal));
    }
    return out;
  }

  #fail(pair: Pair, mode: ExternalSignalError["mode"], message: string): ExternalSignalError {
    return { reason: "external_signal_error", mode, pair, message: redactSecrets(message, [this.#apiKey]) };
  }
}
