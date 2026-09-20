import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  InMemoryBlockedScoringInputRecorder,
  LlmOnScoringPathError,
  ScoringInputGuard,
  type Clock,
  type Deterministic,
} from "./scoringInputGuard.js";
import {
  InMemoryRoleRejectionRecorder,
  SANCTIONED_ROLES,
  isLlmTagged,
  type LlmTagged,
  type SanctionedRole,
} from "./types.js";
import {
  LlmInterface,
  tagLlmOutput,
  type Clock as LlmClock,
  type LlmProvider,
} from "./llmInterface.js";
import type { RoleInput, RoleOutput } from "./types.js";
import { earnedConfidence } from "../confidence/confidenceSelector.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import { composeGateVerdict, type FoldGateInput } from "../kill-gate/verdict.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "../kill-gate/types.js";
import type { AnalogueRecord, DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import { generatePatternDescription, generateSignalRationale } from "../rationale/rationale.js";
import type { AnalogueSummary, SignalNumericInputs } from "../rationale/types.js";

// Feature: fx-daily-pattern-assistant, Property 4: For all LLM-tagged values, no such value reaches the directional-probability computation or the Kill_Gate verdict computation; any attempt is blocked and recorded, and the deterministic computations proceed unchanged; equivalently, generating rationale/analogue labels leaves the numeric probability and verdict identical.
//
// Validates: Requirements 2.1, 2.2, 2.6, 2.7, 15.2, 15.4
//
// This is the MANDATED NAMED test — the "AI-free-scoring guardrail". It is the
// automated third pillar of the AI / Deterministic boundary (Design "The AI /
// Deterministic Boundary"), alongside the compile-time type exclusion
// (`Deterministic<T>`) and the runtime `ScoringInputGuard`. It asserts three
// clauses of Property 4 across >=100 generated cases:
//
//   Clause A (blocked + recorded, Req 2.1, 2.2, 2.6): for arbitrary LLM-tagged
//     values, handing one to the guard on a scoring / verdict path is BLOCKED
//     (guard() => err / assertClean() throws) AND the attempt is RECORDED in the
//     injected recorder — before the rejection surfaces.
//
//   Clause B (deterministic unchanged, Req 2.7, 15.2, 15.4): the directional
//     probability (`earnedConfidence`) and the Kill_Gate verdict
//     (`composeGateVerdict`) produce BYTE-IDENTICAL results regardless of
//     whether rationale / analogue labels were generated for the same signal —
//     i.e. generating display text has zero effect on the numbers.
//
//   Clause C (compile-time exclusion, strengthening): the existing
//     `Deterministic<T>` utility collapses any `LlmTagged<…>` to `never`, so a
//     scoring parameter typed `Deterministic<T>` refuses an LLM-tagged argument
//     at compile time. Demonstrated with `@ts-expect-error`.

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };
const fixedLlmClock: LlmClock = { now: () => "2020-01-01T00:00:00.000Z" };

/** Arbitrary sanctioned role — the only roles that can produce a tagged value. */
const sanctionedRole = (): fc.Arbitrary<SanctionedRole> =>
  fc.constantFrom(...SANCTIONED_ROLES);

/**
 * Arbitrary payloads spanning the shapes LLM roles emit (string, string[],
 * RiskFlag-like object) plus a few adversarial primitives, so the guard is
 * exercised against a broad slice of tagged values, not one canned shape.
 */
const taggedPayload = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.string(),
    fc.array(fc.string()),
    fc.record({ level: fc.constantFrom("none", "elevated", "high"), reason: fc.string() }),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.dictionary(fc.string(), fc.string()),
  );

/**
 * An arbitrary LLM-tagged value: an arbitrary payload wrapped by the SAME
 * `tagLlmOutput` the LLM_Interface uses, so it carries the real, unforgeable
 * provenance brand.
 */
const llmTaggedValue = (): fc.Arbitrary<LlmTagged<unknown>> =>
  fc.tuple(taggedPayload(), sanctionedRole()).map(([payload, role]) =>
    tagLlmOutput(payload, role, "2020-01-01T00:00:00.000Z"),
  );

/** Representative scoring / verdict path labels the guard records. */
const scoringPath = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    "earnedConfidence",
    "composeGateVerdict",
    "evaluateGate1",
    "evaluateGate2",
    "selectHorizon",
  );

/** A neighborhood of matured analogue records for the confidence computation. */
const analogueRecord = (): fc.Arbitrary<AnalogueRecord> =>
  fc.record({
    asset: fc.constantFrom(...PAIRS),
    decisionDate: fc
      .integer({ min: 1, max: 28 })
      .map((d) => `2019-06-${String(d).padStart(2, "0")}`),
    horizon: fc.constantFrom<Horizon>(1, 2, 3),
    direction: fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT"),
    mfePips: fc.double({ min: 0, max: 200, noNaN: true }),
    maePips: fc.double({ min: 0, max: 200, noNaN: true }),
    atr14: fc.double({ min: 1, max: 100, noNaN: true }),
    matured: fc.constant(true),
  });

const neighborhood = (): fc.Arbitrary<readonly AnalogueRecord[]> =>
  fc.array(analogueRecord(), { minLength: 0, maxLength: 60 });

// ---------------------------------------------------------------------------
// Deterministic fake LLM provider (offline, no network / SDK)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Kill_Gate verdict fold builder (a single qualifying fold with fixed inputs).
// ---------------------------------------------------------------------------

function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * Build one qualifying (>=30-sample) fold whose gates deterministically pass,
 * so `composeGateVerdict` returns a fixed verdict independent of any AI output.
 */
