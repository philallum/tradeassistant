import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { derive } from "./empiricalRiskBoundaries.js";
import {
  DEFAULT_STOP_LOSS_PERCENTILE,
  DEFAULT_TAKE_PROFIT_PERCENTILE,
  RISK_BOUNDARY_FLOOR,
  type Horizon,
} from "./types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import { PAIRS } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 38: For all firing neighborhoods with at least 30 analogues, Stop_Loss equals the configured percentile (default 75th) of neighborhood MAE and Take_Profit equals the configured percentile (default 50th) of neighborhood MFE, computed deterministically with no LLM input; for neighborhoods below the floor, the boundaries are not surfaced as actionable.
//
// Validates: Requirements 21.1, 21.2, 21.3, 21.5

/**
 * Independent reference implementation of the documented percentile method:
 * linear interpolation between closest ranks (numpy.percentile default /
 * Excel PERCENTILE.INC). This is deliberately written from scratch (not a call
 * to the module's `percentile` export) so the value assertions genuinely
 * validate the implementation rather than tautologically agreeing with it.
 *
 *   rank = (clamp(p, 0, 100) / 100) * (n - 1)
 *   result = x[floor(rank)] + (rank - floor(rank)) * (x[ceil(rank)] - x[floor(rank)])
 *
 * Edge behavior: p<=0 -> min, p>=100 -> max, n===1 -> the single value.
 */
