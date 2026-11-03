// Feature: multi-strategy-confluence-engine, Property 12: Strategy configuration validation
//
// For each configurable strategy factory (Trend, Range, Reversal) the property
// holds that the factory returns a Strategy if and only if the resolved
// configuration satisfies that strategy's documented validity rules, and
// otherwise returns a `ConfigError` (reason "invalid_config") naming an invalid
// parameter and NO strategy instance. The valid/invalid classification is
// re-derived from scratch in this file straight from the acceptance criteria,
// so the property checks each factory against a spec rather than against itself.
//
// The documented constraints (Design "Trend/Range/Reversal", Requirements
// 2.10, 2.11, 4.8, 4.9, 5.9, 5.10):
//   - Trend:    fastPeriod, slowPeriod, slopeWindow are integers >= 1, and
//               fastPeriod < slowPeriod.
//   - Range:    bbPeriod, rsiPeriod are integers >= 2; bbK is finite > 0;
//               oversold, overbought are finite with 0 <= oversold < overbought
//               <= 100.
//   - Reversal: extensionThreshold is finite > 0; baselinePeriod, momentumWindow
//               are integers >= 1.
//
// Validates: Requirements 2.10, 2.11, 4.8, 4.9, 5.9, 5.10

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createTrendStrategy,
  DEFAULT_TREND_CONFIG,
  createRangeStrategy,
  DEFAULT_RANGE_CONFIG,
  createReversalStrategy,
  DEFAULT_REVERSAL_CONFIG,
} from "./index.js";
import type { TrendConfig, RangeConfig, ReversalConfig } from "./index.js";

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Independent validity oracles — from-scratch restatements of the constraints.
// ---------------------------------------------------------------------------

const isInt = (v: number, min: number): boolean =>
  Number.isInteger(v) && v >= min;

function trendValid(c: TrendConfig): boolean {
  return (
    isInt(c.fastPeriod, 1) &&
    isInt(c.slowPeriod, 1) &&
    isInt(c.slopeWindow, 1) &&
    c.fastPeriod < c.slowPeriod
  );
}

function rangeValid(c: RangeConfig): boolean {
  return (
    isInt(c.bbPeriod, 2) &&
    isInt(c.rsiPeriod, 2) &&
    Number.isFinite(c.bbK) &&
    c.bbK > 0 &&
    Number.isFinite(c.oversold) &&
    c.oversold >= 0 &&
    Number.isFinite(c.overbought) &&
    c.overbought <= 100 &&
    c.oversold < c.overbought
  );
}

function reversalValid(c: ReversalConfig): boolean {
  return (
    Number.isFinite(c.extensionThreshold) &&
    c.extensionThreshold > 0 &&
    isInt(c.baselinePeriod, 1) &&
    isInt(c.momentumWindow, 1)
  );
}

// ---------------------------------------------------------------------------
// Numeric building blocks for config fields.
//
// `anyNumber` spans the shapes a value can take: valid integers, non-integers,
// zero, negatives, and non-finite values, so the generated configs land on both
// sides of every boundary and the oracle decides which side.
// ---------------------------------------------------------------------------

