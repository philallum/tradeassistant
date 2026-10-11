// Execution_Model — trader-edge-validation Stage B (task 2; design R2).
//
// The explicit, version-stamped assumptions that turn a forecast into a trade a
// trader could actually have taken: WHERE and WHEN the fill is assumed, and what
// spread / commission / slippage it costs. A single named model is reused
// VERBATIM by the System and every Comparator_Strategy (R2.4) so comparisons are
// fair. These costs are MEASUREMENT inputs, never signal knobs (R12.2): nothing
// here feeds the firing / scoring / confidence decision.
//
// Pure, deterministic, LLM-free. No I/O, no clock — `resolveEntry` reads only the
// candles handed to it.

import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { toPips } from "./pip.js";
import type { TradeOutcome } from "./types.js";

/**
 * How the fill price is chosen. v1 supports only the next session's OPEN strictly
 * after the forecast is known — never the close the forecast was computed from
 * (R2.3). Modelled as a one-member union so a later reference is additive.
 */
export type EntryReference = "next_session_open";

/** Per-pair friction, all in pips so they are comparable across pairs. */
export interface ExecutionCost {
  readonly spreadPips: number;
  /** Round-trip commission expressed in pips. */
  readonly commissionPips: number;
  readonly slippagePips: number;
}

/** A version-stamped execution assumption set, reused by System and comparators. */
export interface ExecutionModel {
  /** Version-stamped identity so a result records which assumptions produced it. */
  readonly id: string;
  readonly entryReference: EntryReference;
  readonly perPairCost: Readonly<Record<Pair, ExecutionCost>>;
}

/** The resolved entry: the fill price and the date it is assumed on. */
export interface ResolvedEntry {
  readonly entryPrice: number;
  readonly entryDate: TradingDate;
}

/**
 * The default execution model. The per-pair costs are deliberately modest,
 * uniform placeholders (JPY pairs priced in their own pip unit); they are
 * configurable measurement inputs, not tuned signal parameters. The `id` is
 * version-stamped so a stored result is traceable to these exact assumptions.
 */
export const DEFAULT_EXECUTION_MODEL: ExecutionModel = {
  id: "exec-v1",
  entryReference: "next_session_open",
  perPairCost: {
    EURUSD: { spreadPips: 0.6, commissionPips: 0.2, slippagePips: 0.2 },
    GBPUSD: { spreadPips: 0.9, commissionPips: 0.2, slippagePips: 0.3 },
    USDJPY: { spreadPips: 0.7, commissionPips: 0.2, slippagePips: 0.2 },
    USDCHF: { spreadPips: 1.0, commissionPips: 0.2, slippagePips: 0.3 },
    USDCAD: { spreadPips: 1.0, commissionPips: 0.2, slippagePips: 0.3 },
  },
};

/** Total round-trip friction for a pair, in pips. */
export function totalCostPips(model: ExecutionModel, pair: Pair): number {
  const c = model.perPairCost[pair];
  return c.spreadPips + c.commissionPips + c.slippagePips;
}

/**
 * Resolve the assumed entry for a forecast: the OPEN of the first candle dated
 * STRICTLY AFTER `decisionDate` (R2.3) — the earliest bar a trader could have
 * acted on once the forecast was known. The forecast's own `decisionDate` candle
 * (the close it was computed from) is never used as the fill.
 *
 * Returns `null` when no candle exists strictly after the decision date (the
 * forecast is not yet actionable), so the caller can skip it rather than invent a
 * fill. Reads only the supplied candles; mutates nothing.
 */
export function resolveEntry(
  pair: Pair,
  decisionDate: TradingDate,
  candles: readonly Candle[],
): ResolvedEntry | null {
  let earliest: Candle | null = null;
  for (const candle of candles) {
    if (candle.asset !== pair) continue;
    if (candle.date <= decisionDate) continue; // strictly after the forecast (R2.3)
    if (earliest === null || candle.date < earliest.date) {
      earliest = candle;
    }
  }
  if (earliest === null) return null;
  return { entryPrice: earliest.open, entryDate: earliest.date };
}

/**
 * Apply the model's costs to a simulated outcome, returning the net-of-cost pips
 * alongside the retained gross (R2.2, R4.5). Costs reduce the magnitude of a win
 * and deepen a loss; an `ambiguous` outcome carries `grossPips === 0` and so is
 * reduced by the friction like any other (its win/loss status is undetermined and
 * handled as its own category by the ledger, not here).
 *
 * The net result moves the gross toward loss by exactly `totalCostPips`:
 *   net = gross − totalCost        (a trader always pays the friction).
 */
export function applyCosts(
  outcome: TradeOutcome,
  model: ExecutionModel,
  pair: Pair,
): { readonly netPips: number; readonly grossPips: number } {
  const cost = totalCostPips(model, pair);
  return { grossPips: outcome.grossPips, netPips: outcome.grossPips - cost };
}

/** Re-export for callers that want the pip helper alongside the model. */
export { toPips };
