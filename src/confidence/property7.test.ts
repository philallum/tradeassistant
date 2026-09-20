import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classify } from "./confidenceSelector.js";
import { FLAT_DEAD_BAND_FACTOR } from "./types.js";
import type { DirectionClass } from "../retrieval/types.js";

// Feature: fx-daily-pattern-assistant, Property 7: For all net forward moves and ATR_14 values, classification returns exactly one Direction_Class; the move classifies FLAT if and only if it lies within the ATR_14-scaled dead-band, and UP or DOWN by the sign of the move otherwise.
//
// Validates: Requirements 1.4, 10.5.

const DIRECTION_CLASSES: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"];

/** Finite float arbitrary spanning positive, negative, and zero moves. */
const finiteFloat = fc.float({
  min: Math.fround(-10_000),
  max: Math.fround(10_000),
  noNaN: true,
  noDefaultInfinity: true,
});

describe("Property 7: total, exact direction classification via ATR_14 dead-band", () => {
  it(
    "returns exactly one Direction_Class; FLAT iff within the ATR_14-scaled band, else sign-based UP/DOWN",
    () => {
      fc.assert(
        fc.property(
          finiteFloat, // netMovePips (positive, negative, zero)
          fc.float({
            min: 0,
            max: Math.fround(10_000),
            noNaN: true,
            noDefaultInfinity: true,
          }), // atr14 (including 0)
          (netMovePips, atr14) => {
            const result = classify(netMovePips, atr14);

            // (a) totality — result is always exactly one of "UP"|"DOWN"|"FLAT".
            expect(DIRECTION_CLASSES).toContain(result);

            const band = Math.abs(atr14) * FLAT_DEAD_BAND_FACTOR;
            const magnitude = Math.abs(netMovePips);

            if (magnitude <= band) {
              // (b) FLAT iff |netMovePips| <= band.
              expect(result).toBe("FLAT");
            } else {
              // (c) out of band → sign-based direction.
              expect(result).not.toBe("FLAT");
              expect(result).toBe(netMovePips >= 0 ? "UP" : "DOWN");
            }
          },
        ),
        { numRuns: 200 },
      );
    },
  );
});