function buildFold(pair: Pair, horizon: Horizon): FoldGateInput {
  const size = GATE1_SAMPLE_SIZE_FLOOR + 5;
  const firingSubset: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    firingSubset.push({
      decisionDate: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
      modelPrediction: "UP",
      baselinePrediction: "DOWN",
      actual: "UP",
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

// ---------------------------------------------------------------------------
// Clause A — blocked + recorded (Req 2.1, 2.2, 2.6)
// ---------------------------------------------------------------------------

describe("Property 4 (AI-free-scoring guardrail): LLM-tagged values never reach scoring / verdict paths", () => {
  it("blocks and RECORDS every LLM-tagged value on a scoring / verdict path (guard() => err)", () => {
    fc.assert(
      fc.property(llmTaggedValue(), scoringPath(), (tagged, path) => {
        const recorder = new InMemoryBlockedScoringInputRecorder();
        const guard = new ScoringInputGuard({ recorder, clock: fixedClock });

        const result = guard.guard(tagged, path);

        // The value is rejected — it never flows into the deterministic math.
        expect(result.ok).toBe(false);
        if (result.ok) return; // narrows the union for the assertions below.

        // The attempt was recorded BEFORE the rejection surfaced (Req 2.6).
        expect(recorder.size).toBe(1);
        const [blocked] = recorder.all();
        expect(blocked).toBeDefined();
        expect(blocked?.scoringPath).toBe(path);
        expect(result.error).toBe(blocked);

        // The producing role is attributed for the audit trail when present.
        const role = (tagged as { provenance?: { role?: string } }).provenance?.role;
        if (typeof role === "string") {
          expect(blocked?.producingRole).toBe(role);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("blocks and RECORDS every LLM-tagged value on a scoring / verdict path (assertClean() throws)", () => {
    fc.assert(
      fc.property(llmTaggedValue(), scoringPath(), (tagged, path) => {
        const recorder = new InMemoryBlockedScoringInputRecorder();
        const guard = new ScoringInputGuard({ recorder, clock: fixedClock });

        let thrown: unknown;
        try {
          guard.assertClean(tagged, path);
        } catch (e) {
          thrown = e;
        }

        // Fail-loud rejection: the LLM value never reaches the computation.
        expect(thrown).toBeInstanceOf(LlmOnScoringPathError);

        // The attempt was recorded before the throw (Req 2.6).
        expect(recorder.size).toBe(1);
        const [blocked] = recorder.all();
        expect(blocked?.scoringPath).toBe(path);
        expect((thrown as LlmOnScoringPathError).blocked).toBe(blocked);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Clause B — deterministic computations proceed UNCHANGED (Req 2.7, 15.2, 15.4)
// ---------------------------------------------------------------------------

describe("Property 4: generating rationale / labels leaves the numeric probability and verdict identical", () => {
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

  it("earnedConfidence is byte-identical before vs after rationale / label generation", async () => {
    await fc.assert(
      fc.asyncProperty(
        neighborhood(),
        fc.constantFrom<Horizon>(1, 2, 3),
        async (nbhd, horizon) => {
          const llm = makeLlm();

          // Baseline probability with NO AI output generated.
          const before = earnedConfidence(nbhd, horizon);

          // Generate display-only rationale + labels (LlmTagged<…>).
          const rationale = await generateSignalRationale(llm, numericInputs);
          const labels = await generatePatternDescription(llm, analogues);

          // The generated values are display-only, provenance-tagged, and are
          // NOT fed anywhere near the scoring computation.
          expect(isLlmTagged(rationale)).toBe(true);
          expect(isLlmTagged(labels)).toBe(true);

          // The directional probability is unchanged (Req 2.7, 15.2).
          const after = earnedConfidence(nbhd, horizon);
          expect(after).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("composeGateVerdict is identical before vs after rationale / label generation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        async (pair, horizon) => {
          const llm = makeLlm();
          const folds = [buildFold(pair, horizon)];

          // Baseline verdict with NO AI output generated.
          const before = composeGateVerdict("cfg-p4", folds);

          // Generate display-only rationale + labels.
          const rationale = await generateSignalRationale(llm, numericInputs);
          const labels = await generatePatternDescription(llm, analogues);
          expect(isLlmTagged(rationale)).toBe(true);
          expect(isLlmTagged(labels)).toBe(true);

          // The Kill_Gate verdict is unchanged (Req 2.7, 15.4). Compare the
          // numeric verdict + gate results, serialized for byte-identity.
          const after = composeGateVerdict("cfg-p4", folds);
          expect(after.verdict).toBe(before.verdict);
          expect(JSON.stringify(after)).toBe(JSON.stringify(before));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Clause C — compile-time exclusion via Deterministic<T> (strengthening)
// ---------------------------------------------------------------------------

describe("Property 4: Deterministic<T> excludes LLM-tagged values at compile time", () => {
  it("a scoring parameter typed Deterministic<T> refuses an LlmTagged argument", () => {
    function scoreWithDeterministic<T>(value: Deterministic<T>): T {
      return value;
    }

    const tagged = tagLlmOutput("display text", "signal_rationale", "2020-01-01T00:00:00.000Z");
    const cleanNumber = 0.5;

    // Clean numeric input is accepted.
    expect(scoreWithDeterministic(cleanNumber)).toBe(0.5);

    // @ts-expect-error an LlmTagged value is `never` as a Deterministic<T> param.
    scoreWithDeterministic(tagged);

    // Runtime cross-check: the same value is caught by the runtime guard too.
    const recorder = new InMemoryBlockedScoringInputRecorder();
    const guard = new ScoringInputGuard({ recorder, clock: fixedClock });
    expect(guard.guard(tagged, "earnedConfidence").ok).toBe(false);
    expect(recorder.size).toBe(1);
  });
});
