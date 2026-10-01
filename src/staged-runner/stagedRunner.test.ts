// StagedRunner unit tests — stage delegation and standalone invocation (Task 3.10).
//
// Validates: Requirements 2.1, 2.3, 2.4, 2.5
//
// These are EXAMPLE-BASED unit tests (not property tests). They assert the
// StagedRunner wires its three stages to the existing modules by delegation
// only — no gate math, no pipeline/firing logic is re-derived:
//
//   backtest    (Req 2.3, 2.4) → walkForwardFolds → composeGateVerdict →
//                                 logGateVerdict → RESEARCH-LOG.md append
//   forwardLook (Req 2.5)       → runScheduledDaily → dailyRun (shared path)
//   standalone / runAll (Req 2.1) each stage runs independently and composes.

import { describe, it, expect, vi } from "vitest";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { PairEvaluation } from "../dashboard/index.js";
import type { Confidence } from "../confidence/types.js";
import { LIVING_DOCS } from "../living-docs/livingDocs.js";
import * as killGateVerdict from "../kill-gate/verdict.js";
import * as killGateWalkForward from "../kill-gate/walkForward.js";
import * as scheduledRun from "../scheduled-run/scheduledRun.js";
import { backfill, backtest, forwardLook, runAll } from "./stagedRunner.js";
import {
  buildCsvContent,
  makeTestDeps,
  makeCapturingForwardLookDeps,
  seedVector,
  seedMaturedOutcome,
} from "./testHelpers.js";

/** A chronological run of trading dates long enough to seed candles+vectors. */
const DATES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2015, 0, 5) + i * 86_400_000).toISOString().slice(0, 10),
);

/** Build a full, well-formed PairEvaluation for a pair (fires when gate passes). */
function firingEvaluation(pair: Pair): PairEvaluation {
  return {
    pair,
    gatePassing: true,
    newsSuppressed: false,
    direction: "UP",
    horizon: 1,
    earnedConfidence: 0.9 as Confidence,
    excursionProfile: { favorablePips: 40, adversePips: 10 },
    stopLossPips: 15,
    takeProfitPips: 45,
    rationale: "test rationale",
    analogueLabels: ["a1"],
  };
}

