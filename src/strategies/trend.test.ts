// Unit tests for the Trend Following strategy (Requirement 2; Design
// "Trend (trend.ts, Requirement 2)").
//
// These pin specific, hand-computable examples for each branch of `evaluate`:
// an UP signal, a DOWN signal, a FLAT signal (direction/slope disagreement),
// the insufficient-history guard, the zero-volatility / ATR-unavailable path,
// and every invalid-configuration case. Property-level coverage lives in the
// companion property test (task 4.3); this file nails down exact numbers.
//
// To keep the EMA and ATR math tractable by hand, the directional cases use a
// tiny config — fastPeriod 2, slowPeriod 3, slopeWindow 1 — so only four
// candles are required. The expected strength is derived independently from the
// same shared helpers (`emaSeries`, `clamp01`, `computeAtr14`), and the UP case
// additionally carries a fully hand-computed oracle with hardcoded numbers.

import { describe, expect, it } from "vitest";
import { createTrendStrategy } from "./trend.js";
import { emaSeries, clamp01 } from "./indicators.js";
import { computeAtr14 } from "../confidence/atr.js";
import { addTradingDays } from "../guard/tradingDate.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { StrategySignal, StrategyError } from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** A weekday anchor used as the first candle date across the suite. */
const FIRST_DATE: TradingDate = "2015-01-01"; // a Thursday

/**
 * Build one OHLC candle. `open`/`high`/`low` default around `close` so a test
 * only overrides what it cares about; explicit OHLC can be supplied for the
 * zero-volatility / ATR cases.
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
 * Turn a list of closes into ascending-weekday-dated candles. Each candle gets
 * a symmetric high/low band of `band` around its close so True Range is
 * non-zero (an ATR is available). Returns the candles and the day AFTER the
 * last candle as a safe Decision_Date.
 */
