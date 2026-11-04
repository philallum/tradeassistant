import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Candle } from "../guard/types.js";
import type { AnalogueRecord } from "../retrieval/types.js";
import {
  RANGE_HISTORY_FLOOR,
  RANGE_NEIGHBOURHOOD_FLOOR,
  bucketOf,
  deriveExpectedRange,
  spanRatio,
  tercileCutoffs,
} from "./expectedRange.js";
import { realizedBucket, realizedSpanPips } from "./realized.js";

// EURUSD: pip 0.0001. atr14 is stored in PRICE units: 0.0060 = 60 pips.
const ATR_PRICE = 0.006;
const ATR_PIPS = 60;

function rec(
  spanPips: number,
  overrides: Partial<AnalogueRecord> = {},
  date = "2024-01-02",
): AnalogueRecord {
  return {
    asset: "EURUSD",
    decisionDate: date,
    horizon: 1,
    direction: "UP",
    mfePips: spanPips / 2,
    maePips: spanPips / 2,
    atr14: ATR_PRICE,
    matured: true,
    ...overrides,
  };
}

/** n records whose span/ATR ratio runs evenly from `lo` to `hi`. */
function ramp(n: number, lo: number, hi: number): AnalogueRecord[] {
  return Array.from({ length: n }, (_, i) =>
    rec((lo + ((hi - lo) * i) / Math.max(1, n - 1)) * ATR_PIPS),
  );
}

describe("spanRatio", () => {
  it("is (mfe+mae) over ATR in pips, converting the price-unit atr14", () => {
    expect(spanRatio(rec(60), "EURUSD")).toBeCloseTo(1, 6);
    expect(spanRatio(rec(30), "EURUSD")).toBeCloseTo(0.5, 6);
  });

  it("is null for an unusable ATR", () => {
    expect(spanRatio(rec(60, { atr14: 0 }), "EURUSD")).toBeNull();
  });

  it("converts JPY pairs with a 0.01 pip", () => {
    // atr14 0.60 price units on a JPY pair = 60 pips.
    expect(spanRatio(rec(60, { asset: "USDJPY", atr14: 0.6 }), "USDJPY")).toBeCloseTo(1, 6);
  });
});

describe("tercileCutoffs / bucketOf", () => {
  it("partitions a sample into thirds", () => {
    const ratios = Array.from({ length: 300 }, (_, i) => i / 100);
    const c = tercileCutoffs(ratios);
    expect(bucketOf(0.1, c)).toBe("SMALL");
    expect(bucketOf(1.5, c)).toBe("MEDIUM");
    expect(bucketOf(2.9, c)).toBe("LARGE");
  });
});

