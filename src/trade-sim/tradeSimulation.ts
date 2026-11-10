// Path-aware Trade_Simulation — trader-edge-validation Stage B (task 3; design R1).
//
// THE FIX for the reviewer's one methodological defect. The forward-outcome
// resolver (`src/retrieval/resolver.ts`) computes MFE and MAE as two INDEPENDENT
// maxima, so it records how far price travelled each way but NOT the ORDER — it
// cannot say whether the stop or the target was hit first. This module replays a
// proposed trade against the ACTUAL chronological candle path and answers exactly
// that question.
//
// Resolution per candle, walking forward to Horizon expiry (R1.1–R1.3):
//   - neither level in [low, high]        → continue to the next candle
//   - only the target touched             → `target_first`, resolve here
//   - only the stop touched               → `stop_first`, resolve here
//   - BOTH touched in one candle           → `ambiguous` (D1 intra-candle order is
//                                            unknown; NEVER assume the favourable
//                                            fill — R1.2), unless an injected
//                                            `IntraCandleResolver` disambiguates it
//   - expiry reached untouched            → `expired` with signed close-to-close pips
//
// Pure, deterministic (R1 identical inputs ⇒ identical outcome), Look_Ahead_Safe
// (reads only candles in the entry→expiry window the caller bounds — R1.5), and
// LLM-free (R1.6). Nothing here feeds the live firing / scoring / confidence path.

import type { Candle } from "../guard/types.js";
import { fromPips } from "./pip.js";
import type { IntraCandleResolver, TradeOutcome, TradeProposal } from "./types.js";

/**
 * The absolute Stop_Loss / Take_Profit price levels for a proposal. For a long
 * (UP) the target is above and the stop below the entry; mirrored for a short.
 */
export function priceLevels(proposal: TradeProposal): {
  readonly stopPrice: number;
  readonly targetPrice: number;
} {
  const stopDist = fromPips(proposal.stopLossPips, proposal.pair);
  const targetDist = fromPips(proposal.takeProfitPips, proposal.pair);
  if (proposal.direction === "UP") {
    return { stopPrice: proposal.entryPrice - stopDist, targetPrice: proposal.entryPrice + targetDist };
  }
  return { stopPrice: proposal.entryPrice + stopDist, targetPrice: proposal.entryPrice - targetDist };
}

/** Does the candle's [low, high] range contain `price` (inclusive)? */
function touches(candle: Candle, price: number): boolean {
  return candle.low <= price && price <= candle.high;
}

/**
 * Signed close-to-close pips at expiry (favourable = positive), from the entry
 * price to the terminal candle's close, in the proposal's direction. For an
 * expired long: close − entry (in pips); for a short: entry − close.
 */
function expiredPips(proposal: TradeProposal, terminalClose: number): number {
  const dist = terminalClose - proposal.entryPrice;
  const favourable = proposal.direction === "UP" ? dist : -dist;
  // Convert to pips WITHOUT abs so the sign (win vs loss at expiry) is preserved.
  const pipValue = proposal.pair.includes("JPY") ? 0.01 : 0.0001;
  return Math.round((favourable / pipValue) * 10) / 10;
}

/**
 * Replay one proposed trade against its forward candle path.
 *
 * @param proposal           the trade (entry, direction, horizon, SL/TP pips).
 * @param forwardCandles     candles for the pair, chronological, bounded by the
 *                           caller to the entry→Horizon-expiry window. The
 *                           simulation consumes at most `horizon` candles dated
 *                           on or after the entry date, the entry session first
 *                           (Look_Ahead_Safe: nothing before the fill is read).
 * @param intraCandleResolver optional lower-timeframe disambiguation seam (R1.4);
 *                           absent ⇒ a both-touched candle stays `ambiguous`.
 */
export function simulateTrade(
  proposal: TradeProposal,
  forwardCandles: readonly Candle[],
  intraCandleResolver?: IntraCandleResolver,
): TradeOutcome {
  const { stopPrice, targetPrice } = priceLevels(proposal);

  // The path starts at the ENTRY session itself: a fill at that session's open is followed by
  // that session's own high/low, so a stop or target touched later the same day must count.
  // (Filtering strictly AFTER the entry date skipped it and shifted the horizon by a session.)
  // Candles before the entry date can never be on the path. Chronological, capped to horizon.
  const path = [...forwardCandles]
    .filter((c) => c.asset === proposal.pair && c.date >= proposal.entryDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, proposal.horizon);

  for (const candle of path) {
    const hitStop = touches(candle, stopPrice);
    const hitTarget = touches(candle, targetPrice);

    if (hitStop && hitTarget) {
      // Both levels inside one candle: order unknown at D1 (R1.2).
      const resolved = intraCandleResolver?.(candle.date, proposal.pair) ?? null;
      if (resolved === "target_first") {
        return { kind: "target_first", resolvedOnDate: candle.date, grossPips: proposal.takeProfitPips, ambiguousCandleDate: null };
      }
      if (resolved === "stop_first") {
        return { kind: "stop_first", resolvedOnDate: candle.date, grossPips: -proposal.stopLossPips, ambiguousCandleDate: null };
      }
      return { kind: "ambiguous", resolvedOnDate: null, grossPips: 0, ambiguousCandleDate: candle.date };
    }

    if (hitTarget) {
      return { kind: "target_first", resolvedOnDate: candle.date, grossPips: proposal.takeProfitPips, ambiguousCandleDate: null };
    }
    if (hitStop) {
      return { kind: "stop_first", resolvedOnDate: candle.date, grossPips: -proposal.stopLossPips, ambiguousCandleDate: null };
    }
  }

  // Neither level touched within the horizon → expired at the last candle's close.
  const terminal: Candle | undefined = path[path.length - 1];
  if (terminal === undefined) {
    // No forward candles at all: nothing to resolve, treat as a 0-pip expiry.
    return { kind: "expired", resolvedOnDate: null, grossPips: 0, ambiguousCandleDate: null };
  }
  return {
    kind: "expired",
    resolvedOnDate: terminal.date,
    grossPips: expiredPips(proposal, terminal.close),
    ambiguousCandleDate: null,
  };
}