function seriesFromCloses(
  closes: readonly number[],
  band = 0.5,
): { candles: Candle[]; decisionDate: TradingDate } {
  const candles = closes.map((close, i) =>
    candle(addTradingDays(FIRST_DATE, i), {
      open: close,
      high: close + band,
      low: close - band,
      close,
    }),
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
function trendWith(partial?: Parameters<typeof createTrendStrategy>[0]) {
  const made = createTrendStrategy(partial);
  if (!made.ok) {
    throw new Error(`expected a strategy, got config error: ${JSON.stringify(made.error)}`);
  }
  return made.value;
}

/**
 * Independent oracle for the expected strength of a directional signal: the EMA
 * gap scaled by ATR, clamped to [0, 1]. Built from the same shared helpers the
 * production code uses, computed here from scratch over the candle series.
 */
function expectedStrength(
  candles: readonly Candle[],
  fastPeriod: number,
  slowPeriod: number,
): number {
  const closes = candles.map((c) => c.close);
  const L = closes.length - 1;
  const fast = emaSeries(closes, fastPeriod)[L] as number;
  const slow = emaSeries(closes, slowPeriod)[L] as number;
  const atr = computeAtr14(candles);
  return clamp01(Math.abs(fast - slow) / atr);
}

// --- UP (Requirement 2.2) ----------------------------------------------------

describe("createTrendStrategy — UP when EMA gap and slope both point up (Req 2.2)", () => {
  it("emits UP with strength = clamp01(|diff| / atr) for a rising close series", () => {
    // Ascending closes: fastEMA leads slowEMA (diff > 0) and the fast EMA rises
    // over the one-candle slope window (slope > 0), so direction is UP.
    const { candles, decisionDate } = seriesFromCloses([1, 2, 3, 4, 5]);
    const strategy = trendWith({ fastPeriod: 2, slowPeriod: 3, slopeWindow: 1 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.strategyId).toBe("trend");
    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBeCloseTo(
      expectedStrength(candles, 2, 3),
      10,
    );
    expect(signal.strength).toBeGreaterThan(0);
  });

  it("matches a fully hand-computed oracle (closes 1..5, fast 2 / slow 3)", () => {
    // Hand computation for closes = [1, 2, 3, 4, 5], band 0.5 (high/low = ±0.5):
    //
    // fastEMA(period 2, alpha = 2/3):
    //   seed[1] = sma([1,2]) = 1.5
    //   ema[2]  = 2/3*3 + 1/3*1.5          = 2.5
    //   ema[3]  = 2/3*4 + 1/3*2.5          = 3.5
    //   ema[4]  = 2/3*5 + 1/3*3.5          = 4.5
    // slowEMA(period 3, alpha = 1/2):
    //   seed[2] = sma([1,2,3]) = 2
    //   ema[3]  = 1/2*4 + 1/2*2            = 3
    //   ema[4]  = 1/2*5 + 1/2*3            = 4
    //   diff    = fast[4] - slow[4]        = 4.5 - 4 = 0.5
    //   slope   = fast[4] - fast[3]        = 4.5 - 3.5 = 1 (> 0, confirms UP)
    //
    // ATR_14: TR of the first candle = high-low = 1.0. For every later candle,
    //   high = close+0.5, low = close-0.5, prevClose = close-1, so
    //   TR = max(1.0, |close+0.5-(close-1)|, |close-0.5-(close-1)|)
    //      = max(1.0, 1.5, 0.5) = 1.5.
    //   Over 5 candles: mean = (1.0 + 1.5*4) / 5 = 7/5 = 1.4.
    //
    //   strength = clamp01(|0.5| / 1.4) = 0.5 / 1.4 = 0.3571428...
    const { candles, decisionDate } = seriesFromCloses([1, 2, 3, 4, 5]);
    const strategy = trendWith({ fastPeriod: 2, slowPeriod: 3, slopeWindow: 1 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBeCloseTo(0.5 / 1.4, 10);
  });
});

// --- DOWN (Requirement 2.3) --------------------------------------------------

describe("createTrendStrategy — DOWN when EMA gap and slope both point down (Req 2.3)", () => {
  it("emits DOWN with strength = clamp01(|diff| / atr) for a falling close series", () => {
    // Descending closes mirror the UP case: fastEMA trails slowEMA (diff < 0)
    // and the fast EMA falls over the slope window (slope < 0) -> DOWN.
    const { candles, decisionDate } = seriesFromCloses([5, 4, 3, 2, 1]);
    const strategy = trendWith({ fastPeriod: 2, slowPeriod: 3, slopeWindow: 1 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBeCloseTo(
      expectedStrength(candles, 2, 3),
      10,
    );
    // By symmetry with the UP oracle: |diff| = 0.5, ATR = 1.4.
    expect(signal.strength).toBeCloseTo(0.5 / 1.4, 10);
  });
});

// --- FLAT: direction / slope disagreement (Requirement 2.4) ------------------

describe("createTrendStrategy — FLAT when gap and slope disagree in sign (Req 2.4)", () => {
  it("emits FLAT with strength 0 when the EMA gap is positive but the slope turns down", () => {
    // Closes climb to 7 then dip to 5 on the last candle. After a sustained climb the fast
    // EMA still sits above the slow EMA (diff > 0), but the one-candle slope of
    // the fast EMA turns negative on the final down-tick (slope < 0). Gap says
    // "up", slope says "down" -> neither UP nor DOWN condition holds -> FLAT.
    const { candles, decisionDate } = seriesFromCloses([1, 3, 5, 7, 5]);
    const strategy = trendWith({ fastPeriod: 2, slowPeriod: 3, slopeWindow: 1 });

    // Sanity-check the premise with the shared helpers: diff > 0, slope < 0.
    const closes = candles.map((c) => c.close);
    const L = closes.length - 1;
    const fastSeries = emaSeries(closes, 2);
    const diff = (fastSeries[L] as number) - (emaSeries(closes, 3)[L] as number);
    const slope = (fastSeries[L] as number) - (fastSeries[L - 1] as number);
    expect(diff).toBeGreaterThan(0);
    expect(slope).toBeLessThan(0);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
  });
});

// --- Insufficient history (Requirement 2.9) ----------------------------------

describe("createTrendStrategy — insufficient history (Req 2.9)", () => {
  it("returns FLAT, strength 0, and 'insufficient history' with 54 candles under the defaults", () => {
    // Defaults require slowPeriod(50) + slopeWindow(5) = 55 candles; 54 is one
    // short, so the history guard fires before any EMA/ATR work.
    const closes = Array.from({ length: 54 }, (_, i) => 1 + i * 0.01);
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = trendWith(); // default 20 / 50 / 5

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("insufficient history");
  });
});

// --- Zero volatility -> ATR unavailable (Requirement 2.8) --------------------

describe("createTrendStrategy — zero volatility yields ATR unavailable (Req 2.8)", () => {
  it("returns FLAT, strength 0, and 'ATR unavailable' when every OHLC value is identical", () => {
    // Identical OHLC across enough candles to clear the history guard. True
    // Range is 0 for every candle, so ATR_14 = 0 and the ATR-usability check
    // forces FLAT. (Diff and slope are also 0 here, but the ATR check runs
    // after the EMA computation and owns the rationale wording.)
    const closes = Array.from({ length: 4 }, () => 1.25);
    const candles = closes.map((close, i) =>
      candle(addTradingDays(FIRST_DATE, i), {
        open: close,
        high: close,
        low: close,
        close,
      }),
    );
    const decisionDate = addTradingDays(candles[candles.length - 1]!.date, 1);
    const strategy = trendWith({ fastPeriod: 2, slowPeriod: 3, slopeWindow: 1 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("ATR unavailable");
  });
});

// --- ATR unavailable with a moving close (Requirement 2.8) -------------------

describe("createTrendStrategy — ATR unavailable with sufficient history (Req 2.8)", () => {
  it("returns FLAT, strength 0, 'ATR unavailable' when true range is zero despite changing closes", () => {
    // Construct zero true range while the closes still move: every candle has
    // high == low == the PREVIOUS candle's close, so each True Range term
    //   high-low = 0, |high-prevClose| = 0, |low-prevClose| = 0
    // is 0 and ATR_14 collapses to 0 — yet the close series is strictly
    // increasing, so the direction logic would otherwise have fired. The ATR
    // guard must win.
    const closes = [1, 2, 3, 4, 5];
    const candles: Candle[] = closes.map((close, i) => {
      const flatPrice = i === 0 ? close : (closes[i - 1] as number);
      return candle(addTradingDays(FIRST_DATE, i), {
        open: flatPrice,
        high: flatPrice,
        low: flatPrice,
        close,
      });
    });
    const decisionDate = addTradingDays(candles[candles.length - 1]!.date, 1);
    const strategy = trendWith({ fastPeriod: 2, slowPeriod: 3, slopeWindow: 1 });

    // Confirm the premise: ATR is 0 over this prepared series.
    expect(computeAtr14(candles)).toBe(0);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("ATR unavailable");
  });
});

// --- Invalid configuration (Requirement 2.11) --------------------------------

describe("createTrendStrategy — invalid configuration is rejected (Req 2.11)", () => {
  it("rejects a non-integer fastPeriod, naming 'fastPeriod'", () => {
    const made = createTrendStrategy({ fastPeriod: 2.5 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("fastPeriod");
  });

  it("rejects a fastPeriod below 1, naming 'fastPeriod'", () => {
    const made = createTrendStrategy({ fastPeriod: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("fastPeriod");
  });

  it("rejects fastPeriod >= slowPeriod, naming 'fastPeriod'", () => {
    const made = createTrendStrategy({ fastPeriod: 50, slowPeriod: 50 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("fastPeriod");
  });

  it("rejects a non-integer slopeWindow, naming 'slopeWindow'", () => {
    const made = createTrendStrategy({ slopeWindow: 1.5 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("slopeWindow");
  });

  it("rejects a zero slopeWindow, naming 'slopeWindow'", () => {
    const made = createTrendStrategy({ slopeWindow: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("slopeWindow");
  });
});
