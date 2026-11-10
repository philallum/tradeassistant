// Hourly-resolved intra-candle ordering (offline measurement).
//
// On a daily candle that touches BOTH the stop and the target, the daily bar cannot say which
// came first, so `simulateTrade` reports `ambiguous` and never counts it as a win or a loss. The
// hourly bars the candle was built from usually can: walk them in time order and the first bar
// that touches a level decides. A single hour that touches both stays ambiguous (report, don't
// guess). This plugs into the existing `IntraCandleResolver` seam; the daily path is unchanged.
//
// Pure and deterministic. Reads only the bars handed to it.
import type { Pair } from "../ingestion/types.js";
import { sessionWindowUtcMs } from "../ingestion/sessionAggregation.js";
import { priceLevels } from "./tradeSimulation.js";
import type { IntraCandleResolver, TradeProposal } from "./types.js";

/** The minimal hourly bar the resolver needs. */
export interface ResolverBar {
  readonly openMs: number;
  readonly high: number;
  readonly low: number;
}

const touches = (bar: ResolverBar, price: number): boolean => bar.low <= price && price <= bar.high;

/**
 * Which level was touched first, walking `bars` in time order. `null` when neither is touched,
 * or when the first bar to touch anything touches BOTH (order unknowable at hourly resolution).
 */
export function firstTouchOrder(
  bars: readonly ResolverBar[],
  stopPrice: number,
  targetPrice: number,
): "stop_first" | "target_first" | null {
  for (const bar of [...bars].sort((a, b) => a.openMs - b.openMs)) {
    const hitStop = touches(bar, stopPrice);
    const hitTarget = touches(bar, targetPrice);
    if (hitStop && hitTarget) return null;
    if (hitTarget) return "target_first";
    if (hitStop) return "stop_first";
  }
  return null;
}

/**
 * An `IntraCandleResolver` for ONE proposal: for the session labelled `candleDate` it selects the
 * hourly bars inside that session's 17:00-NY window and orders the touches of this trade's stop
 * and target. `loadBars` returns the bars for a pair and UTC window (synchronous so the existing
 * seam stays synchronous; callers preload the window they need).
 */
export function hourlyIntraCandleResolver(
  proposal: TradeProposal,
  loadBars: (pair: Pair, fromMs: number, toMs: number) => readonly ResolverBar[],
): IntraCandleResolver {
  const { stopPrice, targetPrice } = priceLevels(proposal);
  return (candleDate, pair) => {
    const { startMs, endMs } = sessionWindowUtcMs(candleDate);
    return firstTouchOrder(loadBars(pair, startMs, endMs), stopPrice, targetPrice);
  };
}
