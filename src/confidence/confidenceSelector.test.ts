import { describe, expect, it } from "vitest";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  analogueCount,
  classify,
  earnedConfidence,
  rawResolutionRate,
  selectHorizon,
} from "./confidenceSelector.js";
import { computeAtr14, trueRange } from "./atr.js";
import { FIXED_PRIOR_WEIGHT, NEUTRAL_PRIOR, SAMPLE_SIZE_FLOOR } from "./types.js";

// --- Test fixtures -----------------------------------------------------------

function record(
  horizon: 1 | 2 | 3,
  direction: DirectionClass,
  asset: Pair = "EURUSD",
  decisionDate = "2025-01-01",
): AnalogueRecord {
  return {
    asset,
    decisionDate,
    horizon,
    direction,
    mfePips: 10,
    maePips: 5,
    atr14: 0.008,
    matured: true,
  };
}

/** Build `count` analogue records at `horizon`, `resolved` of them UP, rest FLAT. */
function neighborhood(
  horizon: 1 | 2 | 3,
  count: number,
  resolvedUp: number,
): AnalogueRecord[] {
  const out: AnalogueRecord[] = [];
  for (let i = 0; i < count; i++) {
    out.push(record(horizon, i < resolvedUp ? "UP" : "FLAT", "EURUSD", `2025-01-${(i % 28) + 1}`));
  }
  return out;
}

// --- earnedConfidence (Task 5.1) ---------------------------------------------

describe("earnedConfidence — fixed-prior shrinkage (Req 10.1-10.3, 10.7)", () => {
  it("applies C_shrunk = (n/(n+k))*C_raw + (k/(n+k))*0.5 with k=10", () => {
    // 40 analogues, 30 resolve UP -> C_raw = 0.75, n = 40, k = 10.
    const nb = neighborhood(1, 40, 30);
    const n = 40;
    const cRaw = 0.75;
    const expected =
      (n / (n + FIXED_PRIOR_WEIGHT)) * cRaw +
      (FIXED_PRIOR_WEIGHT / (n + FIXED_PRIOR_WEIGHT)) * NEUTRAL_PRIOR;
    expect(earnedConfidence(nb, 1)).toBeCloseTo(expected, 12);
  });

  it("returns the neutral prior for an empty neighborhood", () => {
    expect(earnedConfidence([], 1)).toBeCloseTo(NEUTRAL_PRIOR, 12);
  });

  it("constrains the result to [0,1]", () => {
    // Perfect resolution at large n approaches but never exceeds 1.
    const perfect = earnedConfidence(neighborhood(2, 100, 100), 2);
    expect(perfect).toBeGreaterThan(0);
    expect(perfect).toBeLessThanOrEqual(1);
    expect(perfect).toBeGreaterThanOrEqual(0);
  });

  it("cannot cross a typical threshold on sample size alone below the floor", () => {
    // A tiny neighborhood with perfect raw resolution is still pulled toward 0.5.
    const tiny = earnedConfidence(neighborhood(1, 5, 5), 1); // n=5, C_raw=1
    const expected = (5 / 15) * 1 + (10 / 15) * 0.5; // ≈ 0.6667
    expect(tiny).toBeCloseTo(expected, 12);
    // The full-strength (n large) equivalent would be ~1.0; the floor keeps it modest.
    expect(tiny).toBeLessThan(0.7);
    expect(SAMPLE_SIZE_FLOOR).toBe(30);
  });

  it("shrinks a smaller neighborhood no farther from 0.5 than a larger one at equal C_raw", () => {
    const small = earnedConfidence(neighborhood(1, 10, 8), 1); // C_raw = 0.8
    const large = earnedConfidence(neighborhood(1, 100, 80), 1); // C_raw = 0.8
    expect(Math.abs(small - NEUTRAL_PRIOR)).toBeLessThanOrEqual(
      Math.abs(large - NEUTRAL_PRIOR),
    );
  });
});

describe("rawResolutionRate / analogueCount", () => {
  it("counts analogues at the requested horizon only", () => {
    const nb = [...neighborhood(1, 3, 3), ...neighborhood(2, 5, 2)];
    expect(analogueCount(nb, 1)).toBe(3);
    expect(analogueCount(nb, 2)).toBe(5);
    expect(analogueCount(nb, 3)).toBe(0);
  });

  it("computes resolution as the dominant-direction fraction", () => {
    // 6 UP, 4 DOWN at horizon 1 -> dominant = 6/10 = 0.6
    const nb = [
      ...Array.from({ length: 6 }, (_, i) => record(1, "UP", "EURUSD", `2025-02-${i + 1}`)),
      ...Array.from({ length: 4 }, (_, i) => record(1, "DOWN", "EURUSD", `2025-03-${i + 1}`)),
    ];
    expect(rawResolutionRate(nb, 1)).toBeCloseTo(0.6, 12);
  });

  it("treats an all-FLAT neighborhood as never resolving (C_raw = 0)", () => {
    expect(rawResolutionRate(neighborhood(1, 8, 0), 1)).toBe(0);
  });
});

