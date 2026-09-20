// Silent-by-Default Dashboard & Currency Concentration Guard Types —
// Components 11 and 16 (Requirements 16, 22, 1, 12.3).
//
// This module is part of the DETERMINISTIC CORE for the firing decision and the
// currency-concentration suppression: both are pure functions of typed numeric
// inputs and enumerated values, with NO LLM input (Requirements 2.1, 22.4).
//
// The only LLM-derived values that appear here are the OUTWARD-ONLY display
// fields on a rendered FiringCard (`rationale`, `analogueLabels`). They flow
// outward to the view and never back into any firing / suppression / scoring
// decision (Requirements 15.2, 15.4). The firing and guard logic never reads
// them.

import type { Confidence, Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { TradingDate } from "../guard/types.js";

/**
 * The favorable-versus-adverse excursion profile shown on a firing card
 * (Requirement 16.3): the neighborhood's expected favorable (MFE-derived) and
 * adverse (MAE-derived) movement, in pips.
 */
export interface ExcursionProfile {
  readonly favorablePips: number;
  readonly adversePips: number;
}

/**
 * A per-pair firing setup: the deterministic outcome of a pair's firing
 * decision on a Decision_Date, BEFORE the Currency Concentration Guard and the
 * final render. It carries only deterministic-core values — no LLM-derived
 * type — so it is safe to hand to the guard (Requirement 22.4).
 *
 * A `FiringSetup` exists only for a pair that has already satisfied all three
 * per-pair firing conditions: a Kill_Gate-passing pattern, Earned_Confidence at
 * or above the configurable Confidence_Threshold, and news permitting trading
 * (Requirements 16.2, 16.5, 16.6, 1.1). The Currency Concentration Guard then
 * decides which of these to keep and which to suppress (Requirement 22).
 */
export interface FiringSetup {
  readonly pair: Pair;
  readonly direction: DirectionClass;
  readonly horizon: Horizon;
  readonly earnedConfidence: Confidence;
  readonly excursionProfile: ExcursionProfile;
  /**
   * The empirical Stop_Loss in pips from Component 15 (Requirement 21.4), or
   * `null` when the neighborhood is below the 30-analogue floor and boundaries
   * are not actionable (Requirement 21.5). Passed in as an input so this module
   * has no hard dependency on the (parallel) risk-boundaries module.
   */
  readonly stopLossPips: number | null;
  /** The empirical Take_Profit in pips from Component 15 (Requirement 21.4), or `null`. */
  readonly takeProfitPips: number | null;
}

/**
 * A setup suppressed by the Currency Concentration Guard (Design Component 16).
 * Records the fixed `currency_concentration` reason and the aligned
 * same-currency pairs that outranked it by Earned_Confidence (Requirement 22.3).
 * There is deliberately NO Direction_Class-producing field: the guard is a
 * suppressor, never a signal source (Requirement 22.4).
 */
export interface SuppressedSetup {
  readonly pair: Pair;
  readonly reason: "currency_concentration";
  /** The aligned same-currency pairs that outranked it (Requirement 22.3). */
  readonly competingPairs: readonly Pair[];
}

/**
 * The result of applying the Currency Concentration Guard to a set of firing
 * setups: the retained setups and the suppressed ones (Requirement 22.2).
 */
export interface CurrencyConcentrationResult {
  readonly kept: readonly FiringSetup[];
  readonly suppressed: readonly SuppressedSetup[];
}

/**
 * The Currency Concentration Guard interface — Design Component 16
 * (Requirement 22).
 *
 * Pure, deterministic, no LLM input (Requirement 22.4). Groups same-day firing
 * setups by shared base/quote currency AND directional alignment, keeps only
 * the top-N highest-Earned_Confidence aligned setups (default N=2), and
 * suppresses the rest with a `currency_concentration` reason and competing
 * pairs (Requirements 22.1, 22.2, 22.3, 22.5).
 */
export interface CurrencyConcentrationGuard {
  apply(
    firing: readonly FiringSetup[],
    decisionDate: TradingDate,
    config?: { maxConcurrentAligned?: number },
  ): CurrencyConcentrationResult;
}

/**
 * A rendered firing card — Design Component 11 (Requirements 16.3, 1.3, 1.5,
 * 21.4). Includes every required field: pair, Direction_Class, selected
 * Horizon, Earned_Confidence, the favorable-versus-adverse excursion profile,
 * the empirical Stop_Loss / Take_Profit, and the AI rationale + analogue labels.
 *
 * `rationale` and `analogueLabels` are the OUTWARD-ONLY display strings produced
 * by the `signal_rationale` / `pattern_description` roles (Requirement 15). They
 * are already unwrapped from their `LlmTagged<…>` provenance markers at the
 * render boundary and never re-enter any scoring / firing path.
 */
export interface FiringCard {
  readonly pair: Pair;
  readonly direction: DirectionClass;
  readonly horizon: Horizon;
  readonly earnedConfidence: number;
  readonly excursionProfile: ExcursionProfile;
  /** Empirical Stop_Loss in pips (Component 15), or `null` when below the floor. */
  readonly stopLossPips: number | null;
  /** Empirical Take_Profit in pips (Component 15), or `null` when below the floor. */
  readonly takeProfitPips: number | null;
  /** Plain-language AI rationale (display-only, Requirement 15.1). */
  readonly rationale: string;
  /** Qualitative analogue labels (display-only, Requirement 15.3). */
  readonly analogueLabels: readonly string[];
}

/**
 * The dashboard view for a Decision_Date — the output of `Dashboard.dailyRun()`
 * (Requirement 16.1). Silent by default: `cards` is empty when no pair survives
 * all three firing conditions and the Currency Concentration Guard
 * (Requirement 16.2). `suppressed` records the guard's suppression decisions for
 * auditing (Requirement 22.3).
 */
export interface DashboardView {
  readonly decisionDate: TradingDate;
  /** The firing cards to render, in deterministic order. Empty ⇒ silent. */
  readonly cards: readonly FiringCard[];
  /** Currency-concentration suppressions applied before render (Requirement 22.3). */
  readonly suppressed: readonly SuppressedSetup[];
}

/**
 * Dashboard configuration (Requirement 16.4, 22.5). Both knobs are configurable
 * and tunable against the Kill_Gate backtest.
 */
export interface DashboardConfig {
  /**
   * The Confidence_Threshold a pair's Earned_Confidence must reach (>=) to fire
   * (Requirements 16.2, 16.4, 1.1). Configurable and backtest-tunable.
   */
  readonly confidenceThreshold: number;
  /**
   * The maximum number of aligned same-currency setups the Currency
   * Concentration Guard retains per group (default 2, Requirement 22.5).
   */
  readonly maxConcurrentAligned: number;
}

/** The default Confidence_Threshold. Configurable per {@link DashboardConfig}. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.55 as const;

/**
 * The default maximum concurrent aligned exposure the Currency Concentration
 * Guard permits per currency-and-direction group (Requirement 22.2, 22.5).
 */
export const DEFAULT_MAX_CONCURRENT_ALIGNED = 2 as const;

/** The default dashboard configuration. */
export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  maxConcurrentAligned: DEFAULT_MAX_CONCURRENT_ALIGNED,
};

