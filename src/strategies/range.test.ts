// Unit tests for the Range / Mean Reversion strategy (Requirement 4; Design
// "Range (range.ts, Requirement 4)").
//
// These pin specific, hand-constructed examples for each branch of `evaluate`:
// an UP signal (close below the lower Bollinger band AND RSI below oversold), a
// DOWN signal (close above the upper band AND RSI above overbought), a FLAT
// signal (close inside the bands so neither combined condition holds), the
// insufficient-history guard (19 candles under the defaults), the
// zero-volatility case (identical OHLC -> zero std-dev), and every
// invalid-configuration case. Property-level coverage lives in the companion
// property test (task 6.3); this file nails down exact directions and numbers.
//
// To keep the Bollinger / RSI math tractable by hand, the directional cases use
// a tiny config — bbPeriod 5, bbK 1, rsiPeriod 2 — so only five candles are
// required. A narrow band (bbK 1) lets a single final outlier close strictly
// pierce a band, which a width-2 band would not allow for a lone outlier among
// four equal values. The expected strength is derived independently from the
// same shared helpers (`sma`, `populationStdDev`, `rsiWilder`, `clamp01`) the
// production code uses, and each directional case also carries a fully
// hand-computed oracle with hardcoded numbers.

import { describe, expect, it } from "vitest";
import { createRangeStrategy } from "./range.js";
import { sma, populationStdDev, rsiWilder, clamp01 } from "./indicators.js";
import { addTradingDays } from "../guard/tradingDate.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { StrategySignal, StrategyError } from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** A weekday anchor used as the first candle date across the suite. */
const FIRST_DATE: TradingDate = "2015-01-01"; // a Thursday

/**
 * Build one OHLC candle. `open`/`high`/`low` default to `close` so a test only
 * overrides what it cares about; explicit OHLC is supplied for the
 * zero-volatility case.
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
 * Turn a list of closes into ascending-weekday-dated candles (each flat: OHLC
 * all equal to the close, which the Range strategy ignores — it reads closes
 * only). Returns the candles and the day AFTER the last candle as a safe
 * Decision_Date.
 */
