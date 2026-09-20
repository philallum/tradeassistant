import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classify } from "./confidenceSelector.js";
import { FLAT_DEAD_BAND_FACTOR } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 8: For all net moves and positive ATR_14 values, scaling ATR_14 by a positive factor scales the FLAT dead-band boundary by the same factor; the classification boundary is not a fixed pip constant.
//
// Validates: Requirement 10.4

/** Positive, finite ATR_14 values across price-scale and pip-scale magnitudes. */
const atr14Arb: fc.Arbitrary<number> = fc.double({
  min: 1e-6,
  max: 1000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Positive, finite scale factors (both shrinking and growing). */
const scaleArb: fc.Arbitrary<number> = fc.double({
  min: 1e-3,
  max: 1000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Arbitrary finite net move (either sign). */
const netMoveArb: fc.Arbitrary<number> = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

describe("Property 8: FLAT dead-band boundary scales linearly with ATR_14", () => {
  it("scaling ATR_14 by s scales the FLAT boundary by exactly s", () => {
    fc.assert(
      fc.property(atr14Arb, scaleArb, (atr14, s) => {
        const band = atr14 * FLAT_DEAD_BAND_FACTOR;
        const scaledAtr = atr14 * s;
        const scaledBand = scaledAtr * FLAT_DEAD_BAND_FACTOR;

        // A move exactly on the scaled boundary classifies FLAT under atr14*s
        // (inclusive boundary), i.e. the boundary sits at scaledBand.
        expect(classify(scaledBand, scaledAtr)).toBe("FLAT");
        expect(classify(-scaledBand, scaledAtr)).toBe("FLAT");

        // Likewise the original band boundary is FLAT under the original atr14.
        expect(classify(band, atr14)).toBe("FLAT");
        expect(classify(-band, atr14)).toBe("FLAT");
      }),
      { numRuns: 200 },
    );
  });

  it("classification agrees with |move| <= atr14*FACTOR at both atr14 and atr14*s", () => {
    fc.assert(
      fc.property(netMoveArb, atr14Arb, scaleArb, (netMove, atr14, s) => {
        const scaledAtr = atr14 * s;

        for (const a of [atr14, scaledAtr]) {
          const band = a * FLAT_DEAD_BAND_FACTOR;
          const expected =
            Math.abs(netMove) <= band
              ? "FLAT"
              : netMove >= 0
                ? "UP"
                : "DOWN";
          expect(classify(netMove, a)).toBe(expected);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("boundary is proportional to ATR, not a fixed pip constant: larger ATR only turns directional into FLAT", () => {
    fc.assert(
      fc.property(netMoveArb, atr14Arb, scaleArb, (netMove, atr14, s) => {
        // Only consider strictly larger ATR (s > 1), where the band widens.
        const largerAtr = atr14 * (1 + s);

        const small = classify(netMove, atr14);
        const large = classify(netMove, largerAtr);

        // A wider band can only pull a classification toward FLAT, never
        // flip a FLAT into a directional class, and never flip UP<->DOWN.
        if (small === "FLAT") {
          // FLAT at atr14 stays FLAT at any larger ATR.
          expect(large).toBe("FLAT");
        } else {
          // Directional at atr14 -> either stays same direction or becomes FLAT.
          expect(large === small || large === "FLAT").toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
