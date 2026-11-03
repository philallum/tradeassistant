// Unit tests for the Reversal / Exhaustion strategy (Requirement 5; Design
// "Reversal (reversal.ts, Requirement 5)").
//
// These pin specific, hand-computable examples for each branch of `evaluate`:
// an UP signal (over-extended sell-off with fading negative momentum), a DOWN
// signal (over-extended rally with fading positive momentum), a plain FLAT
// signal (extension within the threshold), the exhaustion-absent FLAT (extreme
// extension but momentum NOT fading), the insufficient-history guard (25
// candles under the defaults), the zero-volatility / zero-ATR path (identical
// OHLC), and every invalid-configuration case (where NO candle is ever
// evaluated). Property-level coverage lives in the companion property test
// (task 7.3); this file nails down exact directions, strengths, and the two
// DISTINCT short-circuit rationales.
//
// To keep the Baseline_MA / extension / ROC math tractable by hand, the
// directional cases use a tiny config — extensionThreshold 2, baselinePeriod 3,
// momentumWindow 1 — so only five candles are required (baselinePeriod + 2 *
// momentumWindow). Each directional candle is built FLAT intraday (open = high
// = low = close), which makes True Range equal to the absolute close-to-close
// move for every candle after the first and 0 for the first, so ATR_14 is the
// simple mean of the absolute close deltas and is fully hand-computable.

import { describe, expect, it } from "vitest";
import {
  createReversalStrategy,
  DEFAULT_REVERSAL_CONFIG,
} from "./reversal.js";
import { sma, clamp01 } from "./indicators.js";
import { computeAtr14 } from "../confidence/atr.js";
import { addTradingDays } from "../guard/tradingDate.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { StrategySignal, StrategyError } from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** A weekday anchor used as the first candle date across the suite. */
const FIRST_DATE: TradingDate = "2015-01-01"; // a Thursday

/**
 * Build one OHLC candle. `open`/`high`/`low` default to `close` so a test only
 * overrides what it cares about; explicit OHLC can be supplied for the
 * zero-volatility / plain-FLAT cases.
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
 * Turn a list of closes into ascending-weekday-dated candles with FLAT intraday
 * ranges (open = high = low = close). With no intraday range, True Range is the
 * absolute close-to-close move, so ATR is easy to compute by hand. Returns the
 * candles and the day AFTER the last candle as a safe Decision_Date.
 */