// --- Currency decomposition -----------------------------------------------

/**
 * The base and quote currency of a Pair. The five pairs decompose as:
 * EURUSD=(EUR,USD), GBPUSD=(GBP,USD), USDJPY=(USD,JPY), USDCHF=(USD,CHF),
 * USDCAD=(USD,CAD).
 */
export interface PairCurrencies {
  readonly base: string;
  readonly quote: string;
}

/**
 * Decompose a Pair into its base and quote currencies. A Pair symbol is exactly
 * six characters: the first three are the base currency, the last three the
 * quote currency (e.g. "EURUSD" → base "EUR", quote "USD").
 */
export function pairCurrencies(pair: Pair): PairCurrencies {
  return { base: pair.slice(0, 3), quote: pair.slice(3, 6) };
}

/**
 * A directional stance on a single currency: bullish (+1) or bearish (−1).
 * FLAT setups express no directional view on either currency and therefore
 * never participate in currency-concentration alignment.
 */
export type CurrencyStance = 1 | -1;

/**
 * The directional exposure a firing setup expresses on a specific currency,
 * derived from the pair structure and Direction_Class — NOT naive symbol
 * matching.
 *
 * For a pair BASEQUOTE:
 *   - Direction UP   ⇒ base strengthens (+1), quote weakens (−1).
 *   - Direction DOWN ⇒ base weakens (−1), quote strengthens (+1).
 *   - Direction FLAT ⇒ no directional exposure on either currency.
 *
 * Example: EURUSD UP means USD DOWN (quote weakens, −1), while USDJPY UP means
 * USD UP (base strengthens, +1). Two setups are "aligned" on a currency when
 * they express the SAME stance (both +1 or both −1) on that shared currency.
 *
 * Returns a map from currency code to stance. Empty for a FLAT setup.
 */
export function currencyStances(
  pair: Pair,
  direction: DirectionClass,
): ReadonlyMap<string, CurrencyStance> {
  const stances = new Map<string, CurrencyStance>();
  if (direction === "FLAT") {
    return stances;
  }
  const { base, quote } = pairCurrencies(pair);
  const baseStance: CurrencyStance = direction === "UP" ? 1 : -1;
  const quoteStance: CurrencyStance = direction === "UP" ? -1 : 1;
  stances.set(base, baseStance);
  stances.set(quote, quoteStance);
  return stances;
}
