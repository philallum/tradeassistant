// Trade_Simulation types — trader-edge-validation Stage B (task 3; design R1).
//
// The path-aware simulation replays ONE proposed trade against the ACTUAL
// forward candle path and classifies the outcome by WHICH level (stop or target)
// was touched first — the information the forward-outcome resolver discards when
// it takes independent MFE/MAE maxima. These are the shared shapes for that
// replay. Everything here is deterministic and LLM-free; nothing in this module
// feeds the live firing / scoring / confidence decision.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";

/**
 * The four mutually-exclusive outcomes of a path-aware replay (R1.1):
 *   - `target_first`  — Take_Profit was touched before Stop_Loss.
 *   - `stop_first`    — Stop_Loss was touched before Take_Profit.
 *   - `expired`       — neither level was touched by Horizon expiry.
 *   - `ambiguous`     — a SINGLE candle's range touched BOTH levels and the
 *                       intra-candle order is unknown (D1 data); never silently
 *                       resolved to the favourable fill (R1.2).
 */
export type TradeOutcomeKind = "target_first" | "stop_first" | "expired" | "ambiguous";

/**
 * A single proposed trade to replay. SL/TP are POSITIVE pip distances from the
 * entry (the direction decides which side of `entryPrice` each level sits on).
 * Only directional trades are simulated — a FLAT setup expresses no trade.
 */
export interface TradeProposal {
  readonly pair: Pair;
  readonly decisionDate: TradingDate;
  /** Directional view; a FLAT setup is never proposed as a trade. */
  readonly direction: Exclude<DirectionClass, "FLAT">;
  readonly horizon: 1 | 2 | 3;
  /** The assumed fill price (from the Execution_Model's `resolveEntry`). */
  readonly entryPrice: number;
  /** The assumed entry date (earliest realistic entry, strictly after the forecast). */
  readonly entryDate: TradingDate;
  /** Positive Stop_Loss distance in pips. */
  readonly stopLossPips: number;
  /** Positive Take_Profit distance in pips. */
  readonly takeProfitPips: number;
}

/**
 * The resolved outcome of a replay. `grossPips` is BEFORE Execution_Model costs
 * (the ledger applies costs in Stage C); it is `+takeProfitPips` for
 * `target_first`, `−stopLossPips` for `stop_first`, the signed close-to-close
 * move for `expired`, and `0` carried with `ambiguous` (never a win or loss).
 */
export interface TradeOutcome {
  readonly kind: TradeOutcomeKind;
  /** The date the stop/target was touched, or `null` for `expired` / `ambiguous`. */
  readonly resolvedOnDate: TradingDate | null;
  /** Realized pips before costs (see note above). */
  readonly grossPips: number;
  /** The same-candle collision date for an `ambiguous` outcome, else `null`. */
  readonly ambiguousCandleDate: TradingDate | null;
}

/**
 * The SINGLE seam for lower-timeframe disambiguation (R1.4). Given a candle on
 * which both levels were touched, a resolver MAY return the true order; absent
 * (the D1 default) the outcome stays `ambiguous` — "report, don't guess". This
 * spec does NOT source lower-timeframe data; the hook exists for a later one.
 */
export type IntraCandleResolver = (
  candleDate: TradingDate,
  pair: Pair,
) => "stop_first" | "target_first" | null;
