import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { classifyState, classifyValidation, DELTA_PP, MAX_DELTA_PP } from "./classify.js";
import { computeCandleFeatures } from "./features.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { CandleFeatures, IntradayCandle } from "./types.js";

// Task 4: classification + bounded symmetric delta. UP/DOWN symmetry, bounds,
// neutral on small body, FLAT → NOT_APPLICABLE, every output carries a reason.

/** A strong bullish bar: large body, near the high, with a lower-wick rejection. */
const STRONG_BULL: IntradayCandle = { open: 1.0, high: 1.102, low: 0.99, currentPrice: 1.1 };
/** A strong bearish bar: large body, near the low, with an upper-wick rejection. */
const STRONG_BEAR: IntradayCandle = { open: 1.1, high: 1.11, low: 0.998, currentPrice: 1.0 };
/** A small-bodied, indecisive bar. */
const DOJI: IntradayCandle = { open: 1.05, high: 1.1, low: 1.0, currentPrice: 1.051 };
/** A moderate bullish bar (directional but not strong). */
const MODERATE_BULL: IntradayCandle = { open: 1.0, high: 1.1, low: 0.99, currentPrice: 1.04 };

function features(candle: IntradayCandle): CandleFeatures {
  return computeCandleFeatures(candle);
}

describe("classifyState (known scenarios)", () => {
  it("strong bullish bar STRONGLY_SUPPORTS an UP forecast", () => {
    expect(classifyState(features(STRONG_BULL), "UP")).toBe("STRONGLY_SUPPORTS");
  });

  it("strong bearish bar STRONGLY_CONTRADICTS an UP forecast", () => {
    expect(classifyState(features(STRONG_BEAR), "UP")).toBe("STRONGLY_CONTRADICTS");
  });

  it("strong bearish bar STRONGLY_SUPPORTS a DOWN forecast (mirror)", () => {
    expect(classifyState(features(STRONG_BEAR), "DOWN")).toBe("STRONGLY_SUPPORTS");
  });

  it("moderate bullish bar SUPPORTS an UP forecast", () => {
    expect(classifyState(features(MODERATE_BULL), "UP")).toBe("SUPPORTS");
  });

  it("moderate bullish bar CONTRADICTS a DOWN forecast", () => {
    expect(classifyState(features(MODERATE_BULL), "DOWN")).toBe("CONTRADICTS");
  });

  it("a small-bodied doji is NEUTRAL regardless of direction", () => {
    expect(classifyState(features(DOJI), "UP")).toBe("NEUTRAL");
    expect(classifyState(features(DOJI), "DOWN")).toBe("NEUTRAL");
  });

  it("a FLAT original direction is NOT_APPLICABLE", () => {
    expect(classifyState(features(STRONG_BULL), "FLAT")).toBe("NOT_APPLICABLE");
  });
});

describe("classifyValidation (delta + confidence)", () => {
  it("strong support adds +10pp, clamped to [0,100]", () => {
    const r = classifyValidation(features(STRONG_BULL), "UP", 58);
    expect(r.state).toBe("STRONGLY_SUPPORTS");
    expect(r.confidenceDelta).toBe(10);
    expect(r.currentConfidence).toBe(68);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("strong contradiction subtracts 10pp", () => {
    const r = classifyValidation(features(STRONG_BEAR), "UP", 58);
    expect(r.state).toBe("STRONGLY_CONTRADICTS");
    expect(r.confidenceDelta).toBe(-10);
    expect(r.currentConfidence).toBe(48);
  });

  it("neutral leaves confidence unchanged", () => {
    const r = classifyValidation(features(DOJI), "UP", 58);
    expect(r.confidenceDelta).toBe(0);
    expect(r.currentConfidence).toBe(58);
  });

  it("FLAT original yields NOT_APPLICABLE with zero delta", () => {
    const r = classifyValidation(features(STRONG_BULL), "FLAT", 58);
    expect(r.state).toBe("NOT_APPLICABLE");
    expect(r.confidenceDelta).toBe(0);
    expect(r.currentConfidence).toBe(58);
  });

  it("clamps the current confidence to [0,100] at the extremes", () => {
    expect(classifyValidation(features(STRONG_BULL), "UP", 95).currentConfidence).toBe(100);
    expect(classifyValidation(features(STRONG_BEAR), "UP", 5).currentConfidence).toBe(0);
  });
});

/** A valid candle arbitrary (reused from the feature-test shape). */
function validCandle(): fc.Arbitrary<IntradayCandle> {
  return fc
    .tuple(
      fc.double({ min: 0.5, max: 1.5, noNaN: true }),
      fc.double({ min: 0.001, max: 0.5, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
    )
    .map(([base, span, a, b]) => {
      const low = base;
      const high = base + span;
      return {
        open: low + a * (high - low),
        high,
        low,
        currentPrice: low + b * (high - low),
      };
    });
}

describe("classifyValidation (properties)", () => {
  it("delta is always within [-MAX, +MAX] and equals the state's mapped delta", () => {
    fc.assert(
      fc.property(
        validCandle(),
        fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT"),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (candle, direction, confidence) => {
          const r = classifyValidation(computeCandleFeatures(candle), direction, confidence);
          expect(r.confidenceDelta).toBeGreaterThanOrEqual(-MAX_DELTA_PP);
          expect(r.confidenceDelta).toBeLessThanOrEqual(MAX_DELTA_PP);
          expect(r.confidenceDelta).toBe(DELTA_PP[r.state]);
          expect(r.currentConfidence).toBeGreaterThanOrEqual(0);
          expect(r.currentConfidence).toBeLessThanOrEqual(100);
          expect(r.reason.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("UP/DOWN symmetry: mirroring the features exactly and flipping the direction mirrors the state", () => {
    // Mirror the FEATURES exactly (no lossy price arithmetic): a bar that is
    // bullish/near-high/lower-wick becomes bearish/near-low/upper-wick. The
    // classifier must map (features, UP) and (mirrored, DOWN) to the same state.
    const flip = (d: CandleFeatures["bodyDirection"]): CandleFeatures["bodyDirection"] =>
      d === "UP" ? "DOWN" : d === "DOWN" ? "UP" : "FLAT";
    const mirror = (f: CandleFeatures): CandleFeatures => ({
      range: f.range,
      body: -f.body,
      bodyDirection: flip(f.bodyDirection),
      bodyToRange: f.bodyToRange,
      upperWick: f.lowerWick,
      lowerWick: f.upperWick,
      pricePositionInRange: 1 - f.pricePositionInRange,
    });
    fc.assert(
      fc.property(validCandle(), (candle) => {
        const f = computeCandleFeatures(candle);
        const up = classifyState(f, "UP");
        const downMirror = classifyState(mirror(f), "DOWN");
        expect(downMirror).toBe(up);
      }),
    );
  });
});
