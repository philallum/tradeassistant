// Per-strategy track record by deterministic replay.
//
// "How often was this strategy right lately?" answered WITHOUT persisting any new
// data: the four classical strategies (trend, breakout, range, reversal) are pure
// functions of candles, so their past calls can be reproduced exactly by running
// them again over each past date using ONLY the candles dated strictly before it.
//
// Conventions (deliberately identical to the analogue resolver in
// `src/retrieval/resolver.ts`, so a strategy's record is measured the way the
// pattern engine's outcomes are):
//   - signal at replay date R: candles strictly BEFORE R only;
//   - outcome: the first candle strictly AFTER R — entry = its open, terminal =
//     its close (horizon 1);
//   - realized direction: the SIGN of that session's open-to-close move (exactly
//     zero is FLAT). This deliberately matches how the resolver's outcomes behave
//     in practice: its FLAT dead-band compares a pip move with an ATR held in
//     PRICE units (`src/retrieval/resolver.ts` vs `src/ops/outcome-resolution/`),
//     which makes the band effectively zero, so stored analogue directions are
//     UP/DOWN by sign. Scoring by sign keeps every record here comparable with the
//     project's headline accuracy. A true 0.5 x ATR dead-band would call ~60% of
//     sessions FLAT (measured over 2020-2026 on the five pairs) and make every
//     record look far worse for the wrong reason. The band is a parameter
//     (`deadBandAtrFactor`, default 0) so that choice stays explicit.
//   - a "call" is a directional (UP/DOWN) signal; FLAT is an abstention and is not
//     counted. A call is right iff its direction equals the realized direction.
//
// Look-ahead safety: a replay date is admitted only when its forward candle exists
// in the supplied candles; the strategies' own `assertPastOnly` guard still
// applies on top. Pure and deterministic: no clock, I/O, randomness or LLM.

import { computeAtr14 } from "../confidence/atr.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { SnapshotStrategyRecordRow } from "../scheduled-run/snapshot.js";
import type { StrategyBundle } from "../strategies/confluenceMatrix.js";

/** The classical strategies that can be replayed from candles alone. */
export const REPLAYABLE_STRATEGY_IDS = ["trend", "breakout", "range", "reversal"] as const;
export type ReplayableStrategyId = (typeof REPLAYABLE_STRATEGY_IDS)[number];

/** Default replay window, in trading days (about three months). */
export const DEFAULT_TRACK_RECORD_LOOKBACK_DAYS = 60 as const;

type Direction = "UP" | "DOWN" | "FLAT";

/**
 * The realized direction of the session after `replayDate`, or null when there is
 * no forward candle. A move within `deadBandAtrFactor` x ATR_14 (both in PRICE
 * units, over candles dated on or before `replayDate`) is FLAT; the default factor
 * is 0, i.e. the sign of the open-to-close move (see the header for why).
 */
export function realizedDirectionAfter(
  candles: readonly Candle[],
  replayDate: TradingDate,
  deadBandAtrFactor = 0,
): Direction | null {
  const forward = candles.find((c) => c.date > replayDate);
  if (forward === undefined) return null;
  const move = forward.close - forward.open;
  if (deadBandAtrFactor > 0) {
    const upToDate = candles.filter((c) => c.date <= replayDate);
    if (upToDate.length > 0 && Math.abs(move) <= computeAtr14(upToDate) * deadBandAtrFactor) {
      return "FLAT";
    }
  }
  if (move === 0) return "FLAT";
  return move > 0 ? "UP" : "DOWN";
}

/** The pair's candles, ascending by date. */
export interface PairCandles {
  readonly pair: Pair;
  readonly candles: readonly Candle[];
}

export interface ReplayArgs {
  /** Today's Decision_Date: replay dates are strictly earlier, forward candles too. */
  readonly decisionDate: TradingDate;
  readonly lookbackDays: number;
  readonly inputs: readonly PairCandles[];
  readonly strategies: StrategyBundle;
}

/** Replay dates for a pair: the last `lookbackDays` candle dates that have a forward candle. */
export function replayDates(
  candles: readonly Candle[],
  decisionDate: TradingDate,
  lookbackDays: number,
): TradingDate[] {
  const dates = candles.map((c) => c.date).filter((d) => d < decisionDate);
  // The final date has no forward candle, so it can never be scored.
  const scorable = dates.slice(0, Math.max(0, dates.length - 1));
  return scorable.slice(-Math.max(0, lookbackDays));
}

/**
 * Replay the four classical strategies over the look-back window and count their
 * directional calls and hits per pair. Strategies that error on a date (e.g.
 * insufficient history) simply make no call that day.
 */
export function replayClassicalRecords(args: ReplayArgs): SnapshotStrategyRecordRow[] {
  const rows: SnapshotStrategyRecordRow[] = [];
  for (const { pair, candles } of args.inputs) {
    const dates = replayDates(candles, args.decisionDate, args.lookbackDays);
    const tally = new Map<ReplayableStrategyId, { calls: number; correct: number }>();
    for (const id of REPLAYABLE_STRATEGY_IDS) tally.set(id, { calls: 0, correct: 0 });

    for (const date of dates) {
      const realized = realizedDirectionAfter(candles, date);
      if (realized === null) continue;
      const past = candles.filter((c) => c.date < date);
      for (const id of REPLAYABLE_STRATEGY_IDS) {
        let direction: Direction | null = null;
        try {
          const result = args.strategies[id].evaluate(past, date);
          if (result.ok) direction = result.value.direction;
        } catch {
          direction = null;
        }
        if (direction === null || direction === "FLAT") continue; // abstention
        const t = tally.get(id)!;
        t.calls += 1;
        if (direction === realized) t.correct += 1;
      }
    }

    for (const id of REPLAYABLE_STRATEGY_IDS) {
      const t = tally.get(id)!;
      rows.push({ pair, strategyId: id, calls: t.calls, correct: t.correct });
    }
  }
  return rows;
}

/** The slice of a realized-outcome row the pattern record reads. */
export interface PatternOutcomeInput {
  readonly pair: string;
  readonly decision_date: string;
  readonly predicted_direction: Direction;
  readonly realized_direction: Direction | null;
  readonly matured: boolean;
}

/**
 * The pattern engine's record, taken from its own matured realized-outcome
 * journal (fired days only), restricted to the same look-back window.
 */
export function patternRecords(
  outcomes: readonly PatternOutcomeInput[],
  inputs: readonly PairCandles[],
  decisionDate: TradingDate,
  lookbackDays: number,
): SnapshotStrategyRecordRow[] {
  return inputs.map(({ pair, candles }) => {
    const dates = candles.map((c) => c.date).filter((d) => d < decisionDate);
    const earliest = dates.slice(-Math.max(0, lookbackDays))[0] ?? decisionDate;
    let calls = 0;
    let correct = 0;
    for (const o of outcomes) {
      if (o.pair !== pair || !o.matured || o.realized_direction === null) continue;
      if (o.predicted_direction === "FLAT") continue;
      if (o.decision_date < earliest || o.decision_date >= decisionDate) continue;
      calls += 1;
      if (o.predicted_direction === o.realized_direction) correct += 1;
    }
    return { pair, strategyId: "custom_pattern" as const, calls, correct };
  });
}