describe("StagedRunner — stage delegation and standalone invocation (Task 3.10)", () => {
  // -------------------------------------------------------------------------
  // backtest: delegates to the kill-gate and appends to RESEARCH-LOG.md
  // (Req 2.3, 2.4). Gate math is NOT re-derived — the verdict is produced
  // through walkForwardFolds → composeGateVerdict → logGateVerdict.
  // -------------------------------------------------------------------------
  describe("backtest delegates to the kill-gate and appends to RESEARCH-LOG.md", () => {
    it("invokes walkForwardFolds and composeGateVerdict rather than re-deriving gate math (Req 2.3)", async () => {
      const deps = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });
      await backfill(deps, "backfill");

      const walkSpy = vi.spyOn(killGateWalkForward, "walkForwardFolds");
      const composeSpy = vi.spyOn(killGateVerdict, "composeGateVerdict");

      const result = await backtest(deps);

      expect(result.ok).toBe(true);
      // The kill-gate path was taken — delegation, not re-implementation.
      expect(walkSpy).toHaveBeenCalled();
      expect(walkSpy.mock.calls[0]?.[0]).toBe("EURUSD");
      expect(composeSpy).toHaveBeenCalledTimes(1);
      // composeGateVerdict is called with the runner's configId.
      expect(composeSpy.mock.calls[0]?.[0]).toBe("test-config");

      walkSpy.mockRestore();
      composeSpy.mockRestore();
    });

    it("appends the verdict to RESEARCH-LOG.md through logGateVerdict (Req 2.4)", async () => {
      const deps = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });
      await backfill(deps, "backfill");

      // Nothing written before backtest runs.
      expect(deps.docStore.peek(LIVING_DOCS.researchLog)).toBeNull();

      const logSpy = vi.spyOn(killGateVerdict, "logGateVerdict");

      const result = await backtest(deps);
      expect(result.ok).toBe(true);

      // The append went through the living-docs writer via logGateVerdict —
      // the entry is NOT hand-built by the runner.
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]?.[0]).toBe(deps.docs);

      // The living-docs writer received a write: RESEARCH-LOG.md now exists and
      // carries a canonical gate verdict entry for the runner's configId.
      const log = deps.docStore.peek(LIVING_DOCS.researchLog);
      expect(log).not.toBeNull();
      expect(log).toContain("test-config");
      // A no-qualifying-fold verdict is a CUT, logged with the canonical entry.
      expect(log).toMatch(/## \[(VERDICT|CUT)\] test-config/);

      logSpy.mockRestore();
    });

    it("aborts with a named missing prerequisite when no candles/vectors are stored (Req 2.3 guard)", async () => {
      const deps = makeTestDeps(); // nothing seeded
      const result = await backtest(deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.missingPrerequisite).toContain("backtest");
      }
      // No RESEARCH-LOG write occurred on the aborted stage.
      expect(deps.docStore.peek(LIVING_DOCS.researchLog)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // forwardLook: delegates to runScheduledDaily → runDailyPipeline with no
  // forked firing logic (Req 2.5). A DashboardView is produced through the real
  // scheduled-run path and observed via the capturing persistView.
  // -------------------------------------------------------------------------
  describe("forwardLook delegates to runScheduledDaily with no forked logic", () => {
    it("calls runScheduledDaily and produces a DashboardView via the shared path (Req 2.5)", async () => {
      const evaluations = [firingEvaluation("EURUSD")];
      const deps = await makeCapturingForwardLookDeps({ evaluations });

      const scheduledSpy = vi.spyOn(scheduledRun, "runScheduledDaily");

      const result = await forwardLook(deps);

      expect(result.ok).toBe(true);
      // Delegation: the shared scheduled-run entry point was called exactly once
      // with the runner's config — the firing logic is NOT reproduced here.
      expect(scheduledSpy).toHaveBeenCalledTimes(1);
      expect(scheduledSpy.mock.calls[0]?.[0]).toBe(deps.config);

      // A DashboardView was produced through dailyRun inside runScheduledDaily
      // and captured by persistView.
      const view = deps.getView();
      expect(view).toBeDefined();
      expect(view?.decisionDate).toBe(deps.config.decisionDate);
      // The firing EURUSD evaluation surfaced as a card through the real path.
      expect(view?.cards.some((c) => c.pair === "EURUSD")).toBe(true);

      scheduledSpy.mockRestore();
    });

    it("aborts with a named missing prerequisite when vectors are absent (Req 2.5 guard)", async () => {
      const deps = makeTestDeps(); // no vectors, no matured outcomes
      const result = await forwardLook(deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.missingPrerequisite).toContain("forwardLook");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Standalone invocation: each stage runs independently given satisfied
  // prerequisites (Req 2.1).
  // -------------------------------------------------------------------------
  describe("each stage runs standalone given satisfied prerequisites (Req 2.1)", () => {
    it("backfill runs standalone and stores candles + vectors", async () => {
      const deps = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });

      const result = await backfill(deps, "backfill");

      expect(result.ok).toBe(true);
      const candles = await deps.ingestion.getCandles("EURUSD");
      const vectors = await deps.vectorStore.getVectorsByAsset("EURUSD");
      expect(candles.length).toBeGreaterThan(0);
      expect(vectors.length).toBeGreaterThan(0);
    });

    it("backtest runs standalone once candles + vectors exist", async () => {
      const deps = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });
      await backfill(deps, "backfill");

      const result = await backtest(deps);

      expect(result.ok).toBe(true);
      expect(deps.docStore.peek(LIVING_DOCS.researchLog)).not.toBeNull();
    });

    it("forwardLook runs standalone once vectors + matured outcomes exist", async () => {
      const deps = await makeCapturingForwardLookDeps({
        evaluations: [firingEvaluation("EURUSD")],
      });

      const result = await forwardLook(deps);

      expect(result.ok).toBe(true);
      expect(deps.getView()).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Composition: runAll composes backfill → backtest → forwardLook (Req 2.1).
  // -------------------------------------------------------------------------
  describe("runAll composes the three stages in order (Req 2.1)", () => {
    it("runs backfill → backtest → forwardLook and produces each stage's side effects", async () => {
      // Seed every pair's CSV so backfill stores candles + vectors, and seed
      // the forwardLook prerequisites (vectors already stored by backfill;
      // matured outcomes seeded explicitly) so all three stages run.
      const csvContents: Partial<Record<Pair, string>> = {};
      for (const pair of PAIRS) {
        csvContents[pair] = buildCsvContent([...DATES]);
      }

      let capturedDecisionDate: string | undefined;
      const deps = makeTestDeps(csvContents);
      // Wire a capturing persistView and seed a matured outcome strictly before
      // the config's Decision_Date so forwardLook's prerequisites are met.
      const priorDate = "2014-12-01";
      for (const pair of PAIRS) {
        await seedVector(deps.vectorStore, pair, priorDate);
        await seedMaturedOutcome(deps.analogueStore, pair, priorDate);
      }
      const runDeps = {
        ...deps,
        persistView: (view: { decisionDate: string }) => {
          capturedDecisionDate = view.decisionDate;
          return Promise.resolve();
        },
      };

      const { stages } = await runAll(runDeps, "backfill");

      // All three stages executed, in canonical order.
      expect(stages.map((s) => s.stage)).toEqual([
        "backfill",
        "backtest",
        "forwardLook",
      ]);
      for (const s of stages) {
        expect(s.result.ok).toBe(true);
      }

      // backtest side effect: RESEARCH-LOG.md was appended to.
      expect(runDeps.docStore.peek(LIVING_DOCS.researchLog)).not.toBeNull();
      // forwardLook side effect: a view was persisted for the Decision_Date.
      expect(capturedDecisionDate).toBe(runDeps.config.decisionDate);
    });

    it("stops the composed run at the first failed stage (Req 2.1 composition)", async () => {
      // No CSV fed and nothing seeded: backfill stores nothing, so backtest's
      // prerequisite check fails and forwardLook never runs.
      const deps = makeTestDeps();

      const { stages } = await runAll(deps, "backfill");

      // backfill ran (ok), backtest ran and failed, forwardLook did NOT run.
      expect(stages.map((s) => s.stage)).toEqual(["backfill", "backtest"]);
      expect(stages[0]?.result.ok).toBe(true);
      expect(stages[1]?.result.ok).toBe(false);
      // forwardLook produced no side effect.
      expect(deps.docStore.peek(LIVING_DOCS.researchLog)).toBeNull();
    });
  });
});
