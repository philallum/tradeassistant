import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { TradeLedgerRow } from "../trade-ledger/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  calibrate,
  DEFAULT_OVERLAP_WINDOW_DAYS,
} from "./calibration.js";

// Feature: trader-edge-validation, Property (task 11.1): Calibration.
//
//   (a) a synthetic set with KNOWN resolution rates reproduces the expected band
//       rates (R6.1);
//   (b) the overlap adjustment LOWERS the effective sample size when a band's
//       forecasts share windows / adjacent Decision_Dates (R6.4);
//   (c) effectiveSampleSize is always ≤ forecastCount and ambiguous/expired rows
//       never count toward the decided denominator.
//
// Validates: Requirements 6.1, 6.4

const PAIR: Pair = "EURUSD";

/** A decided row in a given confidence band resolving win (target) or loss (stop). */
function row(
  decisionDate: string,
  confidence: number,
  win: boolean,
  overrides: Partial<TradeLedgerRow> = {},
): TradeLedgerRow {
  return {
    strategyId: "system",
    pair: PAIR,
    decisionDate,
    fired: true,
    direction: "UP",
    horizon: 2,
    earnedConfidence: confidence,
    entryPrice: 1.1,
    entryDate: addDays(decisionDate, 1),
    stopLossPips: 20,
    takeProfitPips: 40,
    outcome: win ? "target_first" : "stop_first",
    grossPips: win ? 40 : -20,
    costPips: 1,
    netPips: win ? 39 : -21,
    rMultiple: win ? 2 : -1,
    ...overrides,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("Calibration (R6.1, R6.4)", () => {
  it("(a) reproduces a known realized rate within a single band", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (wins, losses) => {
          fc.pre(wins + losses > 0);
          // All forecasts in the [0.60,0.65) band; dates far apart (independent).
          const rows: TradeLedgerRow[] = [];
          let day = 0;
          for (let i = 0; i < wins; i += 1, day += 100)
            rows.push(row(addDays("2024-01-01", day), 0.62, true));
          for (let i = 0; i < losses; i += 1, day += 100)
            rows.push(row(addDays("2024-01-01", day), 0.62, false));

          const report = calibrate(rows);
          expect(report.bands).toHaveLength(1);
          const band = report.bands[0]!;
          expect(band.lo).toBeCloseTo(0.6, 10);
          expect(band.hi).toBeCloseTo(0.65, 10);
          expect(band.forecastCount).toBe(wins + losses);
          expect(band.realizedCorrectRate).toBeCloseTo(wins / (wins + losses), 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(b) overlap LOWERS the effective sample size for adjacent dates", () => {
    // Ten decided forecasts in one band, one trading day apart (fully overlapping
    // windows). Independent spacing (far apart) must yield a higher effective N.
    const adjacent: TradeLedgerRow[] = [];
    const spread: TradeLedgerRow[] = [];
    for (let i = 0; i < 10; i += 1) {
      adjacent.push(row(addDays("2024-01-01", i), 0.62, i % 2 === 0));
      spread.push(row(addDays("2024-01-01", i * 200), 0.62, i % 2 === 0));
    }

    const adjReport = calibrate(adjacent);
    const spreadReport = calibrate(spread);

    const adjEff = adjReport.bands[0]!.effectiveSampleSize;
    const spreadEff = spreadReport.bands[0]!.effectiveSampleSize;

    // Same raw count, but overlap discounts the adjacent set.
    expect(adjReport.bands[0]!.forecastCount).toBe(10);
    expect(spreadReport.bands[0]!.forecastCount).toBe(10);
    expect(adjEff).toBeLessThan(spreadEff);
    // Adjacent (1-day gaps, window 60) ⇒ heavily discounted toward ~1.15.
    expect(adjEff).toBeLessThan(10);
    expect(adjEff).toBeGreaterThanOrEqual(1);
    // Spread 200 days apart ≥ window ⇒ each fully independent ⇒ ~10.
    expect(spreadEff).toBeCloseTo(10, 6);
  });

  it("(c) effectiveSampleSize ≤ forecastCount; undecided rows are excluded", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dayOffset: fc.integer({ min: 0, max: 500 }),
            confidence: fc.double({ min: 0.5, max: 0.95, noNaN: true }),
            outcome: fc.constantFrom(
              "target_first" as const,
              "stop_first" as const,
              "expired" as const,
              "ambiguous" as const,
            ),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        (specs) => {
          const seen = new Set<string>();
          const rows: TradeLedgerRow[] = [];
          for (const s of specs) {
            const date = addDays("2024-01-01", s.dayOffset);
            if (seen.has(date)) continue;
            seen.add(date);
            const win = s.outcome === "target_first";
            rows.push(
              row(date, s.confidence, win, { outcome: s.outcome, grossPips: 0, netPips: 0 }),
            );
          }

          const report = calibrate(rows);
          const decidedCount = rows.filter(
            (r) => r.outcome === "target_first" || r.outcome === "stop_first",
          ).length;
          const bandDecided = report.bands.reduce((s, b) => s + b.forecastCount, 0);
          expect(bandDecided).toBe(decidedCount);

          for (const band of report.bands) {
            expect(band.effectiveSampleSize).toBeLessThanOrEqual(band.forecastCount + 1e-9);
            expect(band.effectiveSampleSize).toBeGreaterThan(0);
            expect(band.realizedCorrectRate).toBeGreaterThanOrEqual(0);
            expect(band.realizedCorrectRate).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reports monotonic and wellCalibrated as independent flags (R6.2, R6.1)", () => {
    // Two bands: lower band resolves worse than the higher ⇒ monotonic true.
    const rows: TradeLedgerRow[] = [];
    // [0.55,0.60): midpoint 0.575, realized 0.5 (within default tol 0.1).
    rows.push(row(addDays("2024-01-01", 0), 0.57, true));
    rows.push(row(addDays("2024-01-01", 100), 0.57, false));
    // [0.90,0.95): midpoint 0.925, realized 1.0 (within tol 0.1), higher rate.
    rows.push(row(addDays("2024-01-01", 200), 0.92, true));
    rows.push(row(addDays("2024-01-01", 300), 0.92, true));

    const report = calibrate(rows);
    expect(report.bands).toHaveLength(2);
    expect(report.monotonic).toBe(true);
    expect(report.wellCalibrated).toBe(true);
    expect(DEFAULT_OVERLAP_WINDOW_DAYS).toBe(60);
  });

  it("flags a non-monotonic set (higher band resolves worse)", () => {
    const rows: TradeLedgerRow[] = [];
    // low band high rate, high band low rate ⇒ not monotonic.
    rows.push(row(addDays("2024-01-01", 0), 0.57, true));
    rows.push(row(addDays("2024-01-01", 100), 0.57, true));
    rows.push(row(addDays("2024-01-01", 200), 0.92, false));
    rows.push(row(addDays("2024-01-01", 300), 0.92, false));
    const report = calibrate(rows);
    expect(report.monotonic).toBe(false);
  });
});
