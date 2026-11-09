// OHLC_Feed_Provider port, capability model, typed error, and config reader —
// Design Component 1 (Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.1).
//
// A thin, swappable PORT for fetching daily OHLC candles from a third-party
// provider over the built-in `fetch` (no vendor SDK). It mirrors the
// external-signal `ExternalSignalProvider` style exactly: every method returns a
// `Result` from the `guard` vocabulary (never throws), per-pair fail-safety, and
// API keys referenced BY NAME ONLY (never logged, never placed in an error).
//
// Distinct from the display-only External_Reference_Signal use of FCS: this port
// feeds the Candle_Freshness_Stage, whose output goes through the existing
// `OhlcIngestion` validation + idempotent upsert path. It therefore returns the
// internal `RawCandle` shape that `OhlcIngestion.ingest` already accepts.
//
// Capability model: a provider advertises whether it can serve a date-range
// history fetch (`fetchRange`) or only the latest candle (`fetchLatest`). This
// makes the capability explicit so the Provider_Fallback_Chain can route a range request past it.

import type { Result, TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";

/**
 * The modelled fail-safe failure modes for an OHLC_Feed_Provider. Every provider
 * request that cannot yield usable candles resolves to one of these, so the
 * Provider_Fallback_Chain can decide to advance to the next provider.
 */
export const OHLC_FEED_FAILURE_MODES = [
  "unconfigured", // provider has no API key
  "unavailable", // network / non-200
  "invalid", // malformed or non-JSON body
  "empty", // 200 but no usable candle for the pair/range
  "range_unsupported", // provider cannot serve a date range (FCS free plan)
  "timeout",
] as const;

/** A modelled OHLC-feed failure mode. */
export type OhlcFeedFailureMode = (typeof OHLC_FEED_FAILURE_MODES)[number];

/**
 * A typed, SECRET-FREE OHLC-feed failure for a Pair. Surfaced as the error side
 * of a provider's `Result`; the chain turns it into "advance to the next
 * provider", and the stage logs it (without any key value) before proceeding.
 */
export interface OhlcFeedError {
  readonly reason: "ohlc_feed_error";
  /** Which failure mode occurred. */
  readonly mode: OhlcFeedFailureMode;
  /** Provider provenance tag — never a secret. */
  readonly provider: string;
  /** The Pair the fetch failed for. */
  readonly pair: Pair;
  /** Human-readable, secret-free explanation of the failure. */
  readonly message: string;
}

/**
 * The thin, swappable OHLC_Feed_Provider PORT — Design Component 1
 * (Requirement 1). A concrete adapter (Twelve Data, Massive) implements
 * only these methods over the built-in `fetch`, so the vendor can be swapped
 * without touching the chain or the stage.
 *
 * The return types are from the `guard` vocabulary (`Result` of `RawCandle[]`),
 * never a scoring-path type: the provider cannot, by its type, bypass the
 * `OhlcIngestion` validation path.
 */
export interface OhlcFeedProvider {
  /** Provenance tag stamped onto `RawCandle.source` and logs (never a secret). */
  readonly name: string;
  /** Capability flag: can this provider serve the latest candle(s)? */
  readonly supportsLatest: boolean;
  /** Capability flag: can this provider serve a date-range history? */
  readonly supportsRange: boolean;

  /**
   * Daily_Top_Up: the most recent completed daily candle(s) for the pairs.
   * Returns one `Result` per requested pair so a single pair's failure cannot
   * affect the others.
   */
  fetchLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
  ): Promise<ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>>;

  /**
   * Gap_Backfill: the daily series for one pair in `[fromDate, toDate]`. A
   * provider that cannot serve a range returns `err({ mode: "range_unsupported" })`.
   */
  fetchRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>>;
}

/** Default Twelve Data base URL. */
export const TWELVE_DATA_DEFAULT_BASE_URL = "https://api.twelvedata.com" as const;

/** Default Massive base URL. */
export const MASSIVE_DEFAULT_BASE_URL = "https://api.massive.com" as const;

/**
 * The resolved config for one OHLC_Feed_Provider: its base URL and the NAME of
 * the environment variable its API key came from, plus the key value itself.
 * The `apiKey` is held only to construct the adapter; it is never logged. The
 * `provider` tag and `keyEnvName` are safe to surface.
 */
export interface OhlcProviderConfig {
  /** Provenance tag (e.g. "TwelveData", "Massive"). */
  readonly provider: string;
  /** The env-var name the key came from (safe to log — a name, not a value). */
  readonly keyEnvName: string;
  /** The provider API key value (secret — construct-only, never logged). */
  readonly apiKey: string;
  /** The resolved base URL for the provider. */
  readonly baseUrl: string;
}

/**
 * The resolved OHLC-feed config: the ordered list of configured providers
 * (Twelve Data → Massive; FCS is NOT a candle source: its "latest" is a forming bar). A provider whose key is absent is omitted, so
 * the chain simply skips it. When NO key is present the list is empty, which
 * the chain treats as "no provider configured".
 */
export interface OhlcFeedConfig {
  /** Configured providers in the fixed fallback order; may be empty. */
  readonly providers: readonly OhlcProviderConfig[];
}

/** Trim an env value to a non-empty string, or `undefined`. */
function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * Read the OHLC-feed env-var contract into an {@link OhlcFeedConfig}, mirroring
 * `externalSignalConfigFromEnv`. Reads BY NAME ONLY:
 *
 * - `TWELVE_DATA_API_KEY`
 * - `MASSIVE_API_KEY`
 * - optional base URLs `TWELVE_DATA_BASE_URL`, `MASSIVE_BASE_URL` (with the documented defaults)
 *
 * A provider whose key is absent is omitted from the ordered list. When no key
 * is present the returned config carries an empty `providers` list (the chain
 * yields an exhausted/empty result). No key VALUE is ever placed in output,
 * logs, or an error — only the env-var NAME is retained for provenance.
 *
 * Pure with respect to the injected `env` map (defaults to `process.env`), so it
 * is testable offline without touching the real environment.
 */
export function ohlcFeedConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OhlcFeedConfig {
  const providers: OhlcProviderConfig[] = [];

  const twelveKey = cleanEnv(env.TWELVE_DATA_API_KEY);
  if (twelveKey !== undefined) {
    providers.push({
      provider: "TwelveData",
      keyEnvName: "TWELVE_DATA_API_KEY",
      apiKey: twelveKey,
      baseUrl: cleanEnv(env.TWELVE_DATA_BASE_URL) ?? TWELVE_DATA_DEFAULT_BASE_URL,
    });
  }

  const massiveKey = cleanEnv(env.MASSIVE_API_KEY);
  if (massiveKey !== undefined) {
    providers.push({
      provider: "Massive",
      keyEnvName: "MASSIVE_API_KEY",
      apiKey: massiveKey,
      baseUrl: cleanEnv(env.MASSIVE_BASE_URL) ?? MASSIVE_DEFAULT_BASE_URL,
    });
  }

  return { providers };
}
