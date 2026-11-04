// Provider_Fallback_Chain resolver — Design Component 2
// (Requirements 1.1, 1.3, 4.1).
//
// Builds the ordered provider list FCS → Twelve Data → Massive from the resolved
// `OhlcFeedConfig` (an unconfigured provider — no key — is simply absent from the
// config and therefore from the chain), and exposes two first-usable-wins
// operations:
//
//   resolveLatest(pairs, asOf) — per-pair top-up
//   resolveRange(pair, from, to) — single-pair bounded backfill
//
// Resolution rules (R1.3, R4.1):
//   - First-usable-wins PER PAIR. A pair a provider returns usable candles for is
//     WON and removed from the outstanding set before the next provider is tried,
//     so a later provider never overwrites an earlier win.
//   - Advance past a provider that is unconfigured / errors / returns `empty` /
//     lacks the needed capability (`supportsRange` false ⇒ skip for a range,
//     `supportsLatest` false ⇒ skip for a latest).
//   - A pair/range no provider could satisfy resolves to the LAST typed,
//     secret-free `OhlcFeedError` observed (the stage logs it and proceeds).

import type { TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import { FcsOhlcFeedProvider } from "./fcsOhlcProvider.js";
import { MassiveOhlcFeedProvider } from "./massiveOhlcProvider.js";
import { TwelveDataOhlcFeedProvider } from "./twelveDataOhlcProvider.js";
import type { OhlcFeedConfig, OhlcFeedError, OhlcFeedProvider } from "./types.js";

/** A resolved win for a pair: the candles plus the winning provider's name. */
export interface ResolvedCandles {
  readonly candles: readonly RawCandle[];
  readonly provider: string;
}

/** Either a resolved win or the last typed error (secret-free). */
export type ResolveOutcome = ResolvedCandles | OhlcFeedError;

/** Type guard: did resolution yield usable candles? */
export function isResolved(outcome: ResolveOutcome): outcome is ResolvedCandles {
  return (outcome as ResolvedCandles).candles !== undefined;
}

/** The chain operations the Candle_Freshness_Stage drives. */
export interface ProviderChain {
  /** Ordered provider names (provenance; never secrets). */
  readonly providerNames: readonly string[];
  /**
   * Top-up. Candles dated at/after `asOf` are discarded. When `required` (the
   * target Completed_Trading_Day) is given, a provider only wins a pair if its
   * response includes a candle dated at/after `required`; otherwise the chain
   * advances to the next provider.
   */
  resolveLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
    required?: TradingDate,
  ): Promise<ReadonlyMap<Pair, ResolveOutcome>>;
  resolveRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<ResolveOutcome>;
}

/** A pair's candles are "usable" only when the array is non-empty. */
function usable(candles: readonly RawCandle[]): boolean {
  return candles.length > 0;
}

/**
 * Date-aware screening of a "latest" response.
 *
 * "Latest" endpoints can return the still-forming candle for the decision day
 * (dated `asOf` or later), or an old candle the store already holds. Neither is
 * a usable top-up. Candles dated at/after `asOf` are dropped (they would also
 * trip the ingestion look-ahead guard for the whole batch), and when a
 * `required` target date is supplied the response is only usable if it still
 * contains a candle dated at/after it, so the chain advances to the next
 * provider instead of accepting a stale win. ISO `YYYY-MM-DD` strings compare
 * lexicographically.
 */
function screenLatest(
  candles: readonly RawCandle[],
  asOf: TradingDate,
  required: TradingDate | undefined,
): readonly RawCandle[] | undefined {
  // A candle with no `date` cannot be verified as past-only, so it is not usable
  // here (every real adapter sets `date`).
  const past = candles.filter((c) => c.date !== undefined && c.date < asOf);
  if (past.length === 0) return undefined;
  if (required !== undefined && !past.some((c) => c.date !== undefined && c.date >= required)) {
    return undefined;
  }
  return past;
}

/**
 * Build the ordered provider chain from a resolved config. The `fetchImpl` is
 * injected into every constructed adapter so tests run with no live network.
 * An unconfigured provider is already absent from `config.providers`, so the
 * chain only contains providers with a key.
 */