// --- classify (Task 5.2) -----------------------------------------------------

describe("classify — ATR_14-scaled FLAT dead-band (Req 1.4, 10.4, 10.5)", () => {
  it("classifies within-band moves as FLAT", () => {
    // band = 20 * 0.5 = 10; a move of 8 is FLAT.
    expect(classify(8, 20)).toBe("FLAT");
    expect(classify(-8, 20)).toBe("FLAT");
  });

  it("classifies out-of-band moves by sign", () => {
    expect(classify(15, 20)).toBe("UP"); // 15 > band 10
    expect(classify(-15, 20)).toBe("DOWN");
  });

  it("returns exactly one class for any input (totality)", () => {
    for (const move of [-100, -10, -1, 0, 1, 10, 100]) {
      const c = classify(move, 12);
      expect(["UP", "DOWN", "FLAT"]).toContain(c);
    }
  });

  it("scales the band linearly with ATR_14 (not a fixed pip constant)", () => {
    // A 12-pip move: FLAT under wide ATR (band 15), directional under narrow ATR (band 5).
    expect(classify(12, 30)).toBe("FLAT"); // band = 15
    expect(classify(12, 10)).toBe("UP"); // band = 5
  });
});

// --- selectHorizon (Task 5.2) ------------------------------------------------

describe("selectHorizon — strongest historical resolution (Req 10.6)", () => {
  it("picks the horizon with the highest resolution rate", () => {
    const nb = [
      ...neighborhood(1, 10, 5), // C_raw = 0.5
      ...neighborhood(2, 10, 9), // C_raw = 0.9  <- strongest
      ...neighborhood(3, 10, 6), // C_raw = 0.6
    ];
    expect(selectHorizon(nb)).toBe(2);
  });

  it("breaks ties toward the shorter horizon", () => {
    const nb = [
      ...neighborhood(1, 10, 8),
      ...neighborhood(2, 10, 8),
      ...neighborhood(3, 10, 8),
    ];
    expect(selectHorizon(nb)).toBe(1);
  });

  it("returns a resolution rate >= every other horizon", () => {
    const nb = [
      ...neighborhood(1, 10, 3),
      ...neighborhood(2, 10, 7),
      ...neighborhood(3, 10, 4),
    ];
    const chosen = selectHorizon(nb);
    const chosenRate = rawResolutionRate(nb, chosen);
    for (const h of [1, 2, 3] as const) {
      expect(chosenRate).toBeGreaterThanOrEqual(rawResolutionRate(nb, h));
    }
  });
});

// --- ATR_14 ------------------------------------------------------------------

describe("computeAtr14 — 14-trading-day Average True Range (Req 10.4)", () => {
  const candle = (date: string, o: number, h: number, l: number, c: number) => ({
    asset: "EURUSD",
    date,
    open: o,
    high: h,
    low: l,
    close: c,
  });

  it("uses high-low for the first candle's true range", () => {
    const c = candle("2025-01-01", 1.1, 1.12, 1.09, 1.11);
    expect(trueRange(c, undefined)).toBeCloseTo(0.03, 12);
  });

  it("incorporates the previous close into true range", () => {
    const c = candle("2025-01-02", 1.11, 1.13, 1.105, 1.12);
    // prevClose 1.08 -> |high - prevClose| = 0.05 dominates high-low 0.025
    expect(trueRange(c, 1.08)).toBeCloseTo(0.05, 12);
  });

  it("averages the true range over the lookback window", () => {
    const candles = [
      candle("2025-01-01", 1.10, 1.12, 1.10, 1.11), // TR = 0.02 (first)
      candle("2025-01-02", 1.11, 1.13, 1.11, 1.12), // TR = max(0.02, 0.02, 0.00) = 0.02
    ];
    expect(computeAtr14(candles)).toBeCloseTo(0.02, 12);
  });

  it("returns 0 for empty input (defined, non-error result)", () => {
    expect(computeAtr14([])).toBe(0);
  });
});
