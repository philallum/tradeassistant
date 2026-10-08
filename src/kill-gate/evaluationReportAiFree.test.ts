import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  InMemoryBlockedScoringInputRecorder,
  LlmOnScoringPathError,
  ScoringInputGuard,
  type Clock,
  type Deterministic,
} from "../llm/scoringInputGuard.js";
import {
  InMemoryRoleRejectionRecorder,
  SANCTIONED_ROLES,
  isLlmTagged,
  type LlmTagged,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import {
  LlmInterface,
  tagLlmOutput,
  type Clock as LlmClock,
  type LlmProvider,
} from "../llm/llmInterface.js";
import { generatePatternDescription, generateSignalRationale } from "../rationale/rationale.js";
import type { AnalogueSummary, SignalNumericInputs } from "../rationale/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import { composeEvaluationReport, type FoldGateInput } from "./verdict.js";
import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type EvaluationSplit,
  type Gate1FiringSample,
} from "./types.js";

// Feature: simplify-to-cloud-minimal, subtask 1.2 — AI-never-scores guard over
// the new evaluation path.
//
// Validates: Requirement 1.7
//
// This mirrors the parent "AI-free-scoring guardrail" (property4-aiFreeScoring),
// retargeted at `composeEvaluationReport`. It asserts no LLM output can reach
// the Measurement_Engine or any Evaluation_Report metric:
//
//   Clause A: the runtime ScoringInputGuard BLOCKS and RECORDS any LLM-tagged
//     value handed to the report path (`composeEvaluationReport`), before it
//     could flow into a report metric.
//   Clause B: generating display-only rationale / analogue labels (LlmTagged<…>)
//     leaves the EvaluationReport BYTE-IDENTICAL — LLM output has zero effect on
//     any measured metric.
//   Clause C: the compile-time `Deterministic<T>` exclusion refuses an
//     LlmTagged argument at a report-metric boundary.

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };
const fixedLlmClock: LlmClock = { now: () => "2020-01-01T00:00:00.000Z" };

const FIXED_SPLIT: EvaluationSplit = {
  trainEnd: "2018-12-31",
  testStart: "2019-01-01",
  testEnd: "2019-12-31",
};

// --- generators ------------------------------------------------------------

const sanctionedRole = (): fc.Arbitrary<SanctionedRole> =>
  fc.constantFrom(...SANCTIONED_ROLES);

const taggedPayload = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.string(),
    fc.array(fc.string()),
    fc.double({ noNaN: true }),
    fc.integer(),
    fc.boolean(),
  );

/** An arbitrary LLM-tagged value carrying the real, unforgeable provenance brand. */
const llmTaggedValue = (): fc.Arbitrary<LlmTagged<unknown>> =>
  fc.tuple(taggedPayload(), sanctionedRole()).map(([payload, role]) =>
    tagLlmOutput(payload, role, "2020-01-01T00:00:00.000Z"),
  );

/** The report-path / metric labels the guard records a block against. */
const reportPath = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    "composeEvaluationReport",
    "modelAccuracy",
    "baselineAccuracy",
    "deltaVsBaseline",
    "frictionAdjustedModel",
    "mfeMaeSummary",
  );

// --- offline fake LLM ------------------------------------------------------

function fakeProvider(): LlmProvider {
  const canned: RoleOutput = {
    news_filter: { level: "none", reason: "" },
    signal_rationale: "Weekly trend up; strong analogue resolution over 2 days.",
    pattern_description: ["V-reversal", "range breakout"],
    research_assistant: "",
  };
  return {
    complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> {
      void input;
      return Promise.resolve(canned[role]);
    },
  };
}

function makeLlm(): LlmInterface {
  return new LlmInterface({
    provider: fakeProvider(),
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedLlmClock,
  });
}

// --- fold builder (one qualifying fold with fixed, AI-free inputs) ---------

function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

function buildFold(pair: Pair, horizon: Horizon): FoldGateInput {
  const size = GATE1_SAMPLE_SIZE_FLOOR + 5;
  const firingSubset: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    firingSubset.push({
      decisionDate: `2019-01-${String((i % 28) + 1).padStart(2, "0")}`,
      modelPrediction: "UP",
      baselinePrediction: "DOWN",
      actual: "UP",
      confidence: 0.72,
    });
  }
  const model = outcomeWith(50, 5);
  const baseline = outcomeWith(5, 50);
  return {
    foldIndex: 0,
    pair,
    horizon,
    firingSubset,
    modelOutcomes: firingSubset.map(() => model),
    baselineOutcomes: firingSubset.map(() => baseline),
  };
}

