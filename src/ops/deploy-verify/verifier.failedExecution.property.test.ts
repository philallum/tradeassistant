// Property-based test for the PURE deploy-verify success predicate
// `evaluateExecution` under failure conditions (spec Req 4.4; task 7.3,
// design Property 18).
//
// Validates: Requirements 4.4 — "IF the execution fails, exceeds the 300s
// window, or reports a succeeded count less than its task count, THEN the
// result is `ok:false` and MUST carry the failed execution's id and its Cloud
// Logging reference."
//
// This is a TEST-ONLY task. It exercises the real pure `evaluateExecution`
// from verifier.ts (implemented in task 7.1) over randomly generated
// `ExecutionStatus` inputs constrained so that AT LEAST ONE failure condition
// holds (execution reported a failure, OR elapsedMs exceeds the 300s window,
// OR succeededTaskCount < taskCount). It asserts the result is `ok:false`, that
// the failed execution's identifiers (`executionId`, `logReference`) are
// preserved verbatim and non-null, and that a non-empty `failureReason` is
// surfaced. Non-empty generated id/logReference strings keep the "carries its
// identifiers" assertion meaningful. Style follows the property tests in
// src/ops/secret-manager/ and src/ops/safety/ (fast-check + Vitest,
// numRuns >= 100, tagged property, ESM `.js` imports).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { evaluateExecution } from "./verifier.js";
import { DEPLOY_VERIFY_TIMEOUT_MS, type ExecutionStatus } from "./types.js";

// Feature: operational-wiring, Property 18: A failed execution maps to a failing result carrying its identifiers

/** Non-empty identifier strings so the "carries its identifiers" assertion is
 *  meaningful — an empty id/logReference would make preservation trivial. */
const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 40 });

/**
 * Generates an `ExecutionStatus` constrained to at least one failure condition.
 * A discriminator picks which failure condition to guarantee while the other
 * fields vary freely, so every generated input is a genuine failure (any
 * combination of the three conditions may co-occur).
 *
 * Failure conditions (spec Req 4.4):
 *  - "failed":  executionFailed = true
 *  - "timeout": elapsedMs > DEPLOY_VERIFY_TIMEOUT_MS
 *  - "short":   succeededTaskCount < taskCount
 */
const failingStatusArb: fc.Arbitrary<ExecutionStatus> = fc
  .record({
    executionId: idArb,
    logReference: idArb,
    taskCount: fc.integer({ min: 1, max: 1_000 }),
    succeededTaskCount: fc.integer({ min: 0, max: 1_000 }),
    elapsedMs: fc.integer({ min: 0, max: DEPLOY_VERIFY_TIMEOUT_MS * 2 }),
    executionFailed: fc.boolean(),
    which: fc.constantFrom("failed", "timeout", "short"),
  })
  .map(({ which, ...rest }) => {
    const base = { ...rest } as ExecutionStatus & {
      executionFailed: boolean;
      elapsedMs: number;
      succeededTaskCount: number;
      taskCount: number;
    };
    switch (which) {
      case "failed":
        return { ...base, executionFailed: true };
      case "timeout":
        // Strictly greater than the window is a timeout failure.
        return {
          ...base,
          elapsedMs: fc.sample(
            fc.integer({
              min: DEPLOY_VERIFY_TIMEOUT_MS + 1,
              max: DEPLOY_VERIFY_TIMEOUT_MS * 2,
            }),
            1,
          )[0]!,
        };
      case "short":
      default: {
        // Force succeeded < task by raising taskCount above succeededTaskCount.
        const taskCount = base.succeededTaskCount + 1;
        return { ...base, taskCount };
      }
    }
  });

/** Returns true iff at least one failure condition holds for the given status
 *  — an independent oracle, not reusing the production precedence logic. */
function hasFailureCondition(s: ExecutionStatus): boolean {
  return (
    s.executionFailed ||
    s.elapsedMs > DEPLOY_VERIFY_TIMEOUT_MS ||
    s.succeededTaskCount < s.taskCount
  );
}

describe("Property 18: a failed execution maps to a failing result carrying its identifiers (spec Req 4.4)", () => {
  it("maps every failing execution to ok:false preserving its id and log reference", () => {
    fc.assert(
      fc.property(failingStatusArb, (status) => {
        // Guard: the generator must only produce genuine failures.
        expect(hasFailureCondition(status)).toBe(true);

        const result = evaluateExecution(status);

        // Failing result.
        expect(result.ok).toBe(false);

        // Identifiers preserved verbatim and non-null (spec Req 4.4).
        expect(result.executionId).toBe(status.executionId);
        expect(result.executionId).not.toBeNull();
        expect(result.executionId).not.toBe("");

        expect(result.logReference).toBe(status.logReference);
        expect(result.logReference).not.toBeNull();
        expect(result.logReference).not.toBe("");

        // A non-empty, non-secret failure description is surfaced.
        expect(result.failureReason).toBeDefined();
        expect(typeof result.failureReason).toBe("string");
        expect(result.failureReason!.length).toBeGreaterThan(0);

        // Task counts are carried through unchanged.
        expect(result.succeededTaskCount).toBe(status.succeededTaskCount);
        expect(result.taskCount).toBe(status.taskCount);
      }),
      { numRuns: 200 },
    );
  });
});