function oraclePercentile(values: readonly number[], p: number): number {
  const n = values.length;
  if (n === 0) throw new Error("oracle percentile requires a non-empty sample");
  const sorted = values.slice().sort((a, b) => a - b);
  if (n === 1) return sorted[0]!;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"];
const HORIZONS: readonly Horizon[] = [1, 2, 3];

/** A generator for a single AnalogueRecord at a fixed horizon. */
function recordArb(horizon: Horizon): fc.Arbitrary<AnalogueRecord> {
  return fc.record({
    asset: fc.constantFrom(...PAIRS),
    decisionDate: fc
      .integer({ min: 0, max: 9000 })
      .map(
        (offset) =>
          new Date(Date.UTC(2000, 0, 1) + offset * 86_400_000)
            .toISOString()
            .slice(0, 10),
      ),
    horizon: fc.constant(horizon),
    direction: fc.constantFrom(...DIRECTIONS),
    mfePips: fc.double({ min: 0, max: 500, noNaN: true }),
    maePips: fc.double({ min: 0, max: 500, noNaN: true }),
    atr14: fc.double({ min: 0.1, max: 50, noNaN: true }),
    matured: fc.constant(true),
  });
}

/** Build a percentile config from a raw pair (0..100). */
const percentileArb = fc.double({ min: 0, max: 100, noNaN: true });

describe("Property 38: empirical risk boundaries", () => {
  it("stop-loss and take-profit equal the default percentiles of horizon MAE/MFE", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HORIZONS),
        fc.array(fc.constantFrom(...HORIZONS), { minLength: 0, maxLength: 30 }),
        (selected, extraHorizons) => {
          // >= 30 analogues at the selected horizon, plus arbitrary other-horizon rows.
          return fc.assert(
            fc.property(
              fc.array(recordArb(selected), {
                minLength: RISK_BOUNDARY_FLOOR,
                maxLength: RISK_BOUNDARY_FLOOR + 40,
              }),
              (selectedRows) => {
                const otherRows = extraHorizons
                  .filter((h) => h !== selected)
                  .map(
                    (h, i): AnalogueRecord => ({
                      asset: PAIRS[0],
                      decisionDate: `1999-01-${String((i % 28) + 1).padStart(2, "0")}`,
                      horizon: h,
                      direction: "UP",
                      // Extreme values that would skew percentiles if wrongly counted.
                      mfePips: 100_000,
                      maePips: 100_000,
                      atr14: 1,
                      matured: true,
                    }),
                  );
                const neighborhood = [...selectedRows, ...otherRows];

                const result = derive(neighborhood, selected);
                expect(result).not.toBeNull();

                const mae = selectedRows.map((r) => r.maePips);
                const mfe = selectedRows.map((r) => r.mfePips);
                expect(result!.stopLossPips).toBeCloseTo(
                  oraclePercentile(mae, DEFAULT_STOP_LOSS_PERCENTILE),
                  8,
                );
                expect(result!.takeProfitPips).toBeCloseTo(
                  oraclePercentile(mfe, DEFAULT_TAKE_PROFIT_PERCENTILE),
                  8,
                );
              },
            ),
            { numRuns: 4 },
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("matches the oracle at arbitrary configured percentiles", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HORIZONS),
        fc.array(recordArb(1), {
          minLength: RISK_BOUNDARY_FLOOR,
          maxLength: RISK_BOUNDARY_FLOOR + 50,
        }),
        percentileArb,
        percentileArb,
        (selected, baseRows, slp, tpp) => {
          // Re-tag all rows to the selected horizon.
          const rows = baseRows.map((r) => ({ ...r, horizon: selected }));
          const result = derive(rows, selected, {
            stopLossPercentile: slp,
            takeProfitPercentile: tpp,
          });
          expect(result).not.toBeNull();

          const mae = rows.map((r) => r.maePips);
          const mfe = rows.map((r) => r.mfePips);
          expect(result!.stopLossPips).toBeCloseTo(oraclePercentile(mae, slp), 8);
          expect(result!.takeProfitPips).toBeCloseTo(
            oraclePercentile(mfe, tpp),
            8,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("returns null (not actionable) below the 30-analogue floor at the selected horizon", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HORIZONS),
        fc.integer({ min: 0, max: RISK_BOUNDARY_FLOOR - 1 }),
        fc.array(fc.constantFrom(...HORIZONS), { minLength: 0, maxLength: 40 }),
        (selected, belowCount, otherHorizonSpecs) => {
          return fc.assert(
            fc.property(
              fc.array(recordArb(selected), {
                minLength: belowCount,
                maxLength: belowCount,
              }),
              (selectedRows) => {
                // Add abundant analogues at OTHER horizons — they must not lift
                // the selected-horizon count over the floor.
                const otherRows = otherHorizonSpecs
                  .filter((h) => h !== selected)
                  .map(
                    (h, i): AnalogueRecord => ({
                      asset: PAIRS[0],
                      decisionDate: `1998-06-${String((i % 28) + 1).padStart(2, "0")}`,
                      horizon: h,
                      direction: "DOWN",
                      mfePips: 42,
                      maePips: 42,
                      atr14: 1,
                      matured: true,
                    }),
                  );
                const neighborhood = [...selectedRows, ...otherRows];
                expect(derive(neighborhood, selected)).toBeNull();
              },
            ),
            { numRuns: 4 },
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("is deterministic and pure: identical input yields identical output across repeated calls", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HORIZONS),
        fc.array(recordArb(1), {
          minLength: RISK_BOUNDARY_FLOOR,
          maxLength: RISK_BOUNDARY_FLOOR + 30,
        }),
        percentileArb,
        percentileArb,
        (selected, baseRows, slp, tpp) => {
          const rows = baseRows.map((r) => ({ ...r, horizon: selected }));
          const config = { stopLossPercentile: slp, takeProfitPercentile: tpp };
          const first = derive(rows, selected, config);
          const second = derive(rows, selected, config);
          expect(second).toEqual(first);
          if (first !== null) {
            // Bit-for-bit stability, not just close: pure numeric computation.
            expect(second!.stopLossPips).toBe(first.stopLossPips);
            expect(second!.takeProfitPips).toBe(first.takeProfitPips);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("uses only selected-horizon rows: other-horizon analogues do not affect the boundaries", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HORIZONS),
        fc.array(recordArb(1), {
          minLength: RISK_BOUNDARY_FLOOR,
          maxLength: RISK_BOUNDARY_FLOOR + 30,
        }),
        fc.array(fc.constantFrom(...HORIZONS), { minLength: 0, maxLength: 40 }),
        (selected, baseRows, otherHorizonSpecs) => {
          const selectedRows = baseRows.map((r) => ({ ...r, horizon: selected }));
          const withoutOthers = derive(selectedRows, selected);

          const otherRows = otherHorizonSpecs
            .filter((h) => h !== selected)
            .map(
              (h, i): AnalogueRecord => ({
                asset: PAIRS[0],
                decisionDate: `1997-03-${String((i % 28) + 1).padStart(2, "0")}`,
                horizon: h,
                direction: "FLAT",
                mfePips: 99_999,
                maePips: 99_999,
                atr14: 1,
                matured: true,
              }),
            );

          const withOthers = derive([...selectedRows, ...otherRows], selected);
          expect(withOthers).toEqual(withoutOthers);
        },
      ),
      { numRuns: 200 },
    );
  });
});