function seriesFromCloses(
  closes: readonly number[],
): { candles: Candle[]; decisionDate: TradingDate } {
  const candles = closes.map((close, i) =>
    candle(addTradingDays(FIRST_DATE, i), { close }),
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
function rangeWith(partial?: Parameters<typeof createRangeStrategy>[0]) {
  const made = createRangeStrategy(partial);
  if (!made.ok) {
    throw new Error(`expected a strategy, got config error: ${JSON.stringify(made.error)}`);
  }
  return made.value;
}

/**
 * Independent oracle for the expected strength of a directional signal: the
 * mean of a clamped band-penetration score and a clamped RSI-distance score,
 * built from the same shared helpers the production code uses and computed here
 * from scratch over the close series.
 */
function expectedStrength(
  closes: readonly number[],
  direction: "UP" | "DOWN",
  cfg: { bbPeriod: number; bbK: number; rsiPeriod: number; oversold: number; overbought: number },
): number {
  const window = closes.slice(-cfg.bbPeriod);
  const mid = sma(window, cfg.bbPeriod);
  const sd = populationStdDev(window);
  const lower = mid - cfg.bbK * sd;
  const upper = mid + cfg.bbK * sd;
  const span = upper - lower;
  const close = closes[closes.length - 1] as number;
  const rsi = rsiWilder(closes, cfg.rsiPeriod);

  if (direction === "UP") {
    const penetration = (lower - close) / span;
    const rsiScore = (cfg.oversold - rsi) / cfg.oversold;
    return (clamp01(penetration) + clamp01(rsiScore)) / 2;
  }
  const penetration = (close - upper) / span;
  const rsiScore = (rsi - cfg.overbought) / (100 - cfg.overbought);
  return (clamp01(penetration) + clamp01(rsiScore)) / 2;
}

// --- UP (Requirement 4.1) ----------------------------------------------------

describe("createRangeStrategy — UP when close pierces the lower band AND RSI is oversold (Req 4.1)", () => {
  it("emits UP with strength = mean of clamped penetration and RSI-distance scores", () => {
    // Closes [3, 3, 3, 3, 1] with bbPeriod 5, bbK 1, rsiPeriod 2.
    //
    // Bollinger over the five closes:
    //   mid = (3+3+3+3+1)/5 = 2.6
    //   sd  = sqrt(((0.4^2)*4 + 1.6^2)/5) = sqrt((0.64 + 2.56)/5) = sqrt(0.64) = 0.8
    //   lower = 2.6 - 1*0.8 = 1.8,  upper = 2.6 + 0.8 = 3.4,  span = 1.6
    //   close = 1.0 < lower 1.8  -> band pierced downward.
    // Wilder RSI (period 2) over changes [0, 0, 0, -2]: avgGain 0, avgLoss 1,
    //   so RSI = 0 < oversold 30 -> RSI confirms.
    // Direction UP. Strength:
    //   penetration = (1.8 - 1.0)/1.6 = 0.5
    //   rsiScore    = (30 - 0)/30 = 1.0
    //   strength    = (clamp01(0.5) + clamp01(1.0))/2 = (0.5 + 1)/2 = 0.75
    const closes = [3, 3, 3, 3, 1];
    const cfg = { bbPeriod: 5, bbK: 1, rsiPeriod: 2, oversold: 30, overbought: 70 };
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = rangeWith(cfg);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.strategyId).toBe("range");
    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBeCloseTo(expectedStrength(closes, "UP", cfg), 10);
    expect(signal.strength).toBeCloseTo(0.75, 10);
    expect(signal.rationale).toContain("close=1");
    expect(signal.rationale).toContain("lower=1.8");
    expect(signal.rationale).toContain("upper=3.4");
    expect(signal.rationale).toContain("rsi=0");
    expect(signal.rationale).toContain("UP");
  });
});

// --- DOWN (Requirement 4.2) --------------------------------------------------

describe("createRangeStrategy — DOWN when close pierces the upper band AND RSI is overbought (Req 4.2)", () => {
  it("emits DOWN with strength = mean of clamped penetration and RSI-distance scores", () => {
    // Mirror of the UP case. Closes [3, 3, 3, 3, 5] with bbPeriod 5, bbK 1,
    // rsiPeriod 2.
    //   mid = 3.4,  sd = 0.8,  upper = 4.2,  lower = 2.6,  span = 1.6
    //   close = 5.0 > upper 4.2 -> band pierced upward.
    // Wilder RSI over changes [0, 0, 0, +2]: avgGain 1, avgLoss 0 -> RSI = 100
    //   > overbought 70 -> RSI confirms.
    // Direction DOWN. Strength:
    //   penetration = (5.0 - 4.2)/1.6 = 0.5
    //   rsiScore    = (100 - 70)/(100 - 70) = 1.0
    //   strength    = (0.5 + 1)/2 = 0.75
    const closes = [3, 3, 3, 3, 5];
    const cfg = { bbPeriod: 5, bbK: 1, rsiPeriod: 2, oversold: 30, overbought: 70 };
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = rangeWith(cfg);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBeCloseTo(expectedStrength(closes, "DOWN", cfg), 10);
    expect(signal.strength).toBeCloseTo(0.75, 10);
    expect(signal.rationale).toContain("close=5");
    expect(signal.rationale).toContain("rsi=100");
    expect(signal.rationale).toContain("DOWN");
  });
});

// --- FLAT: close inside the bands (Requirement 4.3) --------------------------

describe("createRangeStrategy — FLAT when neither combined condition holds (Req 4.3)", () => {
  it("emits FLAT with strength 0 when the latest close sits inside the bands", () => {
    // Closes [1, 3, 2, 4, 3] with bbPeriod 5, bbK 1, rsiPeriod 2.
    //   mid = (1+3+2+4+3)/5 = 2.6
    //   sd  = sqrt(((-1.6)^2 + 0.4^2 + (-0.6)^2 + 1.4^2 + 0.4^2)/5)
    //       = sqrt((2.56 + 0.16 + 0.36 + 1.96 + 0.16)/5) = sqrt(1.04) ≈ 1.0198
    //   lower ≈ 1.5802,  upper ≈ 3.6198
    //   close = 3.0 sits strictly inside [lower, upper] -> no band pierce at
    //   all, so neither the UP (close < lower) nor the DOWN (close > upper)
    //   condition can hold regardless of RSI -> FLAT, strength 0.
    const closes = [1, 3, 2, 4, 3];
    const cfg = { bbPeriod: 5, bbK: 1, rsiPeriod: 2, oversold: 30, overbought: 70 };
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = rangeWith(cfg);

    // Sanity-check the premise with the shared helpers: close within the bands.
    const window = closes.slice(-cfg.bbPeriod);
    const mid = sma(window, cfg.bbPeriod);
    const sd = populationStdDev(window);
    const lower = mid - cfg.bbK * sd;
    const upper = mid + cfg.bbK * sd;
    const close = closes[closes.length - 1] as number;
    expect(close).toBeGreaterThan(lower);
    expect(close).toBeLessThan(upper);

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("FLAT");
  });
});

// --- Insufficient history (Requirement 4.6) ----------------------------------

describe("createRangeStrategy — insufficient history (Req 4.6)", () => {
  it("returns FLAT, strength 0, 'insufficient history' with 19 candles under the defaults", () => {
    // Defaults require max(bbPeriod 20, rsiPeriod 14 + 1) = 20 candles; 19 is
    // one short, so the history guard fires before any band / RSI work.
    const closes = Array.from({ length: 19 }, (_, i) => 1 + i * 0.01);
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = rangeWith(); // default 20 / 2 / 14 / 30 / 70

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("insufficient history");
  });
});

// --- Zero volatility (Requirement 4.7) ---------------------------------------

describe("createRangeStrategy — zero volatility yields FLAT (Req 4.7)", () => {
  it("returns FLAT, strength 0, 'zero volatility' when every close in the window is identical", () => {
    // Five identical closes clear the history guard (required = max(5, 3) = 5)
    // and give a population std-dev of exactly 0, so the band cannot be pierced
    // and the strategy short-circuits to FLAT with a "zero volatility"
    // rationale before computing RSI.
    const closes = Array.from({ length: 5 }, () => 1.25);
    const { candles, decisionDate } = seriesFromCloses(closes);
    const strategy = rangeWith({ bbPeriod: 5, bbK: 1, rsiPeriod: 2 });

    const signal = expectSignal(strategy.evaluate(candles, decisionDate));

    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
    expect(signal.rationale).toContain("zero volatility");
  });
});

// --- Invalid configuration (Requirement 4.9) ---------------------------------

describe("createRangeStrategy — invalid configuration is rejected (Req 4.9)", () => {
  it("rejects a non-integer bbPeriod, naming 'bbPeriod'", () => {
    const made = createRangeStrategy({ bbPeriod: 20.5 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("bbPeriod");
  });

  it("rejects a bbPeriod below 2, naming 'bbPeriod'", () => {
    const made = createRangeStrategy({ bbPeriod: 1 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("bbPeriod");
  });

  it("rejects a non-integer rsiPeriod, naming 'rsiPeriod'", () => {
    const made = createRangeStrategy({ rsiPeriod: 14.5 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("rsiPeriod");
  });

  it("rejects an rsiPeriod below 2, naming 'rsiPeriod'", () => {
    const made = createRangeStrategy({ rsiPeriod: 1 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("rsiPeriod");
  });

  it("rejects a bbK that is not greater than 0, naming 'bbK'", () => {
    const made = createRangeStrategy({ bbK: 0 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("bbK");
  });

  it("rejects oversold not strictly less than overbought, naming 'oversold'", () => {
    const made = createRangeStrategy({ oversold: 70, overbought: 70 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("oversold");
  });

  it("rejects an oversold below 0, naming 'oversold'", () => {
    const made = createRangeStrategy({ oversold: -1 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("oversold");
  });

  it("rejects an overbought above 100, naming 'overbought'", () => {
    const made = createRangeStrategy({ overbought: 101 });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("expected a config error");
    expect(made.error.reason).toBe("invalid_config");
    expect(made.error.parameter).toBe("overbought");
  });
});