export function buildProviderChain(
  config: OhlcFeedConfig,
  fetchImpl: typeof fetch = fetch,
): ProviderChain {
  const providers: OhlcFeedProvider[] = config.providers.map((providerConfig) => {
    switch (providerConfig.provider) {
      case "FCS":
        return new FcsOhlcFeedProvider(providerConfig, fetchImpl);
      case "TwelveData":
        return new TwelveDataOhlcFeedProvider(providerConfig, fetchImpl);
      case "Massive":
        return new MassiveOhlcFeedProvider(providerConfig, fetchImpl);
      default:
        throw new Error(`unknown OHLC provider: ${providerConfig.provider}`);
    }
  });

  return new ProviderChainImpl(providers);
}

/**
 * Build a chain directly from already-constructed providers (used by tests with
 * stub providers, and by the config-driven {@link buildProviderChain}).
 */
export function chainFromProviders(providers: readonly OhlcFeedProvider[]): ProviderChain {
  return new ProviderChainImpl(providers);
}

class ProviderChainImpl implements ProviderChain {
  readonly #providers: readonly OhlcFeedProvider[];

  constructor(providers: readonly OhlcFeedProvider[]) {
    this.#providers = providers;
  }

  get providerNames(): readonly string[] {
    return this.#providers.map((p) => p.name);
  }

  async resolveLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
    required?: TradingDate,
  ): Promise<ReadonlyMap<Pair, ResolveOutcome>> {
    const won = new Map<Pair, ResolvedCandles>();
    const lastError = new Map<Pair, OhlcFeedError>();
    const outstanding = new Set<Pair>(pairs);

    for (const provider of this.#providers) {
      if (outstanding.size === 0) break;
      if (!provider.supportsLatest) continue;

      const remaining = [...outstanding];
      const byPair = await provider.fetchLatest(remaining, asOf);

      for (const pair of remaining) {
        const result = byPair.get(pair);
        if (result === undefined) {
          lastError.set(pair, this.#missing(provider.name, pair));
          continue;
        }
        const screened =
          result.ok && usable(result.value)
            ? screenLatest(result.value, asOf, required)
            : undefined;
        if (result.ok && screened !== undefined) {
          // First-usable-wins: record the win and remove the pair from the
          // outstanding set so no later provider can overwrite it.
          won.set(pair, { candles: screened, provider: provider.name });
          outstanding.delete(pair);
        } else {
          lastError.set(
            pair,
            result.ok
              ? this.#empty(provider.name, pair)
              : result.error,
          );
        }
      }
    }

    const out = new Map<Pair, ResolveOutcome>();
    for (const pair of pairs) {
      const win = won.get(pair);
      if (win !== undefined) {
        out.set(pair, win);
      } else {
        out.set(pair, lastError.get(pair) ?? this.#exhausted(pair));
      }
    }
    return out;
  }

  async resolveRange(
    pair: Pair,
    fromDate: TradingDate,
    toDate: TradingDate,
  ): Promise<ResolveOutcome> {
    let lastError: OhlcFeedError | undefined;

    for (const provider of this.#providers) {
      if (!provider.supportsRange) {
        // Capability skip (e.g. FCS): record a secret-free advance reason.
        lastError = {
          reason: "ohlc_feed_error",
          mode: "range_unsupported",
          provider: provider.name,
          pair,
          message: `${provider.name} does not support a date range`,
        };
        continue;
      }
      const result = await provider.fetchRange(pair, fromDate, toDate);
      if (result.ok && usable(result.value)) {
        return { candles: result.value, provider: provider.name };
      }
      lastError = result.ok ? this.#empty(provider.name, pair) : result.error;
    }

    return lastError ?? this.#exhausted(pair);
  }

  #missing(provider: string, pair: Pair): OhlcFeedError {
    return {
      reason: "ohlc_feed_error",
      mode: "empty",
      provider,
      pair,
      message: `${provider} returned no result for ${pair}`,
    };
  }

  #empty(provider: string, pair: Pair): OhlcFeedError {
    return {
      reason: "ohlc_feed_error",
      mode: "empty",
      provider,
      pair,
      message: `${provider} returned no usable candles for ${pair}`,
    };
  }

  #exhausted(pair: Pair): OhlcFeedError {
    return {
      reason: "ohlc_feed_error",
      mode: "unconfigured",
      provider: "none",
      pair,
      message: `no OHLC provider configured for ${pair}`,
    };
  }
}
