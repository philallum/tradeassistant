import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { resolve } from "../retrieval/resolver.js";
import { InMemoryAnalogueStore } from "../retrieval/types.js";
import type { Candle } from "../guard/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import { fromPips, pipSize, toPips } from "./pip.js";

// Feature: trader-edge-validation, Property 1: shared pip helper round-trip + resolver parity
//
// Two guarantees for Stage A (task 1):
//   (1) ROUND-TRIP — `fromPips(toPips(d, pair), pair)` recovers `|d|` for both
//       JPY and non-JPY pairs, within the helper's one-decimal pip rounding.
//   (2) RESOLVER PARITY — lifting the pip helper out of the resolver left its
//       stored MFE/MAE/direction output BYTE-IDENTICAL. We assert the resolver's
//       output equals an INDEPENDENT reference that reproduces the ORIGINAL
//       inlined `toPips` (JPY 0.01 / others 0.0001, abs magnitude rounded to one
//       decimal) over random forward-candle windows. If the shared helper ever
//       diverged from the original convention, this property would fail — the
//       resolver's MFE/MAE feed live scoring and must not move (R1.1, R12.1).
//
// Validates: Requirements 1.1, 12.1

/** The ORIGINAL inlined pip conversion, duplicated here as an independent oracle. */
function originalToPips(priceDiff: number, pair: Pair): number {
  const isJpy = pair.includes("JPY");
  const pip = isJpy ? 0.01 : 0.0001;
  return Math.round((Math.abs(priceDiff) / pip) * 10) / 10;
}

const FLAT_BAND_FACTOR = 0.5;

/** Independent re-implementation of the resolver's per-horizon math using the oracle `toPips`. */
function referenceResolve(
  analogueDate: string,
  pair: Pair,
  forwardCandles: readonly Candle[],
  atr14: number,
): Record<1 | 2 | 3, { direction: string; mfePips: number; maePips: number }> {
  const forward = [...forwardCandles]
    .filter((c) => c.date > analogueDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const entryClose = forward[0]?.open ?? 0;

  const classify = (netMovePips: number): string => {
    const band = atr14 * FLAT_BAND_FACTOR;
    if (Math.abs(netMovePips) < band) return "FLAT";
    return netMovePips >= 0 ? "UP" : "DOWN";
  };

  const out = {} as Record<1 | 2 | 3, { direction: string; mfePips: number; maePips: number }>;
  for (const h of [1, 2, 3] as const) {
    const slice = forward.slice(0, h);
    const terminalClose = slice[slice.length - 1]?.close ?? entryClose;
    const netMovePips =
      originalToPips(terminalClose - entryClose, pair) * (terminalClose >= entryClose ? 1 : -1);
    const direction = classify(netMovePips);

    let mfe = 0;
    let mae = 0;
    for (const candle of slice) {
      const highDiff = candle.high - entryClose;
      const lowDiff = candle.low - entryClose;
      if (direction === "DOWN") {
        mfe = Math.max(mfe, -lowDiff);
        mae = Math.max(mae, highDiff);
      } else {
        mfe = Math.max(mfe, highDiff);
        mae = Math.max(mae, -lowDiff);
      }
    }
    out[h] = {
      direction,
      mfePips: originalToPips(Math.max(0, mfe), pair),
      maePips: originalToPips(Math.max(0, mae), pair),
    };
  }
  return out;
}

describe("trader-edge-validation Property 1: pip helper round-trip + resolver parity", () => {
  it("fromPips(toPips(d)) recovers |d| within one-decimal pip rounding, JPY and non-JPY", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Pair>(...PAIRS),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (pair, priceDiff) => {
          const recovered = fromPips(toPips(priceDiff, pair), pair);
          // The round-trip error is bounded by half a pip in price terms,
          // since toPips rounds to one decimal pip.
          const tolerance = pipSize(pair) * 0.05 + 1e-12;
          expect(Math.abs(recovered - Math.abs(priceDiff))).toBeLessThanOrEqual(tolerance);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the resolver's stored MFE/MAE/direction are byte-identical to the original inlined convention", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Pair>(...PAIRS),
        fc.double({ min: 0.5, max: 150, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 4 }),
        async (pair, base, atr14, deltas) => {
          const analogueDate = "2024-03-01";
          // Build chronological forward weekday candles strictly after analogueDate.
          const candles: Candle[] = deltas.map((d, i) => {
            const date = `2024-03-${String(4 + i).padStart(2, "0")}`; // 2024-03-04..07 (Mon–Thu)
            const open = base;
            const close = base + d;
            const high = Math.max(open, close) + Math.abs(d) * 0.5;
            const low = Math.min(open, close) - Math.abs(d) * 0.5;
            return { asset: pair, date, open, high, low, close };
          });

          const store = new InMemoryAnalogueStore();
          const result = await resolve(analogueDate, pair, candles, atr14, "2099-01-01", store);
          const reference = referenceResolve(analogueDate, pair, candles, atr14);

          for (const h of [1, 2, 3] as const) {
            const actual = result.perHorizon[h];
            expect(actual.direction).toBe(reference[h].direction);
            expect(actual.mfePips).toBe(reference[h].mfePips);
            expect(actual.maePips).toBe(reference[h].maePips);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
