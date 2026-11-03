// Unit tests for the Breakout strategy (Requirement 3; Design
// "Breakout (breakout.ts, Requirement 3)").
//
// These pin specific, hand-constructed examples for each branch of `evaluate`:
// an UP signal, a DOWN signal, a FLAT signal (close inside the channel), the
// insufficient-history guard, the zero-volatility case, the ATR-unavailable
// path (Requirement 3.10), and the look-ahead-safe channel construction that
// EXCLUDES the breakout candle from its own channel (Requirement 3.9).
// Property-level coverage lives in the companion property test (task 5.3);
// this file nails down exact directions and channel values.
//
// To keep the Donchian-channel math tractable by hand, the directional cases
// use a tiny config — channelPeriod 3 — so only four candles are required: the
// three channel candles plus the latest completed (breakout) candle. The
// expected strength is derived independently from the same shared ATR helper
// (`computeAtr14`, the exact distance / ATR the production code scales).

import { describe, expect, it } from "vitest";
import { createBreakoutStrategy } from "./breakout.js";
import { clamp01 } from "./indicators.js";
import { computeAtr14 } from "../confidence/atr.js";
import { addTradingDays } from "../guard/tradingDate.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { StrategySignal, StrategyError } from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** A weekday anchor used as the first candle date across the suite. */
const FIRST_DATE: TradingDate = "2015-01-01"; // a Thursday

/**
 * Build one OHLC candle. `open`/`high`/`low` default to `close` so a test only
 * overrides what it cares about; explicit OHLC is supplied for the channel and
 * zero-volatility cases.
 */
function candle(
  date: TradingDate,
  ohlc: Partial<Pick<Candle, "open" | "high" | "low" | "close">>,
  asset = "EURUSD",
): Candle {
  const close = ohlc.close ?? 1;
  return {
    asset,
    date,
    open: ohlc.open ?? close,
    high: ohlc.high ?? close,
    low: ohlc.low ?? close,
    close,
    ...ohlc,
  };
}

/**
 * Turn a list of OHLC specs into ascending-weekday-dated candles and return a
 * safe Decision_Date (the day AFTER the last candle).
 */
function seriesFrom(
  specs: readonly Partial<Pick<Candle, "open" | "high" | "low" | "close">>[],
): { candles: Candle[]; decisionDate: TradingDate } {
  const candles = specs.map((ohlc, i) =>
    candle(addTradingDays(FIRST_DATE, i), ohlc),
  );
  const lastDate = candles[candles.length - 1]!.date;
  return { candles, decisionDate: addTradingDays(lastDate, 1) };
}