describe("deriveExpectedRange", () => {
  const history = ramp(300, 0.2, 2.2); // pair history: terciles near 0.87 / 1.53

  it("returns null below the 30-analogue neighbourhood floor", () => {
    const nb = ramp(RANGE_NEIGHBOURHOOD_FLOOR - 1, 1, 1);
    expect(deriveExpectedRange(nb, history, 1, "EURUSD", ATR_PRICE)).toBeNull();
  });

  it("returns null when the pair history is too short for terciles", () => {
    const nb = ramp(40, 1, 1);
    const short = ramp(RANGE_HISTORY_FLOOR - 1, 0.2, 2.2);
    expect(deriveExpectedRange(nb, short, 1, "EURUSD", ATR_PRICE)).toBeNull();
  });

  it("returns null when today's ATR is unusable", () => {
    expect(deriveExpectedRange(ramp(40, 1, 1), history, 1, "EURUSD", 0)).toBeNull();
  });

  it("buckets a small / medium / large neighbourhood relative to the pair's own history", () => {
    const small = deriveExpectedRange(ramp(40, 0.3, 0.4), history, 1, "EURUSD", ATR_PRICE);
    const medium = deriveExpectedRange(ramp(40, 1.1, 1.3), history, 1, "EURUSD", ATR_PRICE);
    const large = deriveExpectedRange(ramp(40, 2.0, 2.1), history, 1, "EURUSD", ATR_PRICE);
    expect(small?.bucket).toBe("SMALL");
    expect(medium?.bucket).toBe("MEDIUM");
    expect(large?.bucket).toBe("LARGE");
  });

  it("is pair-relative: the same neighbourhood is LARGE for a calm pair and SMALL for a wild one", () => {
    const nb = ramp(40, 1.0, 1.0);
    const calm = ramp(300, 0.1, 0.9);
    const wild = ramp(300, 1.5, 4.0);
    expect(deriveExpectedRange(nb, calm, 1, "EURUSD", ATR_PRICE)?.bucket).toBe("LARGE");
    expect(deriveExpectedRange(nb, wild, 1, "EURUSD", ATR_PRICE)?.bucket).toBe("SMALL");
  });

  it("scales the pips range with today's ATR and orders low <= high", () => {
    const nb = ramp(40, 0.8, 1.2);
    const r = deriveExpectedRange(nb, history, 1, "EURUSD", ATR_PRICE)!;
    expect(r.atrPips).toBe(ATR_PIPS);
    expect(r.lowPips).toBeLessThanOrEqual(r.highPips);
    const doubled = deriveExpectedRange(nb, history, 1, "EURUSD", ATR_PRICE * 2)!;
    expect(doubled.highPips).toBeGreaterThan(r.highPips * 1.9);
  });

  it("only reads analogues at the requested horizon", () => {
    const nb = [...ramp(40, 1, 1), ...ramp(40, 5, 5).map((r) => ({ ...r, horizon: 2 as const }))];
    const r = deriveExpectedRange(nb, history, 1, "EURUSD", ATR_PRICE)!;
    expect(r.sampleSize).toBe(40);
  });

  it("is deterministic and order-independent (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.1, max: 4, noNaN: true }), { minLength: 30, maxLength: 80 }),
        fc.integer({ min: 0, max: 1000 }),
        (ratios, seed) => {
          const nb = ratios.map((x) => rec(x * ATR_PIPS));
          const shuffled = [...nb].sort((a, b) => ((a.mfePips * 1000 + seed) % 7) - ((b.mfePips * 1000 + seed) % 7));
          const a = deriveExpectedRange(nb, history, 1, "EURUSD", ATR_PRICE);
          const b = deriveExpectedRange(shuffled, history, 1, "EURUSD", ATR_PRICE);
          expect(a).toEqual(b);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is monotone: scaling every neighbourhood span up never lowers the bucket (property)", () => {
    const order = { SMALL: 0, MEDIUM: 1, LARGE: 2 } as const;
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.1, max: 2, noNaN: true }), { minLength: 30, maxLength: 60 }),
        fc.double({ min: 1, max: 3, noNaN: true }),
        (ratios, k) => {
          const base = ratios.map((x) => rec(x * ATR_PIPS));
          const bigger = ratios.map((x) => rec(x * k * ATR_PIPS));
          const a = deriveExpectedRange(base, history, 1, "EURUSD", ATR_PRICE)!;
          const b = deriveExpectedRange(bigger, history, 1, "EURUSD", ATR_PRICE)!;
          expect(order[b.bucket]).toBeGreaterThanOrEqual(order[a.bucket]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("realized range", () => {
  const candle = (date: string, o: number, h: number, l: number, c: number): Candle => ({
    asset: "EURUSD",
    date,
    open: o,
    high: h,
    low: l,
    close: c,
  });
  // Decision 2024-01-02 (Tue). Forward: Wed 03 open 1.1000 high 1.1060 low 1.0980.
  const candles = [
    candle("2024-01-02", 1.1, 1.101, 1.099, 1.1),
    candle("2024-01-03", 1.1, 1.106, 1.098, 1.104),
    candle("2024-01-04", 1.104, 1.11, 1.1, 1.108),
  ];

  it("measures the high-low envelope relative to the first forward open", () => {
    // h=1: 60 up + 20 down = 80 pips.
    expect(realizedSpanPips(candles, "2024-01-02", 1, "EURUSD")).toBeCloseTo(80, 6);
    // h=2: highest 1.1100 (+100), lowest 1.0980 (-20) = 120 pips.
    expect(realizedSpanPips(candles, "2024-01-02", 2, "EURUSD")).toBeCloseTo(120, 6);
  });

  it("is null until the full horizon window exists", () => {
    expect(realizedSpanPips(candles.slice(0, 2), "2024-01-02", 2, "EURUSD")).toBeNull();
  });

  it("scores against the as-of cut-offs only once matured", () => {
    const forecast = {
      bucket: "SMALL" as const,
      horizon: 1 as const,
      lowPips: 10,
      highPips: 20,
      sampleSize: 40,
      cutoffs: { smallMax: 0.8, mediumMax: 1.5 },
      atrPips: 60,
    };
    // Not matured on the decision date or the next day (window still open).
    expect(realizedBucket(forecast, candles, "2024-01-02", "EURUSD", "2024-01-02")).toBeNull();
    // Matured on 01-04 (the day after the horizon day closes): 80/60 = 1.33 -> MEDIUM.
    expect(realizedBucket(forecast, candles, "2024-01-02", "EURUSD", "2024-01-04")).toBe("MEDIUM");
  });
});