const anyNumber: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -5, max: 200 }),
  fc.double({ min: -5, max: 200, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(
    0,
    0.5,
    1,
    1.5,
    2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

/** A field override that is sometimes absent (so defaults are exercised too). */
const optionalNumber: fc.Arbitrary<number | undefined> = fc.option(anyNumber, {
  nil: undefined,
});

// ---------------------------------------------------------------------------
// Candidate (possibly invalid) partial configs, built from optional overrides
// so the merge-with-defaults path is covered. A missing field falls back to the
// default, which is always valid.
// ---------------------------------------------------------------------------

const arbTrendPartial: fc.Arbitrary<Partial<TrendConfig>> = fc
  .record({
    fastPeriod: optionalNumber,
    slowPeriod: optionalNumber,
    slopeWindow: optionalNumber,
  })
  .map((obj) => prune<TrendConfig>(obj));

const arbRangePartial: fc.Arbitrary<Partial<RangeConfig>> = fc
  .record({
    bbPeriod: optionalNumber,
    bbK: optionalNumber,
    rsiPeriod: optionalNumber,
    oversold: optionalNumber,
    overbought: optionalNumber,
  })
  .map((obj) => prune<RangeConfig>(obj));

const arbReversalPartial: fc.Arbitrary<Partial<ReversalConfig>> = fc
  .record({
    extensionThreshold: optionalNumber,
    baselinePeriod: optionalNumber,
    momentumWindow: optionalNumber,
  })
  .map((obj) => prune<ReversalConfig>(obj));

/**
 * Drop `undefined`-valued keys so the merge truly falls back to the default.
 * Returning a `Partial<T>` with the `undefined`-valued keys removed keeps the
 * result assignable under `exactOptionalPropertyTypes`.
 */
function prune<T>(obj: Record<keyof T, number | undefined>): Partial<T> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v as number;
  }
  return out as Partial<T>;
}

// ---------------------------------------------------------------------------
// The property, run uniformly for all three configurable strategies.
// ---------------------------------------------------------------------------

describe("Property 12: Strategy configuration validation", () => {
  it("Trend factory accepts exactly the valid configs and names the bad parameter otherwise", () => {
    fc.assert(
      fc.property(arbTrendPartial, (partial) => {
        const resolved: TrendConfig = { ...DEFAULT_TREND_CONFIG, ...partial };
        const result = createTrendStrategy(partial);

        if (trendValid(resolved)) {
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // The frozen config matches the merged values.
          expect(result.value.config).toEqual(resolved);
          expect(Object.isFrozen(result.value.config)).toBe(true);
          expect(result.value.id).toBe("trend");
        } else {
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("invalid_config");
          expect(["fastPeriod", "slowPeriod", "slopeWindow"]).toContain(
            result.error.parameter,
          );
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("Range factory accepts exactly the valid configs and names the bad parameter otherwise", () => {
    fc.assert(
      fc.property(arbRangePartial, (partial) => {
        const resolved: RangeConfig = { ...DEFAULT_RANGE_CONFIG, ...partial };
        const result = createRangeStrategy(partial);

        if (rangeValid(resolved)) {
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.config).toEqual(resolved);
          expect(Object.isFrozen(result.value.config)).toBe(true);
          expect(result.value.id).toBe("range");
        } else {
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("invalid_config");
          expect([
            "bbPeriod",
            "bbK",
            "rsiPeriod",
            "oversold",
            "overbought",
          ]).toContain(result.error.parameter);
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("Reversal factory accepts exactly the valid configs and names the bad parameter otherwise", () => {
    fc.assert(
      fc.property(arbReversalPartial, (partial) => {
        const resolved: ReversalConfig = {
          ...DEFAULT_REVERSAL_CONFIG,
          ...partial,
        };
        const result = createReversalStrategy(partial);

        if (reversalValid(resolved)) {
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.config).toEqual(resolved);
          expect(Object.isFrozen(result.value.config)).toBe(true);
          expect(result.value.id).toBe("reversal");
        } else {
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("invalid_config");
          expect([
            "extensionThreshold",
            "baselinePeriod",
            "momentumWindow",
          ]).toContain(result.error.parameter);
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("an invalid factory call creates no instance and does not disturb a later valid call", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbTrendPartial),
        fc.oneof(arbRangePartial),
        fc.oneof(arbReversalPartial),
        (trendPartial, rangePartial, reversalPartial) => {
          // Fire a deliberately invalid config first (fastPeriod >= slowPeriod),
          // then confirm a subsequent valid default call is unaffected.
          const bad = createTrendStrategy({ fastPeriod: 50, slowPeriod: 10 });
          expect(bad.ok).toBe(false);

          // Whatever the random partials resolve to, a default call must always
          // succeed and yield the documented default config.
          const good = createTrendStrategy();
          expect(good.ok).toBe(true);
          if (good.ok) {
            expect(good.value.config).toEqual(DEFAULT_TREND_CONFIG);
          }

          // The random partials merely exercise the factories; their results
          // must be internally consistent with the oracle (same as above).
          const t = createTrendStrategy(trendPartial);
          expect(t.ok).toBe(
            trendValid({ ...DEFAULT_TREND_CONFIG, ...trendPartial }),
          );
          const r = createRangeStrategy(rangePartial);
          expect(r.ok).toBe(
            rangeValid({ ...DEFAULT_RANGE_CONFIG, ...rangePartial }),
          );
          const v = createReversalStrategy(reversalPartial);
          expect(v.ok).toBe(
            reversalValid({ ...DEFAULT_REVERSAL_CONFIG, ...reversalPartial }),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
