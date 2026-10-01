// Property-based test for the OperationalSafety approval gate (spec Req 6.1;
// task 5.2, design Property 21).
//
// Validates: Requirements 6.1 — "WHEN the operator is about to run a
// Live_Cloud_Command ... THE System SHALL present the exact command to the
// operator and SHALL NOT execute it until the operator approves."
//
// This is a TEST-ONLY task. It exercises the real `DefaultOperationalSafety`
// guard with an injected fake `GcloudRunner` (which records calls) and an
// injectable `ConfirmCallback` whose return value is driven by fast-check.
// No live gcloud is executed. A small `guardedExecute` helper mirrors the real
// usage pattern (confirm → run only on approval) so the end-to-end invariant
// can be expressed without modifying production code.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  CommandOutput,
  CommandPresentation,
  ConfirmCallback,
  GcloudRunner,
} from "./types.js";
import {
  DefaultOperationalSafety,
  denyByDefault,
} from "./operationalSafety.js";

// Feature: operational-wiring, Property 21: No Live_Cloud_Command runs without operator approval

/**
 * A fake GcloudRunner that records every `run` call (argv + whether stdin was
 * supplied) without touching a real `gcloud` binary. Mirrors the recording
 * `fakeConfigRunner` in operationalSafety.test.ts.
 */
function recordingRunner(): GcloudRunner & {
  readonly calls: Array<readonly string[]>;
} {
  const calls: Array<readonly string[]> = [];
  return {
    calls,
    run(argv): Promise<CommandOutput> {
      calls.push(argv);
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    },
  };
}

/**
 * Minimal guarded command executor mirroring the real usage pattern: it MUST
 * consult `safety.confirm(presentation)` first and only invoke the runner when
 * approval resolves `true`. Returns an ordered trace of the collaborator calls
 * so the "approval precedes execution" ordering can be asserted.
 *
 * This helper lives in the test (not production) because the invariant under
 * test is about how a `Live_Cloud_Command` call site is required to use the
 * guard, not an additional production seam.
 */
async function guardedExecute(
  safety: DefaultOperationalSafety,
  runner: GcloudRunner,
  presentation: CommandPresentation,
  argv: readonly string[],
): Promise<{ executed: boolean; trace: ReadonlyArray<"confirm" | "run"> }> {
  const trace: Array<"confirm" | "run"> = [];
  trace.push("confirm");
  const approved = await safety.confirm(presentation);
  if (!approved) {
    return { executed: false, trace };
  }
  trace.push("run");
  await runner.run(argv);
  return { executed: true, trace };
}

/** Arbitrary CommandPresentation: varied display command, destructiveness, and
 *  optional affected resource. */
const presentationArb: fc.Arbitrary<CommandPresentation> = fc
  .record({
    displayCommand: fc.string({ minLength: 1, maxLength: 120 }),
    destructive: fc.boolean(),
    affectedResource: fc.option(fc.string({ maxLength: 60 }), {
      nil: undefined,
    }),
  })
  .map(({ displayCommand, destructive, affectedResource }) =>
    affectedResource === undefined
      ? { displayCommand, destructive }
      : { displayCommand, destructive, affectedResource },
  );

/** Arbitrary argv for the (never-secret) command the runner would execute. */
const argvArb: fc.Arbitrary<readonly string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 20 }),
  { minLength: 1, maxLength: 6 },
);

describe("Property 21: no Live_Cloud_Command runs without operator approval (spec Req 6.1)", () => {
  it("executes the command iff the operator approved via confirm, and only after confirm", async () => {
    await fc.assert(
      fc.asyncProperty(
        presentationArb,
        argvArb,
        fc.boolean(),
        async (presentation, argv, approvalOutcome) => {
          const runner = recordingRunner();
          const confirm: ConfirmCallback = () =>
            Promise.resolve(approvalOutcome);
          const guard = new DefaultOperationalSafety(runner, confirm);

          const { executed, trace } = await guardedExecute(
            guard,
            runner,
            presentation,
            argv,
          );

          // Execution happens if and only if the operator approved.
          expect(executed).toBe(approvalOutcome);

          if (approvalOutcome) {
            // Approved: the command executed exactly once...
            expect(runner.calls).toHaveLength(1);
            expect(runner.calls[0]).toEqual(argv);
            // ...and only after confirm was consulted (ordering).
            expect(trace).toEqual(["confirm", "run"]);
          } else {
            // Declined: the runner was NEVER called — nothing runs without approval.
            expect(runner.calls).toHaveLength(0);
            expect(trace).toEqual(["confirm"]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never executes under the deny-by-default callback (default approval mechanism)", async () => {
    await fc.assert(
      fc.asyncProperty(
        presentationArb,
        argvArb,
        async (presentation, argv) => {
          const runner = recordingRunner();
          // No confirm injected -> denyByDefault is used by the guard.
          const guard = new DefaultOperationalSafety(runner);

          const { executed, trace } = await guardedExecute(
            guard,
            runner,
            presentation,
            argv,
          );

          // Deny-by-default guarantees nothing ever runs.
          expect(executed).toBe(false);
          expect(runner.calls).toHaveLength(0);
          expect(trace).toEqual(["confirm"]);
          // Sanity: the default callback itself always refuses.
          await expect(denyByDefault(presentation)).resolves.toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