/** Unwrap a successful StrategyResult, failing loudly otherwise. */
function expectSignal(
  result: { ok: true; value: StrategySignal } | { ok: false; error: StrategyError },
): StrategySignal {
  if (!result.ok) {
    throw new Error(`expected a signal, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Unwrap a successful strategy factory result, failing loudly otherwise. */
function breakoutWith(partial?: Parameters<typeof createBreakoutStrategy>[0]) {
  const made = createBreakoutStrategy(partial);
  if (!made.ok) {
    throw new Error(`expected a strategy, got config error: ${JSON.stringify(made.error)}`);
  }
  return made.value;
}

// --- UP (Requirement 3.2) ----------------------------------------------------

describe("createBreakoutStrategy — UP when the latest close clears the channel high (Req 3.2)", () => {
  it("emits UP with strength = clamp01(distance / atr) when close > channelHigh", () => {
    // channelPeriod 3: the channel comes from candles[0..2], each with
    // high 2.0 and low 1.0, so channelHigh = 2.0 and channelLow = 1.0. The
    // latest candle closes at 3.0 (> 2.0) -> UP. Breakout distance = 3.0 - 2.0
    // = 1.0.
    //
    // ATR_14 over all four candles:
    //   TR[0] = high-low = 2.0 - 1.0 = 1.0
    //   TR[1] = max(1.0, |2.0-1.5|, |1.0-1.5|) = 1.0   (prevClose = 1.5)
    //   TR[2] = max(1.0, |2.0-1.5|, |1.0-1.5|) = 1.0   (prevClose = 1.5)
    //   TR[3] = max(0.0, |3.0-1.5|, |3.0-1.5|) = 1.5   (prevClose = 1.5)
    //   ATR   = (1.0 + 1.0 + 1.0 + 1.5) / 4 = 4.5 / 4 = 1.125
    //   strength = clamp01(1.0 / 1.125) = 0.8888...
    const { candles, decisionDate } = seriesFrom([
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 3, high: 3, low: 3, close: 3 },
    ]);
    const strategy = breakoutWith({ channelPeriod: 3 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.strategyId).toBe("breakout");
    expect(signal.direction).toBe("UP");
    // Independent oracle: distance / ATR over the same series.
    expect(signal.strength).toBeCloseTo(clamp01(1 / computeAtr14(candles)), 10);
    // Fully hand-computed: 1.0 / 1.125.
    expect(signal.strength).toBeCloseTo(1 / 1.125, 10);
    expect(signal.rationale).toContain("channelHigh(3)=2");
    expect(signal.rationale).toContain("channelLow(3)=1");
    expect(signal.rationale).toContain("close=3");
    expect(signal.rationale).toContain("UP");
  });
});

// --- DOWN (Requirement 3.3) --------------------------------------------------

describe("createBreakoutStrategy — DOWN when the latest close breaks the channel low (Req 3.3)", () => {
  it("emits DOWN with strength = clamp01(distance / atr) when close < channelLow", () => {
    // Mirror of the UP case. Channel from candles[0..2]: high 4.0, low 3.0, so
    // channelLow = 3.0. The latest candle closes at 2.0 (< 3.0) -> DOWN.
    // Breakout distance = channelLow - close = 3.0 - 2.0 = 1.0.
    //
    // ATR_14 over all four candles:
    //   TR[0] = 4.0 - 3.0 = 1.0
    //   TR[1] = max(1.0, |4.0-3.5|, |3.0-3.5|) = 1.0   (prevClose = 3.5)
    //   TR[2] = max(1.0, |4.0-3.5|, |3.0-3.5|) = 1.0   (prevClose = 3.5)
    //   TR[3] = max(0.0, |2.0-3.5|, |2.0-3.5|) = 1.5   (prevClose = 3.5)
    //   ATR   = 4.5 / 4 = 1.125
    //   strength = clamp01(1.0 / 1.125) = 0.8888...
    const { candles, decisionDate } = seriesFrom([
      { open: 3.5, high: 4, low: 3, close: 3.5 },
      { open: 3.5, high: 4, low: 3, close: 3.5 },
      { open: 3.5, high: 4, low: 3, close: 3.5 },
      { open: 2, high: 2, low: 2, close: 2 },
    ]);
    const strategy = breakoutWith({ channelPeriod: 3 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBeCloseTo(clamp01(1 / computeAtr14(candles)), 10);
    expect(signal.strength).toBeCloseTo(1 / 1.125, 10);
    expect(signal.rationale).toContain("DOWN");
  });
});

// --- FLAT: close inside the channel (Requirement 3.4) ------------------------

describe("createBreakoutStrategy — FLAT when the latest close stays inside the channel (Req 3.4)", () => {
  it("emits FLAT with strength 0 when channelLow <= close <= channelHigh", () => {
    // Channel from candles[0..2]: high 2.0, low 1.0. The latest candle closes
    // at 1.5 — strictly inside the channel — so neither the UP (close > high)
    // nor the DOWN (close < low) condition holds -> FLAT.
    const { candles, decisionDate } = seriesFrom([
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 1.6, low: 1.4, close: 1.5 },
    ]);
    const strategy = breakoutWith({ channelPeriod: 3 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("FLAT");
  });
});

// --- Channel excludes the breakout candle (Requirement 3.9) ------------------

describe("createBreakoutStrategy — the breakout candle never defines its own channel (Req 3.9)", () => {
  it("builds the channel only from the N candles before the latest, not the latest itself", () => {
    // Channel candles[0..2] have high 2.0, low 1.0. The latest candle closes at
    // 3.0 and ALSO has an extreme high of 3.0 and low of 0.5. If the latest
    // candle were (wrongly) included in the channel window, channelHigh would
    // become 3.0 and the close (3.0) would NOT be strictly above it, giving
    // FLAT. Because the latest candle is excluded, channelHigh stays 2.0, the
    // close clears it, and the direction is UP.
    const { candles, decisionDate } = seriesFrom([
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 1.5, high: 2, low: 1, close: 1.5 },
      { open: 2, high: 3, low: 0.5, close: 3 },
    ]);
    const strategy = breakoutWith({ channelPeriod: 3 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    // Channel values come only from candles[0..2]: high 2.0, low 1.0. The
    // latest candle's own 3.0 high and 0.5 low do not appear.
    expect(signal.rationale).toContain("channelHigh(3)=2");
    expect(signal.rationale).toContain("channelLow(3)=1");
    expect(signal.rationale).not.toContain("channelHigh(3)=3");
    expect(signal.rationale).not.toContain("channelLow(3)=0.5");
    // Excluding the latest candle, 3.0 > channelHigh 2.0 -> UP (not FLAT).
    expect(signal.direction).toBe("UP");
  });
});

// --- Insufficient history (Requirement 3.8) ----------------------------------

describe("createBreakoutStrategy — insufficient history (Req 3.8)", () => {
  it("returns FLAT, strength 0, 'insufficient history' with exactly 20 candles under the default period", () => {
    // Default channelPeriod 20 needs N + 1 = 21 candles (20 channel candles
    // plus the latest). Exactly 20 is one short, so the history guard fires
    // before any channel/ATR work.
    const specs = Array.from({ length: 20 }, (_, i) => {
      const close = 1 + i * 0.01;
      return { open: close, high: close + 0.5, low: close - 0.5, close };
    });
    const { candles, decisionDate } = seriesFrom(specs);
    const strategy = breakoutWith(); // default channelPeriod 20

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("insufficient history");
  });
});

// --- Zero volatility (Requirement 3.4) ---------------------------------------

describe("createBreakoutStrategy — zero volatility yields FLAT (Req 3.4)", () => {
  it("returns FLAT, strength 0 when every OHLC value is identical", () => {
    // Identical OHLC across enough candles to clear the history guard. The
    // channel collapses to channelHigh = channelLow = the common price, and the
    // latest close equals both, so it sits inside (at the edge of) the channel:
    // neither close > high nor close < low holds -> FLAT. The ATR-usability
    // check is never reached because a FLAT direction short-circuits first.
    const specs = Array.from({ length: 4 }, () => ({
      open: 1.25,
      high: 1.25,
      low: 1.25,
      close: 1.25,
    }));
    const { candles, decisionDate } = seriesFrom(specs);
    const strategy = breakoutWith({ channelPeriod: 3 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("FLAT");
  });
});

// --- ATR unavailable with a detected breakout (Requirement 3.10) -------------

describe("createBreakoutStrategy — ATR unavailable keeps the direction with strength 0 (Req 3.10)", () => {
  it("returns the detected direction, strength 0, and 'ATR unavailable' when ATR is zero", () => {
    // Construct a genuine UP breakout whose candle series has zero True Range,
    // so ATR_14 = 0 and cannot scale strength. Every candle has
    // high == low == the PREVIOUS candle's close, making each True Range term
    //   high-low = 0, |high-prevClose| = 0, |low-prevClose| = 0
    // zero. The channel (candles[0..2]) then has high == low == 1.0, and the
    // latest candle closes at 2.0 (> 1.0) -> UP is detected, but because ATR is
    // unusable the strength stays 0 and the rationale reports it.
    const prices = [1, 1, 1, 2];
    const candles: Candle[] = prices.map((close, i) => {
      const flatPrice = i === 0 ? close : (prices[i - 1] as number);
      return candle(addTradingDays(FIRST_DATE, i), {
        open: flatPrice,
        high: flatPrice,
        low: flatPrice,
        close,
      });
    });
    const decisionDate = addTradingDays(candles[candles.length - 1]!.date, 1);
    const strategy = breakoutWith({ channelPeriod: 3 });

    // Confirm the premise: ATR is 0 over this prepared series.
    expect(computeAtr14(candles)).toBe(0);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("ATR unavailable");
  });
});