function seriesFromCloses(
  closes: readonly number[],
): { candles: Candle[]; decisionDate: TradingDate } {
  const candles = closes.map((close, i) =>
    candle(addTradingDays(FIRST_DATE, i), {
      open: close,
      high: close,
      low: close,
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
function reversalWith(partial?: Parameters<typeof createReversalStrategy>[0]) {
  const made = createReversalStrategy(partial);
  if (!made.ok) {
    throw new Error(`expected a strategy, got config error: ${JSON.stringify(made.error)}`);
  }
  return made.value;
}

/**
 * Independent oracle for the expected strength of a directional signal:
 * clamp01((|extension| - threshold) / threshold), with the extension built from
 * the same shared helpers (`sma`, `computeAtr14`) the production code uses and
 * computed here from scratch over the candle series.
 */
function expectedStrength(
  candles: readonly Candle[],
  threshold: number,
  baselinePeriod: number,
): number {
  const closes = candles.map((c) => c.close);
  const close = closes[closes.length - 1] as number;
  const baselineMA = sma(closes, baselinePeriod);
  const atr = computeAtr14(candles);
  const extension = (close - baselineMA) / atr;
  return clamp01((Math.abs(extension) - threshold) / threshold);
}

// A tiny, fully hand-computable config shared by the directional / FLAT cases.
// required candles = baselinePeriod + 2 * momentumWindow = 3 + 2 = 5.
const TINY = { extensionThreshold: 2, baselinePeriod: 3, momentumWindow: 1 };

// --- DOWN (Requirements 5.2, 5.5, 5.6) ---------------------------------------

describe("createReversalStrategy — DOWN on an over-extended rally with fading momentum (Req 5.2)", () => {
  it("emits DOWN with strength = min(1, (|ext| - thr)/thr) for a decelerating rally", () => {
    // Closes [100, 100, 100, 100, 100, 105, 107] with FLAT intraday ranges and
    // config extensionThreshold 2 / baselinePeriod 3 / momentumWindow 1.
    //
    // Baseline_MA = sma(last 3 closes) = sma([100, 105, 107]) = 312/3 = 104.
    //   close = 107, so (close - baselineMA) = 107 - 104 = 3.
    // ATR_14 (lookback 14 > 7 candles -> the mean of all 7 True Ranges). With
    //   FLAT intraday, TR[0] = 0 and TR[i] = |close[i] - close[i-1]|:
    //   deltas = [_, 0, 0, 0, 0, 5, 2] -> sum = 7 over 7 candles -> ATR = 1.
    //   extension = 3 / 1 = 3  (> threshold 2).
    // Momentum (momentumWindow 1):
    //   rocRecent = 107 - 105 = 2,  rocPrev = 105 - 100 = 5.
    //   |rocRecent| 2 < |rocPrev| 5 -> fading, both positive and extension
    //   positive -> exhaustion holds -> direction DOWN (fade the rally).
    // strength = clamp01((|3| - 2)/2) = clamp01(0.5) = 0.5.
    const closes = [100, 100, 100, 100, 100, 105, 107];
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = reversalWith(TINY);

    // Sanity-check the hand computation against the shared helpers.
    expect(computeAtr14(candles)).toBeCloseTo(1, 10);
    expect(sma(closes, 3)).toBeCloseTo(104, 10);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.strategyId).toBe("reversal");
    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBeCloseTo(
      expectedStrength(candles, 2, 3),
      10,
    );
    expect(signal.strength).toBeCloseTo(0.5, 10);
    expect(signal.rationale).toContain("extension=3");
    expect(signal.rationale).toContain("atr=1");
    expect(signal.rationale).toContain("rocRecent=2");
    expect(signal.rationale).toContain("rocPrev=5");
    expect(signal.rationale).toContain("DOWN");
  });
});

// --- UP (Requirements 5.3, 5.5, 5.6) -----------------------------------------

describe("createReversalStrategy — UP on an over-extended sell-off with fading momentum (Req 5.3)", () => {
  it("emits UP with strength = min(1, (|ext| - thr)/thr) for a decelerating sell-off", () => {
    // Mirror image of the DOWN case. Closes [100, 100, 100, 100, 100, 95, 93].
    //   Baseline_MA = sma([100, 95, 93]) = 288/3 = 96.
    //   close = 93 -> (close - baselineMA) = 93 - 96 = -3.
    //   deltas = [_, 0, 0, 0, 0, -5, -2] -> sum|.| = 7 over 7 -> ATR = 1.
    //   extension = -3 / 1 = -3  (< -threshold -2).
    //   rocRecent = 93 - 95 = -2,  rocPrev = 95 - 100 = -5.
    //   |-2| < |-5| -> fading; both negative and extension negative ->
    //   exhaustion holds -> direction UP (fade the sell-off).
    //   strength = clamp01((|-3| - 2)/2) = 0.5.
    const closes = [100, 100, 100, 100, 100, 95, 93];
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = reversalWith(TINY);

    expect(computeAtr14(candles)).toBeCloseTo(1, 10);
    expect(sma(closes, 3)).toBeCloseTo(96, 10);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBeCloseTo(
      expectedStrength(candles, 2, 3),
      10,
    );
    expect(signal.strength).toBeCloseTo(0.5, 10);
    expect(signal.rationale).toContain("extension=-3");
    expect(signal.rationale).toContain("rocRecent=-2");
    expect(signal.rationale).toContain("rocPrev=-5");
    expect(signal.rationale).toContain("UP");
  });
});

// --- FLAT: extension within the threshold (Requirement 5.4) ------------------

describe("createReversalStrategy — FLAT when extension stays within the threshold (Req 5.4)", () => {
  it("emits FLAT with strength 0 when the close equals its Baseline_MA (zero extension)", () => {
    // Five candles with identical closes but a non-zero intraday range, so ATR
    // is usable (not the zero-ATR path) yet the extension is exactly 0:
    //   close = 100, Baseline_MA = sma([100,100,100]) = 100 -> extension 0.
    //   |0| is within the threshold 2 -> FLAT with strength 0, regardless of
    //   momentum.
    // Intraday band of +/-1 gives True Range 2 on every candle -> ATR = 2 > 0.
    const closes = Array.from({ length: 5 }, () => 100);
    const candles = closes.map((close, i) =>
      candle(addTradingDays(FIRST_DATE, i), {
        open: close,
        high: close + 1,
        low: close - 1,
        close,
      }),
    );
    const decisionDate = addTradingDays(candles[candles.length - 1]!.date, 1);
    const strategy = reversalWith(TINY);

    // Confirm the premise: ATR is usable (non-zero) so this is NOT the zero-ATR
    // short circuit; the FLAT comes from the within-threshold extension.
    expect(computeAtr14(candles)).toBeCloseTo(2, 10);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("extension=0");
    expect(signal.rationale).toContain("FLAT");
  });
});

// --- FLAT: exhaustion absent (Requirements 5.4, 5.5) -------------------------

describe("createReversalStrategy — FLAT when extension is extreme but momentum is NOT fading (Req 5.5)", () => {
  it("emits FLAT with strength 0 for an accelerating (non-fading) over-extension", () => {
    // Closes [100, 100, 100, 100, 100, 101, 103]: an accelerating rally.
    //   Baseline_MA = sma([100, 101, 103]) = 304/3 = 101.333...
    //   close = 103 -> (close - baselineMA) = 1.666...
    //   deltas = [_, 0, 0, 0, 0, 1, 2] -> sum 3 over 7 -> ATR = 3/7 = 0.42857...
    //   extension = 1.666.. / 0.42857.. = 3.888...  (well beyond threshold 2).
    // Momentum: rocRecent = 103 - 101 = 2, rocPrev = 101 - 100 = 1.
    //   |2| is NOT < |1| -> momentum is accelerating, not fading -> no
    //   exhaustion -> FLAT with strength 0 even though the extension is extreme.
    const closes = [100, 100, 100, 100, 100, 101, 103];
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = reversalWith(TINY);

    // Confirm the premise: the extension really is beyond the threshold, so the
    // FLAT is driven by the missing exhaustion, not by a small extension.
    const close = closes[closes.length - 1] as number;
    const extension = (close - sma(closes, 3)) / computeAtr14(candles);
    expect(Math.abs(extension)).toBeGreaterThan(TINY.extensionThreshold);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("FLAT");
  });
});

// --- Insufficient history (Requirement 5.8) ----------------------------------

describe("createReversalStrategy — insufficient history (Req 5.8)", () => {
  it("returns FLAT, strength 0, and an 'insufficient candles' rationale with 25 candles under the defaults", () => {
    // Defaults require baselinePeriod(20) + 2 * momentumWindow(3) = 26 candles;
    // 25 is one short, so the history guard fires BEFORE any ATR or extension
    // work and before the zero-ATR check.
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i * 0.01);
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = reversalWith(); // defaults 2.0 / 20 / 3

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("insufficient candles");
    expect(signal.rationale).toContain("need 26");
    expect(signal.rationale).toContain("have 25");
  });
});

// --- Zero volatility -> zero ATR (Requirement 5.8) ---------------------------

describe("createReversalStrategy — zero volatility yields a zero-ATR FLAT (Req 5.8)", () => {
  it("returns FLAT, strength 0, and a 'zero ATR' rationale when every OHLC value is identical", () => {
    // Five identical OHLC candles clear the tiny-config history guard
    // (required = 3 + 2*1 = 5) but have True Range 0 on every candle, so
    // ATR_14 = 0 and the ATR-usability check forces FLAT with a rationale that
    // is textually DISTINCT from the insufficient-candles case.
    const closes = Array.from({ length: 5 }, () => 100);
    const candles = closes.map((close, i) =>
      candle(addTradingDays(FIRST_DATE, i), {
        open: close,
        high: close,
        low: close,
        close,
      }),
    );
    const decisionDate = addTradingDays(candles[candles.length - 1]!.date, 1);
    const strategy = reversalWith(TINY);

    // Confirm the premise: ATR is exactly 0 over this prepared series.
    expect(computeAtr14(candles)).toBe(0);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("zero ATR");
  });

  it("uses DISTINCT rationale text for the zero-ATR and insufficient-candles short circuits", () => {
    // The design requires the two FLAT short circuits to be distinguishable by
    // their rationale text (Requirement 5.8). Build one of each and assert the
    // strings differ.
    const zeroAtrCloses = Array.from({ length: 5 }, () => 100);
    const zeroAtrCandles = zeroAtrCloses.map((close, i) =>
      candle(addTradingDays(FIRST_DATE, i), {
        open: close,
        high: close,
        low: close,
        close,
      }),
    );
    const zeroAtrDecision = addTradingDays(
      zeroAtrCandles[zeroAtrCandles.length - 1]!.date,
      1,
    );

    // One candle short of the tiny-config requirement (5) -> history guard.
    const shortCloses = Array.from({ length: 4 }, () => 100);
    const shortCandles = shortCloses.map((close, i) =>
      candle(addTradingDays(FIRST_DATE, i), {
        open: close,
        high: close,
        low: close,
        close,
      }),
    );
    const shortDecision = addTradingDays(
      shortCandles[shortCandles.length - 1]!.date,
      1,
    );

    const strategy = reversalWith(TINY);
    const zeroAtr = expectSignal(strategy.evaluate(zeroAtrCandles, zeroAtrDecision));
    const insufficient = expectSignal(strategy.evaluate(shortCandles, shortDecision));

    expect(insufficient.rationale).toContain("insufficient candles");
    expect(zeroAtr.rationale).toContain("zero ATR");
    expect(zeroAtr.rationale).not.toBe(insufficient.rationale);
  });
});

// --- Invalid configuration (Requirement 5.10) --------------------------------

describe("createReversalStrategy — invalid configuration is rejected before any candle is read (Req 5.10)", () => {
  it("rejects a zero extensionThreshold, naming 'extensionThreshold'", () => {
    const made = createReversalStrategy({ extensionThreshold: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("extensionThreshold");
  });

  it("rejects a negative extensionThreshold, naming 'extensionThreshold'", () => {
    const made = createReversalStrategy({ extensionThreshold: -1 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("extensionThreshold");
  });

  it("rejects a non-finite extensionThreshold, naming 'extensionThreshold'", () => {
    const made = createReversalStrategy({ extensionThreshold: Number.POSITIVE_INFINITY });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("extensionThreshold");
  });

  it("rejects a non-integer baselinePeriod, naming 'baselinePeriod'", () => {
    const made = createReversalStrategy({ baselinePeriod: 20.5 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("baselinePeriod");
  });

  it("rejects a baselinePeriod below 1, naming 'baselinePeriod'", () => {
    const made = createReversalStrategy({ baselinePeriod: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("baselinePeriod");
  });

  it("rejects a non-integer momentumWindow, naming 'momentumWindow'", () => {
    const made = createReversalStrategy({ momentumWindow: 3.5 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("momentumWindow");
  });

  it("rejects a momentumWindow below 1, naming 'momentumWindow'", () => {
    const made = createReversalStrategy({ momentumWindow: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("momentumWindow");
  });

  it("creates no strategy instance for an invalid config, so no candle can be evaluated (Req 5.10)", () => {
    // The factory returns an error result and NO Strategy object, so there is
    // nothing to call `evaluate` on. Verify the result is an error up front and
    // that it carries no strategy value — the guarantee that an invalid config
    // never reads a candle.
    const made = createReversalStrategy({ extensionThreshold: -5, baselinePeriod: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    // First invalid parameter wins: extensionThreshold is validated first.
    expect(made.error.parameter).toBe("extensionThreshold");
    expect("value" in made).toBe(false);
  });

  it("leaves the default config untouched (frozen defaults are not mutated by overrides)", () => {
    reversalWith({ extensionThreshold: 3, baselinePeriod: 10, momentumWindow: 2 });
    expect(DEFAULT_REVERSAL_CONFIG.extensionThreshold).toBe(2.0);
    expect(DEFAULT_REVERSAL_CONFIG.baselinePeriod).toBe(20);
    expect(DEFAULT_REVERSAL_CONFIG.momentumWindow).toBe(3);
  });
});
