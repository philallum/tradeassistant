// Shared pip-unit helper — trader-edge-validation Stage A (task 1; design R1).
//
// A single source of truth for the project's pip convention so the path-aware
// Trade_Simulation (R1) reports pips that are directly comparable to the
// MFE/MAE pips the forward-outcome resolver already stores. The convention is
// lifted VERBATIM out of `src/retrieval/resolver.ts` (where it was a private
// `toPips`): JPY pairs use a pip of 0.01, every other pair uses 0.0001, and a
// converted magnitude is rounded to one decimal place.
//
// IMPORTANT — resolver parity (R1.1, R12.1): `toPips` here reproduces the
// resolver's historical semantics EXACTLY — it returns the rounded ABSOLUTE
// magnitude of the price difference (callers apply any sign themselves), using
// the same `Math.round(x * 10) / 10` one-decimal rounding. The resolver now
// imports this function instead of its own copy, and its stored MFE/MAE (which
// feed live scoring) must stay byte-identical. Do not change the rounding or the
// pip sizes without re-proving that parity.
//
// Pure, deterministic, no I/O, no hidden state, LLM-free.

import type { Pair } from "../ingestion/types.js";

/**
 * The price value of one pip for a pair: 0.01 for JPY-quoted pairs, 0.0001 for
 * all others. (Lifted verbatim from the resolver's inlined constant.)
 */
export function pipSize(pair: Pair): number {
  return pair.includes("JPY") ? 0.01 : 0.0001;
}

/**
 * Convert a price difference to approximate pips, returning the rounded ABSOLUTE
 * magnitude (one decimal place). This matches the resolver's original `toPips`
 * byte-for-byte: `Math.round((|priceDiff| / pipSize) * 10) / 10`. Any direction
 * sign is the caller's responsibility (the resolver applies it separately).
 */
export function toPips(priceDiff: number, pair: Pair): number {
  return Math.round((Math.abs(priceDiff) / pipSize(pair)) * 10) / 10;
}

/**
 * Convert a pip magnitude back to a price distance for a pair: `pips * pipSize`.
 * The inverse of {@link toPips} up to its one-decimal rounding — used by the
 * Trade_Simulation (R1) to turn Stop_Loss / Take_Profit pip distances into
 * absolute price levels off an entry price.
 */
export function fromPips(pips: number, pair: Pair): number {
  return pips * pipSize(pair);
}
