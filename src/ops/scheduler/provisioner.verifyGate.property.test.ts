// Property-based test for the SchedulerProvisioner verify gate (spec Req 5.3;
// task 8.2, design Property 20).
//
// Validates: Requirements 5.3 — "IF Deploy_Verification (Requirement 4) has not
// completed successfully, THEN THE System SHALL NOT create the Scheduler_Job and
// SHALL surface an indication that the Deploy_Verification prerequisite was not
// met."
//
// This is a TEST-ONLY task. It exercises the real pure `gateCreate` predicate
// and the `SchedulerProvisioner.create` wiring from provisioner.ts (implemented
// in task 8.1). Rather than enumerate fixed cases, it GENERATES random
// `SchedulerPlan`/`SchedulerTarget`/`DeployVerifyResult` inputs via fast-check
// and asserts the biconditional gate rule: the gate allows (and `create` runs
// the gcloud commands) IF AND ONLY IF `verify.ok === true`. When
// `verify.ok === false`: no command is constructed, the injected GcloudRunner is
// NEVER invoked, `created` is false, and a non-empty prerequisite indication is
// surfaced. Style follows the property tests in src/ops/deploy-verify/ and
// src/ops/safety/ (fast-check + Vitest, numRuns >= 100, a single tagged
// property).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { SchedulerProvisioner, gateCreate } from "./provisioner.js";
import type { SchedulerPlan, SchedulerTarget } from "./types.js";
import type { DeployVerifyResult } from "../deploy-verify/types.js";
import type {
  CommandOutput,
  GcloudRunner,
  OperationalSafety,
  ReconcileResult,
} from "../safety/types.js";

// Feature: operational-wiring, Property 20: Scheduler creation is gated on a successful verify

/**
 * A GcloudRunner fake that records every invocation so the test can assert the
 * runner is NEVER called when the verify gate refuses. Returns a benign success
 * output on every call.
 */
class RecordingGcloudRunner implements GcloudRunner {
  readonly calls: readonly string[][] = [];

  run(argv: readonly string[]): Promise<CommandOutput> {
    (this.calls as string[][]).push([...argv]);
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  }
}

/**
 * An OperationalSafety fake that always reconciles successfully and always
 * approves. This isolates the verify gate: when the gate allows, `create`
 * proceeds all the way to running the gcloud commands; when the gate refuses,
 * `create` must short-circuit BEFORE touching reconcile/confirm/runner.
 */
class AlwaysApproveSafety implements OperationalSafety {
  reconcileTarget(): Promise<ReconcileResult> {
    return Promise.resolve({ ok: true });
  }

  confirm(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** A non-empty, non-secret identifier arbitrary for names/references. */
const nameArb = fc.string({ minLength: 1, maxLength: 40 });

const planArb: fc.Arbitrary<SchedulerPlan> = fc.record({
  schedule: fc.constant("0 17 * * *"),
  timeZone: fc.constant("America/New_York" as const),
  artifactApproach: fc.constantFrom(
    "workflow-step" as const,
    "committed-config" as const,
    "documented-command" as const,
  ),
  invokerServiceAccount: nameArb,
});

const targetArb: fc.Arbitrary<SchedulerTarget> = fc.record({
  projectId: nameArb,
  region: nameArb,
  jobName: nameArb,
  schedulerJobName: nameArb,
});

/**
 * A `DeployVerifyResult` arbitrary that exercises BOTH branches: a successful
 * verification (`ok: true`) and a failed one (`ok: false`), with the optional
 * `failureReason` sometimes present and sometimes absent so the surfaced
 * prerequisite indication is checked in both shapes. Identifiers are free-form
 * and never secrets.
 */
const verifyArb: fc.Arbitrary<DeployVerifyResult> = fc
  .record({
    ok: fc.boolean(),
    executionId: fc.option(nameArb, { nil: null }),
    succeededTaskCount: fc.option(fc.integer({ min: 0, max: 32 }), {
      nil: null,
    }),
    taskCount: fc.option(fc.integer({ min: 0, max: 32 }), { nil: null }),
    logReference: fc.option(fc.string({ minLength: 1, maxLength: 60 }), {
      nil: null,
    }),
    failureReason: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  })
  .map((v) => {
    // A success carries no failureReason; drop it when ok to keep the shape
    // faithful to how the predicate produces results.
    if (v.ok) {
      const { failureReason: _drop, ...rest } = v;
      void _drop;
      return rest;
    }
    return v;
  });

describe("Property 20: scheduler creation is gated on a successful verify (spec Req 5.3)", () => {
  it("gateCreate allows IFF verify.ok, carrying commands on allow and a non-empty prerequisiteUnmet on refuse", () => {
    fc.assert(
      fc.property(planArb, targetArb, verifyArb, (plan, target, verify) => {
        const decision = gateCreate(plan, target, verify);

        // The biconditional: allow exactly matches verify.ok.
        expect(decision.allow).toBe(verify.ok);

        if (decision.allow) {
          // On allow the gate carries the ordered provisioning commands.
          expect(decision.commands.length).toBeGreaterThan(0);
        } else {
          // On refuse the gate surfaces a non-empty unmet-prerequisite
          // indication and carries NO commands.
          expect(typeof decision.prerequisiteUnmet).toBe("string");
          expect(decision.prerequisiteUnmet.trim().length).toBeGreaterThan(0);
          expect(decision).not.toHaveProperty("commands");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("create runs the gcloud commands IFF verify.ok; on failure the runner is NEVER called, created is false, and prerequisiteUnmet is surfaced", async () => {
    await fc.assert(
      fc.asyncProperty(
        planArb,
        targetArb,
        verifyArb,
        async (plan, target, verify) => {
          const runner = new RecordingGcloudRunner();
          const provisioner = new SchedulerProvisioner(
            runner,
            new AlwaysApproveSafety(),
          );

          const result = await provisioner.create(plan, verify, target);

          if (verify.ok) {
            // The gate allowed: creation proceeded and ran gcloud commands.
            expect(result.ok).toBe(true);
            expect(result.created).toBe(true);
            expect(result.schedulerJobName).toBe(target.schedulerJobName);
            expect(result.prerequisiteUnmet).toBeUndefined();
            expect(runner.calls.length).toBeGreaterThan(0);
          } else {
            // The gate refused: NO command was constructed or run.
            expect(result.ok).toBe(false);
            expect(result.created).toBe(false);
            expect(result.schedulerJobName).toBeNull();
            expect(typeof result.prerequisiteUnmet).toBe("string");
            expect(result.prerequisiteUnmet!.trim().length).toBeGreaterThan(0);
            // The runner is NEVER invoked when the verify gate refuses.
            expect(runner.calls.length).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
