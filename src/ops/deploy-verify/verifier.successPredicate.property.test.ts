// Property-based test for the DeployVerifier success predicate (spec Req 4.2;
// task 7.2, design Property 17).
//
// Validates: Requirements 4.2 — "WHEN Deploy_Verification runs, THE System
// SHALL execute the deployed Cloud_Run_Job once, SHALL wait up to 300 seconds
// for the execution to complete, and SHALL treat the execution as successful
// only WHERE its succeeded task count equals its task count."
//
// This is a TEST-ONLY task. It exercises the real pure `evaluateExecution`
// predicate from verifier.ts (implemented in task 7.1). Rather than enumerate
// fixed cases, it GENERATES random `ExecutionStatus` inputs via fast-check and
// asserts the biconditional success rule: `result.ok === true` IF AND ONLY IF
// the execution did not fail, its succeeded count equals its task count, AND it
// completed within the 300_000 ms window. Generators deliberately exercise both
// the success branch and every failure branch (execution failure, unequal task
// counts, and elapsed time straddling the 300_000 ms boundary — including
// exactly 300_000 (success) and 300_001 (timeout failure)). Style follows the
// property tests in src/ops/safety/ and src/ops/secret-manager/ (fast-check +
// Vitest, numRuns >= 100, a single tagged property).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { evaluateExecution } from "./verifier.js";
import { DEPLOY_VERIFY_TIMEOUT_MS, type ExecutionStatus } from "./types.js";

// Feature: operational-wiring, Property 17: The deploy-verify success predicate

/**
 * The independent oracle for the success rule (spec Req 4.2), computed directly
 * from the convention rather than from the implementation under test: an
 * execution is successful IFF it did not report a failure, every task
 * succeeded, and it completed within the 300-second window.
 */
function expectedOk(status: ExecutionStatus): boolean {
  return (
    !status.executionFailed &&
    status.succeededTaskCount === status.taskCount &&
    status.elapsedMs <= DEPLOY_VERIFY_TIMEOUT_MS
  );
}

/**
 * Elapsed-time arbitrary that over-samples the 300_000 ms boundary so each run
 * reliably exercises the exactly-at-threshold success case and the
 * one-ms-over timeout failure, as well as values well inside and well outside
 * the window.
 */
const elapsedMsArb: fc.Arbitrary<number> = fc.oneof(
  // The decisive boundary values and their immediate neighbours.
  fc.constantFrom(
    0,
    DEPLOY_VERIFY_TIMEOUT_MS - 1, // 299_999 — success
    DEPLOY_VERIFY_TIMEOUT_MS, // 300_000 — success (inclusive window)
    DEPLOY_VERIFY_TIMEOUT_MS + 1, // 300_001 — timeout failure
  ),
  // A broad spread straddling the threshold.
  fc.integer({ min: 0, max: 2 * DEPLOY_VERIFY_TIMEOUT_MS }),
);

/**
 * An `ExecutionStatus` arbitrary that exercises BOTH branches: task counts that
 * are sometimes equal and sometimes unequal (so the matched-count case is hit
 * frequently rather than vanishingly), a free `executionFailed` flag, and the
 * boundary-aware elapsed time above. The identifier/reference strings are
 * free-form and never secrets.
 */
const executionStatusArb: fc.Arbitrary<ExecutionStatus> = fc
  .record({
    executionId: fc.string({ minLength: 1, maxLength: 40 }),
    taskCount: fc.integer({ min: 0, max: 32 }),
    // A delta applied to taskCount; 0 roughly half the time so the equal-count
    // (potential success) branch is sampled heavily, with unequal counts (short
    // and over) otherwise.
    succeededDelta: fc.oneof(
      fc.constant(0),
      fc.integer({ min: -32, max: 32 }),
    ),
    elapsedMs: elapsedMsArb,
    executionFailed: fc.boolean(),
    logReference: fc.string({ minLength: 1, maxLength: 60 }),
  })
  .map(
    ({
      executionId,
      taskCount,
      succeededDelta,
      elapsedMs,
      executionFailed,
      logReference,
    }) => ({
      executionId,
      taskCount,
      // Clamp to a non-negative succeeded count while still allowing it to
      // differ from taskCount in both directions.
      succeededTaskCount: Math.max(0, taskCount + succeededDelta),
      elapsedMs,
      executionFailed,
      logReference,
    }),
  );

describe("Property 17: the deploy-verify success predicate (spec Req 4.2)", () => {
  it("treats an execution as ok IFF it did not fail, every task succeeded, and it finished within 300_000 ms", () => {
    fc.assert(
      fc.property(executionStatusArb, (status) => {
        const result = evaluateExecution(status);

        // The biconditional: ok exactly matches the convention's success rule.
        expect(result.ok).toBe(expectedOk(status));

        // Identifiers always travel through, success or failure (spec Req 4.4).
        expect(result.executionId).toBe(status.executionId);
        expect(result.logReference).toBe(status.logReference);
        expect(result.succeededTaskCount).toBe(status.succeededTaskCount);
        expect(result.taskCount).toBe(status.taskCount);

        // A success carries no failure reason; a failure always names one.
        if (result.ok) {
          expect(result.failureReason).toBeUndefined();
        } else {
          expect(typeof result.failureReason).toBe("string");
          expect(result.failureReason).toBeTruthy();
        }
      }),
      { numRuns: 300 },
    );
  });

  it("confirms the 300_000 ms boundary: exactly at the window succeeds, one ms over times out (all tasks succeeded, no failure)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 32 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 60 }),
        (taskCount, executionId, logReference) => {
          const base = {
            executionId,
            taskCount,
            succeededTaskCount: taskCount,
            executionFailed: false,
            logReference,
          } as const;

          // Exactly at the inclusive window -> success.
          expect(
            evaluateExecution({
              ...base,
              elapsedMs: DEPLOY_VERIFY_TIMEOUT_MS,
            }).ok,
          ).toBe(true);

          // One millisecond past the window -> timeout failure.
          expect(
            evaluateExecution({
              ...base,
              elapsedMs: DEPLOY_VERIFY_TIMEOUT_MS + 1,
            }).ok,
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
