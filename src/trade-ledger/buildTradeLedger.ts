// Trade_Ledger builder — trader-edge-validation Stage C (task 4; design R3).
//
// Turns a window of eligible forecasts into deterministic ledger rows by, per
// forecast: resolve the assumed entry (Execution_Model, R2) → replay the trade
// against the actual forward candle path (Trade_Simulation, R1) → apply costs
// (R2) → emit ONE row. Suppressed (non-fired) forecasts are emitted with
// `fired: false` so the selection rule can be evaluated (R3.2); `ambiguous`
// outcomes are carried as their own category, never folded into win/loss (R3.5).
//
// Deterministic and reproducible from stored inputs + a stated Parameter_Set +
// Execution_Model (R3.3): the builder itself re-derives no signal — it consumes
// forecasts the caller already produced (the Stage D walk-forward harness / the
// Stage H ops entry regenerate them via the pipeline under a frozen set) and the
// candle path from the injected `CandleStore`. Pure wrt the live decision: a
// separate read-only consumer, LLM-free, touching no firing / scoring path.

import type { CandleStore } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import {
  applyCosts,
  resolveEntry,
  totalCostPips,
  type ExecutionModel,
} from "../trade-sim/executionModel.js";
import { simulateTrade } from "../trade-sim/tradeSimulation.js";
import type { IntraCandleResolver, TradeProposal } from "../trade-sim/types.js";
import type { TradeLedgerRow } from "./types.js";

/**
 * One eligible forecast to replay — the deterministic output of the pipeline for
 * a (pair, decisionDate), as the dashboard's firing decision saw it. `fired`
 * records whether it cleared the firing bar; a non-fired forecast is still
 * ledgered (R3.2). SL/TP are the empirical pip distances (null below the floor).
 */
export interface LedgerForecast {
  readonly strategyId: string;
  readonly pair: Pair;
  readonly decisionDate: TradingDate;
  readonly fired: boolean;
  readonly direction: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly earnedConfidence: number;
  readonly stopLossPips: number | null;
  readonly takeProfitPips: number | null;
}

/** Dependencies for {@link buildTradeLedger}. */
export interface BuildTradeLedgerDeps {
  readonly candleStore: CandleStore;
  readonly executionModel: ExecutionModel;
  /** Optional lower-timeframe disambiguation seam, threaded to the simulation (R1.4). */
  readonly intraCandleResolver?: IntraCandleResolver;
}

/**
 * Build a ledger row for ONE forecast. A row is always produced (so the
 * selection rule is evaluable), but a trade is only SIMULATED when the forecast
 * is actionable: it fired, is directional (not FLAT), has both SL and TP, and an
 * entry resolves. Otherwise the row records the forecast with a neutral
 * `expired`/zero outcome and `fired` preserved — it never invents a trade.
 */
async function buildRow(
  forecast: LedgerForecast,
  deps: BuildTradeLedgerDeps,
): Promise<TradeLedgerRow> {
  const costPips = totalCostPips(deps.executionModel, forecast.pair);

  // A non-actionable forecast (suppressed, FLAT, or missing boundaries) is
  // ledgered WITHOUT a simulated trade: zero pips, `expired`, no entry fill.
  const actionable =
    forecast.fired &&
    forecast.direction !== "FLAT" &&
    forecast.stopLossPips !== null &&
    forecast.takeProfitPips !== null;

  if (!actionable) {
    return {
      strategyId: forecast.strategyId,
      pair: forecast.pair,
      decisionDate: forecast.decisionDate,
      fired: forecast.fired,
      direction: forecast.direction,
      horizon: forecast.horizon,
      earnedConfidence: forecast.earnedConfidence,
      entryPrice: 0,
      entryDate: forecast.decisionDate,
      stopLossPips: forecast.stopLossPips,
      takeProfitPips: forecast.takeProfitPips,
      outcome: "expired",
      grossPips: 0,
      costPips: 0, // no trade taken ⇒ no friction paid
      netPips: 0,
      rMultiple: null,
    };
  }

  // Actionable: resolve the entry (earliest candle strictly after the forecast).
  const candles = await deps.candleStore.getCandles(forecast.pair);
  const entry = resolveEntry(forecast.pair, forecast.decisionDate, candles);

  if (entry === null) {
    // No tradeable entry yet (forecast not matured into an entry bar): ledger it
    // as a non-simulated row so the window stays complete and deterministic.
    return {
      strategyId: forecast.strategyId,
      pair: forecast.pair,
      decisionDate: forecast.decisionDate,
      fired: forecast.fired,
      direction: forecast.direction,
      horizon: forecast.horizon,
      earnedConfidence: forecast.earnedConfidence,
      entryPrice: 0,
      entryDate: forecast.decisionDate,
      stopLossPips: forecast.stopLossPips,
      takeProfitPips: forecast.takeProfitPips,
      outcome: "expired",
      grossPips: 0,
      costPips: 0,
      netPips: 0,
      rMultiple: null,
    };
  }

  const proposal: TradeProposal = {
    pair: forecast.pair,
    decisionDate: forecast.decisionDate,
    direction: forecast.direction,
    horizon: forecast.horizon,
    entryPrice: entry.entryPrice,
    entryDate: entry.entryDate,
    stopLossPips: forecast.stopLossPips,
    takeProfitPips: forecast.takeProfitPips,
  };

  const outcome = simulateTrade(proposal, candles, deps.intraCandleResolver);
  const { grossPips, netPips } = applyCosts(outcome, deps.executionModel, forecast.pair);

  // R-multiple: net result as a multiple of the risked distance (the stop).
  // `ambiguous` carries grossPips 0, so its R-multiple is the cost drag over the
  // stop — still well-defined and never a fabricated win/loss.
  const rMultiple = forecast.stopLossPips > 0 ? netPips / forecast.stopLossPips : null;

  return {
    strategyId: forecast.strategyId,
    pair: forecast.pair,
    decisionDate: forecast.decisionDate,
    fired: forecast.fired,
    direction: forecast.direction,
    horizon: forecast.horizon,
    earnedConfidence: forecast.earnedConfidence,
    entryPrice: entry.entryPrice,
    entryDate: entry.entryDate,
    stopLossPips: forecast.stopLossPips,
    takeProfitPips: forecast.takeProfitPips,
    outcome: outcome.kind,
    grossPips,
    costPips,
    netPips,
    rMultiple,
  };
}

/**
 * Build the Trade_Ledger over a window of forecasts. Produces ONE row per
 * forecast (R3.1), in the input order, deterministically. The caller supplies
 * the forecasts (already produced under a stated Parameter_Set) and the
 * Execution_Model; the builder re-implements no signal and takes no LLM input.
 */
export async function buildTradeLedger(
  forecasts: readonly LedgerForecast[],
  deps: BuildTradeLedgerDeps,
): Promise<readonly TradeLedgerRow[]> {
  const rows: TradeLedgerRow[] = [];
  for (const forecast of forecasts) {
    rows.push(await buildRow(forecast, deps));
  }
  return rows;
}
