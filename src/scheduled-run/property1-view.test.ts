// Feature: fx-daily-pattern-assistant, Property 1 (view scope): For all identical fixed storage, a scheduled unattended run produces the same view as an equivalent local run.
//
// Validates: Requirements 3.1, 16.4, 16.7
//
// The scheduled runner is deterministic: it loads the per-pair evaluations for
// a Decision_Date from storage and produces the dashboard view via the EXACT
// shared `dailyRun` entry point (see src/scheduled-run/scheduledRun.ts). This
// property checks the view-scope claim across arbitrary fixed inputs:
//
//   1. A scheduled unattended run over fixed storage produces a `view` that
//      deeply equals a direct local `dailyRun(decisionDate, evaluations, config)`
//      over the same inputs.
//   2. Two scheduled runs over identical fixed storage produce identical views
//      (reproducibility, Requirements 16.7 / 3.1).
//
// The loader is a pure in-memory fake — no network or DB is touched — which is
// exactly what "fixed storage" means here.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  type DashboardConfig,
} from "../dashboard/index.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { TradingDate } from "../guard/types.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import type { ScheduledRunConfig } from "./config.js";
import { runScheduledDaily } from "./scheduledRun.js";

const SUPABASE: SupabaseConfig = {
  target: "hosted",
  url: "https://pooler.example.supabase.co",
  key: "test-key",
};

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;
const HORIZONS: readonly Horizon[] = [1, 2, 3] as const;

/** An arbitrary, deterministic PairEvaluation for a given pair. */
function evaluationArb(pair: Pair): fc.Arbitrary<PairEvaluation> {
  return fc.record({
    pair: fc.constant(pair),
    earnedConfidence: fc
      .double({ min: 0, max: 1, noNaN: true })
      .map((c) => c as Confidence),
    direction: fc.constantFrom(...DIRECTIONS),
    horizon: fc.constantFrom(...HORIZONS),
    excursionProfile: fc.record({
      favorablePips: fc.double({ min: 0, max: 500, noNaN: true }),
      adversePips: fc.double({ min: 0, max: 500, noNaN: true }),
    }),
    stopLossPips: fc.option(fc.double({ min: 1, max: 200, noNaN: true }), {
      nil: null,
    }),
    takeProfitPips: fc.option(fc.double({ min: 1, max: 200, noNaN: true }), {
      nil: null,
    }),
    choppiness: fc.double({ min: 0, max: 1, noNaN: true }),
    rationale: fc.string(),
    analogueLabels: fc.array(fc.string(), { maxLength: 4 }),
  });
}

/**
 * Arbitrary set of fixed evaluations: a subset of the five pairs (order
 * shuffled and some pairs possibly absent), so the runner and the local call
 * see the same "fixed storage" including partial coverage.
 */
const evaluationsArb: fc.Arbitrary<readonly PairEvaluation[]> = fc
  .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
  .chain((pairs) =>
    fc.tuple(...pairs.map((pair) => evaluationArb(pair))),
  );

/** An arbitrary Decision_Date in the supported YYYY-MM-DD range. */
const decisionDateArb: fc.Arbitrary<TradingDate> = fc
  .integer({ min: 0, max: 9131 })
  .map((days) =>
    new Date(Date.UTC(2000, 0, 1) + days * 86_400_000).toISOString().slice(0, 10),
  );

/** An arbitrary DashboardConfig so the property holds for any tuning. */
const configArb: fc.Arbitrary<DashboardConfig> = fc.record({
  confidenceThreshold: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Build a scheduled-run config for a Decision_Date over the fixed store. */
function scheduledConfig(decisionDate: TradingDate): ScheduledRunConfig {
  return {
    decisionDate,
    supabase: SUPABASE,
    gcpProject: undefined,
    gcpRegion: undefined,
    geminiModel: undefined,
  };
}

describe("Property 1 (view scope): scheduled run reproduces the equivalent local run", () => {
  it("produces a view deeply equal to a direct local dailyRun over the same fixed storage", async () => {
    await fc.assert(
      fc.asyncProperty(
        decisionDateArb,
        evaluationsArb,
        configArb,
        async (decisionDate, evaluations, config) => {
          // Fixed storage: the loader returns the same evaluations verbatim.
          const scheduled = await runScheduledDaily(scheduledConfig(decisionDate), {
            loadEvaluations: () => Promise.resolve(evaluations),
            dashboardConfig: config,
          });

          const local = dailyRun(decisionDate, evaluations, config);

          expect(scheduled.view).toEqual(local);
          expect(scheduled.decisionDate).toBe(decisionDate);
        },
      ),
      { numRuns: 250 },
    );
  });

  it("is reproducible: two scheduled runs over identical fixed storage yield identical views", async () => {
    await fc.assert(
      fc.asyncProperty(
        decisionDateArb,
        evaluationsArb,
        configArb,
        async (decisionDate, evaluations, config) => {
          const loader = () => Promise.resolve(evaluations);
          const cfg = scheduledConfig(decisionDate);

          const first = await runScheduledDaily(cfg, {
            loadEvaluations: loader,
            dashboardConfig: config,
          });
          const second = await runScheduledDaily(cfg, {
            loadEvaluations: loader,
            dashboardConfig: config,
          });

          expect(second.view).toEqual(first.view);
        },
      ),
      { numRuns: 250 },
    );
  });

  it("uses the shared default config path consistently with a local default run", async () => {
    await fc.assert(
      fc.asyncProperty(decisionDateArb, evaluationsArb, async (decisionDate, evaluations) => {
        const scheduled = await runScheduledDaily(scheduledConfig(decisionDate), {
          loadEvaluations: () => Promise.resolve(evaluations),
        });

        const local = dailyRun(decisionDate, evaluations, {
          confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        });

        expect(scheduled.view).toEqual(local);
      }),
      { numRuns: 200 },
    );
  });
});
