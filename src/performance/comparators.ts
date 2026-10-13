// Comparator_Strategies — trader-edge-validation Stage D (task 10; design R5).
//
// A comparator is a `ForecastSource`: given the SAME set of forecast timestamps
// the system produced (one per (pair, decisionDate)), it emits its own
// `{ direction, horizon, SL, TP }` for each. Every strategy — the system and
// every comparator — then runs through the IDENTICAL `buildTradeLedger` +
// `ExecutionModel` + entry/exit rules (R5.1, R5.3, R5.5), so the only thing that
// varies is the forecast itself, never the measurement machinery. That is the
// fairness guarantee: a differing Execution_Model or entry timing would make the
// comparison meaningless.
//
// `compareStrategies` places each strategy's `PerformanceSummary` side by side on
// identical timestamps and states plainly when the system does NOT beat the
// comparators net of costs (R5.4, R12.6) — a negative result is a valid outcome,
// surfaced, never grounds for adding complexity.
//
// Pure, deterministic, LLM-free. A read-only consumer: nothing here feeds the
// live firing / scoring decision.

import type { Candle } from "../guard/types.js";
import type { CandleStore, Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { predictBaseline } from "../baseline/baseline.js";
import { computeAtr14 } from "../confidence/atr.js";
import { toPips } from "../trade-sim/pip.js";
import {
  buildTradeLedger,
  type BuildTradeLedgerDeps,
  type LedgerForecast,
} from "../trade-ledger/buildTradeLedger.js";
import { summarize, type PerformanceSummary } from "./metrics.js";

/**
 * The system's forecast at one timestamp, as the dashboard's firing decision
 * produced it. This is the SHARED set of timestamps + the system's own
 * `{ direction, horizon, SL, TP }`; a comparator reuses the timestamps (and, by
 * default, the already-derived SL/TP so risk/exit assumptions stay identical)
 * while substituting its own directional view (R5.1, R5.3).
 */
export interface SystemForecast {
  readonly pair: Pair;
  readonly decisionDate: TradingDate;
  readonly fired: boolean;
  readonly direction: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly earnedConfidence: number;
  readonly stopLossPips: number | null;
  readonly takeProfitPips: number | null;
}

/**
 * A forecast producer. Given the system's forecasts and the candle history (for
 * the comparators that read price), it emits one `LedgerForecast` per input
 * timestamp under its own `strategyId`. The returned shape is EXACTLY the
 * ledger's input shape so the SAME `buildTradeLedger` consumes every strategy
 * identically (R5.1).
 */
export interface ForecastSource {
  readonly strategyId: string;
  produce(
    systemForecasts: readonly SystemForecast[],
    candleStore: CandleStore,
  ): Promise<readonly LedgerForecast[]>;
}

/** The system itself as a trivial `ForecastSource` — passes its forecasts through verbatim. */
export const SYSTEM_STRATEGY_ID = "system" as const;

export function systemForecastSource(
  strategyId: string = SYSTEM_STRATEGY_ID,
): ForecastSource {
  return {
    strategyId,
    produce: (systemForecasts) =>
      Promise.resolve(
        systemForecasts.map((f) => ({
          strategyId,
          pair: f.pair,
          decisionDate: f.decisionDate,
          fired: f.fired,
          direction: f.direction,
          horizon: f.horizon,
          earnedConfidence: f.earnedConfidence,
          stopLossPips: f.stopLossPips,
          takeProfitPips: f.takeProfitPips,
        })),
      ),
  };
}

/** The trailing candles STRICTLY BEFORE a decision date, chronological. */
function priorCandles(
  all: readonly Candle[],
  pair: Pair,
  decisionDate: TradingDate,
): Candle[] {
  return all
    .filter((c) => c.asset === pair && c.date < decisionDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A comparator fires on the same timestamps and reuses the SAME SL/TP and
 * horizon the system used (so risk and exit assumptions are identical — R5.3),
 * substituting only its own `direction`. `fired` and SL/TP-nullness are kept
 * from the system so a timestamp the system could not actionably trade is not
 * actionably traded by the comparator either; the comparison stays like-for-like.
 */
function withDirection(
  f: SystemForecast,
  strategyId: string,
  direction: DirectionClass,
): LedgerForecast {
  return {
    strategyId,
    pair: f.pair,
    decisionDate: f.decisionDate,
    fired: f.fired,
    direction,
    horizon: f.horizon,
    earnedConfidence: f.earnedConfidence,
    stopLossPips: f.stopLossPips,
    takeProfitPips: f.takeProfitPips,
  };
}

/**
 * `trendContinuation` — direction = Weekly_Trend_Sign over the trailing window
 * (reuses `predictBaseline` / `weeklyTrendSign` from `src/baseline`), SL/TP and
 * horizon reused from the system so only the directional call differs (R5.1).
 * The baseline never emits FLAT, so this comparator always takes a directional
 * side on a timestamp the system actionably traded.
 */
export function trendContinuationSource(
  strategyId = "trendContinuation",
): ForecastSource {
  return {
    strategyId,
    produce: async (systemForecasts, candleStore) => {
      const out: LedgerForecast[] = [];
      for (const f of systemForecasts) {
        const all = await candleStore.getCandles(f.pair);
        const window = priorCandles(all, f.pair, f.decisionDate);
        // predictBaseline throws on look-ahead; the window is already past-only.
        const direction: DirectionClass =
          window.length === 0 ? "FLAT" : predictBaseline(window, f.decisionDate);
        out.push(withDirection(f, strategyId, direction));
      }
      return out;
    },
  };
}

/**
 * `returnsVolatility` — direction from the sign of the most recent close-to-close
 * return; a FLAT when the move is negligible relative to ATR_14 (the recent
 * volatility, reusing `computeAtr14` from `src/confidence/atr.ts`). The system's
 * SL/TP/horizon are reused so the comparison stays like-for-like on risk (R5.3);
 * ATR here informs the DIRECTIONAL dead-band only, not the exit levels.
 */
export function returnsVolatilitySource(
  strategyId = "returnsVolatility",
): ForecastSource {
  return {
    strategyId,
    produce: async (systemForecasts, candleStore) => {
      const out: LedgerForecast[] = [];
      for (const f of systemForecasts) {
        const all = await candleStore.getCandles(f.pair);
        const window = priorCandles(all, f.pair, f.decisionDate);
        out.push(withDirection(f, strategyId, directionFromReturns(window, f.pair)));
      }
      return out;
    },
  };
}

/**
 * Direction from the last close-to-close return, with an ATR_14-scaled FLAT
 * dead-band (mirroring the live classifier's "negligible move ⇒ FLAT" rule so
 * the comparator is a fair volatility-aware reference, not a biased always-on
 * one). Pips keep the move and the band in the same unit.
 */
function directionFromReturns(window: readonly Candle[], pair: Pair): DirectionClass {
  if (window.length < 2) return "FLAT";
  const last = window[window.length - 1]!;
  const prev = window[window.length - 2]!;
  const movePips = toPips(last.close - prev.close, pair);
  const signedMove = last.close - prev.close >= 0 ? movePips : -movePips;
  const atrPips = toPips(computeAtr14(window), pair);
  // Half-ATR dead-band, consistent with FLAT_DEAD_BAND_FACTOR = 0.5.
  const band = atrPips * 0.5;
  if (Math.abs(signedMove) <= band) return "FLAT";
  return signedMove > 0 ? "UP" : "DOWN";
}

/**
 * Optional labelled `directionalCoinflip` reference (R5.2): a DETERMINISTIC
 * pseudo-random directional-only call seeded by (pair, decisionDate) so it is
 * reproducible, carrying no risk edge. Labelled explicitly so no reader mistakes
 * it for a real strategy; it exists only to anchor "a directional-only guess"
 * on the same machinery.
 */
export function directionalCoinflipSource(
  strategyId = "directionalCoinflip",
): ForecastSource {
  return {
    strategyId,
    produce: (systemForecasts) =>
      Promise.resolve(
        systemForecasts.map((f) =>
          withDirection(f, strategyId, coinflip(f.pair, f.decisionDate)),
        ),
      ),
  };
}

/** A deterministic, seed-reproducible UP/DOWN from a (pair, date) key (R5.2). */
function coinflip(pair: Pair, decisionDate: TradingDate): DirectionClass {
  const key = `${pair}|${decisionDate}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? "UP" : "DOWN";
}

/** One strategy's result in a side-by-side comparison. */
export interface StrategyResult {
  readonly strategyId: string;
  readonly summary: PerformanceSummary;
}

/** The side-by-side comparison of the system against its comparators (R5.4). */
export interface ComparisonReport {
  /** Every strategy's summary, system first, on IDENTICAL timestamps. */
  readonly results: readonly StrategyResult[];
  /** The system's net expectancy (pips) — the headline figure compared. */
  readonly systemNetExpectancyPips: number;
  /**
   * True iff the system's net expectancy strictly exceeds EVERY comparator's net
   * of costs. False is a VALID, plainly-stated outcome (R5.4, R12.6).
   */
  readonly systemBeatsComparators: boolean;
  /** Human-readable comparators the system failed to beat (empty ⇒ it beat all). */
  readonly notBeaten: readonly string[];
}

/**
 * Run every `ForecastSource` through the IDENTICAL ledger machinery on the SAME
 * forecast timestamps and place the results side by side (R5.1, R5.3, R5.4,
 * R5.5). The `deps` (candle store + Execution_Model + optional intra-candle
 * resolver) are shared by EVERY strategy, which is what guarantees fairness — a
 * single Execution_Model and entry timing for all (R5.5).
 *
 * @param systemForecasts The shared set of forecast timestamps (the system's own
 *                        forecasts); the system strategy passes them through, the
 *                        comparators substitute their directional view.
 * @param comparators     The comparator sources to measure against the system.
 * @param deps            The SHARED ledger deps (identical for every strategy).
 */
export async function compareStrategies(
  systemForecasts: readonly SystemForecast[],
  comparators: readonly ForecastSource[],
  deps: BuildTradeLedgerDeps,
): Promise<ComparisonReport> {
  const sources: readonly ForecastSource[] = [systemForecastSource(), ...comparators];

  const results: StrategyResult[] = [];
  for (const source of sources) {
    const forecasts = await source.produce(systemForecasts, deps.candleStore);
    const rows = await buildTradeLedger(forecasts, deps);
    results.push({ strategyId: source.strategyId, summary: summarize(rows, source.strategyId) });
  }

  const system = results[0]!;
  const systemNet = system.summary.netExpectancyPips;
  const notBeaten = results
    .slice(1)
    .filter((r) => r.summary.netExpectancyPips >= systemNet)
    .map((r) => r.strategyId);

  return {
    results,
    systemNetExpectancyPips: systemNet,
    systemBeatsComparators: notBeaten.length === 0,
    notBeaten,
  };
}

/** The default comparator set: trend-continuation + returns/volatility (R5.1). */
export function defaultComparators(): readonly ForecastSource[] {
  return [trendContinuationSource(), returnsVolatilitySource()];
}