// --- Clause A — blocked + recorded on the report path ----------------------

describe("subtask 1.2 (Req 1.7): LLM-tagged values never reach composeEvaluationReport or a report metric", () => {
  it("blocks and RECORDS every LLM-tagged value on the evaluation-report path (guard() => err)", () => {
    fc.assert(
      fc.property(llmTaggedValue(), reportPath(), (tagged, path) => {
        const recorder = new InMemoryBlockedScoringInputRecorder();
        const guard = new ScoringInputGuard({ recorder, clock: fixedClock });

        const result = guard.guard(tagged, path);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(recorder.size).toBe(1);
        expect(recorder.all()[0]?.scoringPath).toBe(path);
        expect(result.error).toBe(recorder.all()[0]);
      }),
      { numRuns: 200 },
    );
  });

  it("fail-loud: assertClean throws on an LLM-tagged value bound for a report metric", () => {
    fc.assert(
      fc.property(llmTaggedValue(), reportPath(), (tagged, path) => {
        const recorder = new InMemoryBlockedScoringInputRecorder();
        const guard = new ScoringInputGuard({ recorder, clock: fixedClock });

        let thrown: unknown;
        try {
          guard.assertClean(tagged, path);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(LlmOnScoringPathError);
        expect(recorder.size).toBe(1);
        expect((thrown as LlmOnScoringPathError).blocked).toBe(recorder.all()[0]);
      }),
      { numRuns: 200 },
    );
  });
});

// --- Clause B — report unchanged by any LLM generation ---------------------

describe("subtask 1.2 (Req 1.7): generating rationale / labels leaves the EvaluationReport identical", () => {
  const numericInputs: SignalNumericInputs = {
    pattern: "pattern-42",
    trendContext: "UP",
    structuralLiquidityDistancePips: 12.5,
    selectedHorizon: 2,
    direction: "UP",
    earnedConfidence: 0.71 as Confidence,
  };

  const analogues: readonly AnalogueSummary[] = [
    { decisionDate: "2019-06-01", direction: "UP", horizon: 2, mfePips: 40, maePips: 8 },
    { decisionDate: "2019-07-15", direction: "UP", horizon: 2, mfePips: 33, maePips: 12 },
  ];

  it("composeEvaluationReport is byte-identical before vs after rationale / label generation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        async (pair, horizon) => {
          const llm = makeLlm();
          const folds = [buildFold(pair, horizon)];

          const before = composeEvaluationReport("cfg-aifree", folds, FIXED_SPLIT);

          const rationale = await generateSignalRationale(llm, numericInputs);
          const labels = await generatePatternDescription(llm, analogues);
          expect(isLlmTagged(rationale)).toBe(true);
          expect(isLlmTagged(labels)).toBe(true);

          const after = composeEvaluationReport("cfg-aifree", folds, FIXED_SPLIT);
          expect(JSON.stringify(after)).toBe(JSON.stringify(before));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Clause C — compile-time exclusion at a report-metric boundary ---------

describe("subtask 1.2 (Req 1.7): Deterministic<T> excludes LLM-tagged values from report metrics", () => {
  it("a report-metric parameter typed Deterministic<T> refuses an LlmTagged argument", () => {
    // Models a report-metric sink that structurally cannot accept LLM output.
    function recordReportMetric<T>(value: Deterministic<T>): T {
      return value;
    }

    const tagged = tagLlmOutput(0.9, "signal_rationale", "2020-01-01T00:00:00.000Z");
    const cleanMetric = 0.42;

    expect(recordReportMetric(cleanMetric)).toBe(0.42);

    // @ts-expect-error an LlmTagged value is `never` as a Deterministic<T> param.
    recordReportMetric(tagged);

    // Runtime cross-check: the same value is caught by the runtime guard.
    const recorder = new InMemoryBlockedScoringInputRecorder();
    const guard = new ScoringInputGuard({ recorder, clock: fixedClock });
    expect(guard.guard(tagged, "deltaVsBaseline").ok).toBe(false);
    expect(recorder.size).toBe(1);
  });
});
