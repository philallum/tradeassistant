// Property-based test for the OperationalSafety destructive-command warning
// (spec Req 6.5; task 5.3, design Property 22).
//
// Validates: Requirements 6.5 — "IF a Live_Cloud_Command would delete,
// overwrite, or reduce the permissions of an existing cloud resource, THEN THE
// System SHALL present a distinguishable warning identifying the affected
// resource and effect to the operator and SHALL NOT execute the command until
// the operator approves."
//
// This is a TEST-ONLY task. It exercises the real pure `formatPresentation`
// function and the real `DefaultOperationalSafety` guard with an injected fake
// `GcloudRunner` (which records calls). No live gcloud is executed. A small
// `guardedExecute` helper mirrors the real usage pattern (confirm → run only on
// approval) so the warning can be tied to the approval gate without modifying
// production code.

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
  formatPresentation,
} from "./operationalSafety.js";

// Feature: operational-wiring, Property 22: Destructive commands require a distinguishable, named warning before approval

/** The distinguishable warning marker prepended to a destructive presentation. */
const WARNING_MARKER = "⚠️  DESTRUCTIVE/OVERWRITING OPERATION — affects:";

/** The fallback resource name when none is supplied. */
const UNNAMED_RESOURCE = "(unnamed resource)";

/**
 * A fake GcloudRunner that records every `run` call without touching a real
 * `gcloud` binary. Mirrors the recording runner in the Property 21 test file.
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
 * approval resolves `true`. Mirrors the helper in the Property 21 test file.
 */
async function guardedExecute(
  safety: DefaultOperationalSafety,
  runner: GcloudRunner,
  presentation: CommandPresentation,
  argv: readonly string[],
): Promise<{ executed: boolean }> {
  const approved = await safety.confirm(presentation);
  if (!approved) {
    return { executed: false };
  }
  await runner.run(argv);
  return { executed: true };
}

/** Arbitrary display command (already redacted by the caller in production). */
const displayCommandArb: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 120,
});

/** Arbitrary optional affected resource. */
const affectedResourceArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.string({ maxLength: 60 }),
  { nil: undefined },
);

/** Arbitrary argv for the (never-secret) command the runner would execute. */
const argvArb: fc.Arbitrary<readonly string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 20 }),
  { minLength: 1, maxLength: 6 },
);

/** Build a CommandPresentation, omitting `affectedResource` when undefined. */
function makePresentation(
  displayCommand: string,
  destructive: boolean,
  affectedResource: string | undefined,
): CommandPresentation {
  return affectedResource === undefined
    ? { displayCommand, destructive }
    : { displayCommand, destructive, affectedResource };
}

describe("Property 22: destructive commands require a distinguishable, named warning before approval (spec Req 6.5)", () => {
  it("destructive presentations carry a distinguishable, named warning; non-destructive ones do not", () => {
    fc.assert(
      fc.property(
        displayCommandArb,
        affectedResourceArb,
        (displayCommand, affectedResource) => {
          const destructive = makePresentation(
            displayCommand,
            true,
            affectedResource,
          );
          const nonDestructive = makePresentation(
            displayCommand,
            false,
            affectedResource,
          );

          const destructiveText = formatPresentation(destructive);
          const nonDestructiveText = formatPresentation(nonDestructive);

          // Destructive: a distinguishable warning marker is present...
          expect(destructiveText).toContain(WARNING_MARKER);
          // ...and it names the affected resource (given name, or the fallback).
          const expectedResource = affectedResource ?? UNNAMED_RESOURCE;
          expect(destructiveText).toContain(
            `${WARNING_MARKER} ${expectedResource}`,
          );

          // Non-destructive: no warning marker — distinguishable from destructive.
          expect(nonDestructiveText).not.toContain(WARNING_MARKER);

          // The two presentations of the same command differ: the warning is
          // distinguishable to the operator.
          expect(destructiveText).not.toBe(nonDestructiveText);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a destructive command never executes without approval (warning gates execution)", async () => {
    await fc.assert(
      fc.asyncProperty(
        displayCommandArb,
        affectedResourceArb,
        argvArb,
        async (displayCommand, affectedResource, argv) => {
          const presentation = makePresentation(
            displayCommand,
            true,
            affectedResource,
          );

          // The operator is shown the warning (precondition for approval)...
          expect(formatPresentation(presentation)).toContain(WARNING_MARKER);

          // ...and with a deny callback the runner is never invoked.
          const runner = recordingRunner();
          const deny: ConfirmCallback = () => Promise.resolve(false);
          const guard = new DefaultOperationalSafety(runner, deny);

          const { executed } = await guardedExecute(
            guard,
            runner,
            presentation,
            argv,
          );

          expect(executed).toBe(false);
          expect(runner.calls).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
