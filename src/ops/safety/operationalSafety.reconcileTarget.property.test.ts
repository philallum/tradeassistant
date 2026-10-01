// Property-based test for OperationalSafety.reconcileTarget (spec Req 3.7, 6.4,
// 6.6; task 5.5, design Property 24).
//
// Validates: Requirements 3.7, 6.4, 6.6 — "reconcile the active gcloud project
// AND account against the expected GCP_PROJECT_ID before any
// Live_Cloud_Command; abort and surface the mismatch when the active project or
// account does not match the expected target, rather than executing against an
// unintended project/identity."
//
// This is a TEST-ONLY task. It exercises the real `DefaultOperationalSafety`
// guard with an injected fake `GcloudRunner` that records every config read and
// returns canned active project/account values driven by fast-check. No live
// gcloud is executed; nothing is piped on stdin while reconciling.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { CommandOutput, GcloudRunner } from "./types.js";
import {
  DefaultOperationalSafety,
  GET_ACCOUNT_ARGV,
  GET_PROJECT_ARGV,
} from "./operationalSafety.js";

// Feature: operational-wiring, Property 24: Active project and account are reconciled before every Live_Cloud_Command

/**
 * A fake GcloudRunner that returns canned stdout keyed by the config argv it
 * receives, and records which argvs were read (so we can assert BOTH the
 * project and account config reads were performed). Mirrors the recording
 * `fakeConfigRunner` in operationalSafety.test.ts, but without touching a real
 * `gcloud` binary and never accepting a secret on stdin while reconciling.
 */
function recordingConfigRunner(values: {
  project: string;
  account: string;
}): GcloudRunner & {
  readonly reads: Array<readonly string[]>;
  readonly stdinSeen: boolean;
} {
  const reads: Array<readonly string[]> = [];
  let stdinSeen = false;
  return {
    reads,
    get stdinSeen() {
      return stdinSeen;
    },
    run(argv, opts): Promise<CommandOutput> {
      reads.push(argv);
      if (opts?.stdin !== undefined) stdinSeen = true;
      const key = argv.join(" ");
      let stdout = "";
      if (key === GET_PROJECT_ARGV.join(" ")) stdout = values.project;
      else if (key === GET_ACCOUNT_ARGV.join(" ")) stdout = values.account;
      return Promise.resolve({ stdout, stderr: "", exitCode: 0 });
    },
  };
}

/** True iff the fake runner performed BOTH the project and account reads. */
function readBothProjectAndAccount(reads: Array<readonly string[]>): boolean {
  const seen = reads.map((argv) => argv.join(" "));
  return (
    seen.includes(GET_PROJECT_ARGV.join(" ")) &&
    seen.includes(GET_ACCOUNT_ARGV.join(" "))
  );
}

/**
 * The guard normalizes `(unset)`, empty, and whitespace-only stdout to "". A
 * "blank" arbitrary generates values that normalize to "" so the normalize path
 * is realistically exercised.
 */
const blankValueArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  "   ",
  "\n",
  "\t",
  "(unset)",
  "  (unset)  ",
  "\n(unset)\n",
);

/**
 * A non-empty project/account identifier that does NOT normalize to "". We
 * surround an arbitrary identifier with optional whitespace so the trim path is
 * exercised, and exclude the `(unset)` sentinel.
 */
const nonEmptyIdentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim() !== "" && s.trim() !== "(unset)")
  .chain((core) =>
    fc
      .tuple(
        fc.constantFrom("", " ", "  ", "\n", "\t"),
        fc.constantFrom("", " ", "  ", "\n", "\t"),
      )
      .map(([pre, post]) => `${pre}${core}${post}`),
  );

/** An expected project (GCP_PROJECT_ID) that is a valid, non-empty target. */
const expectedProjectArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim() !== "" && s.trim() !== "(unset)");

describe("Property 24: active project and account are reconciled before every Live_Cloud_Command (spec Req 3.7, 6.4, 6.6)", () => {
  it("permits iff the active project matches expected AND an account is present", async () => {
    await fc.assert(
      fc.asyncProperty(
        expectedProjectArb,
        // The active project either reuses the expected value (match case) or
        // is some other value / blank (mismatch case) — biased so matches ARE
        // generated and not drowned out by random strings.
        fc.oneof(
          { weight: 3, arbitrary: fc.constant<"reuse-expected">("reuse-expected") },
          { weight: 2, arbitrary: nonEmptyIdentArb },
          { weight: 2, arbitrary: blankValueArb },
        ),
        // The active account is either present (non-empty) or blank/unset.
        fc.oneof(
          { weight: 3, arbitrary: nonEmptyIdentArb },
          { weight: 2, arbitrary: blankValueArb },
        ),
        async (expectedProject, activeProjectChoice, activeAccount) => {
          const activeProject =
            activeProjectChoice === "reuse-expected"
              ? // Reuse the expected value (optionally re-wrapped in whitespace)
                `  ${expectedProject.trim()} \n`
              : activeProjectChoice;

          const runner = recordingConfigRunner({
            project: activeProject,
            account: activeAccount,
          });
          const guard = new DefaultOperationalSafety(runner);

          const result = await guard.reconcileTarget(expectedProject);

          // Recompute the guard's own normalization to express the oracle.
          const normalize = (raw: string): string => {
            const t = raw.trim();
            return t === "" || t === "(unset)" ? "" : t;
          };
          const expectedNorm = expectedProject.trim();
          const projectNorm = normalize(activeProject);
          const accountNorm = normalize(activeAccount);
          const shouldPermit =
            projectNorm === expectedNorm && accountNorm !== "";

          expect(result.ok).toBe(shouldPermit);

          // Property point 5: the guard ALWAYS reads BOTH project and account
          // before deciding — reconciliation precedes any permit, and never
          // pipes a secret on stdin while reconciling.
          expect(readBothProjectAndAccount(runner.reads)).toBe(true);
          expect(runner.stdinSeen).toBe(false);

          if (!shouldPermit) {
            // On abort the mismatch names the discrepancy.
            if (result.ok) throw new Error("expected ok:false");
            expect(result.mismatch.length).toBeGreaterThan(0);
            if (projectNorm !== expectedNorm) {
              // The project discrepancy is surfaced: it names the active (or
              // "(unset)") and the expected project.
              expect(result.mismatch).toContain(expectedNorm);
              expect(result.mismatch).toContain(projectNorm || "(unset)");
            } else {
              // Project matched but no account authenticated — the missing
              // account is surfaced.
              expect(result.mismatch).toMatch(/account/i);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("surfaces a named project discrepancy whenever the active project differs (incl. (unset)/empty)", async () => {
    await fc.assert(
      fc.asyncProperty(
        expectedProjectArb,
        // An active project guaranteed to differ from expected: either blank
        // (normalizes to "") or a different non-empty identifier.
        fc.oneof(
          { weight: 1, arbitrary: blankValueArb },
          { weight: 1, arbitrary: nonEmptyIdentArb },
        ),
        // Account present so the ONLY reason to abort is the project.
        nonEmptyIdentArb,
        async (expectedProject, activeProject, activeAccount) => {
          fc.pre(activeProject.trim() !== expectedProject.trim());

          const runner = recordingConfigRunner({
            project: activeProject,
            account: activeAccount,
          });
          const guard = new DefaultOperationalSafety(runner);

          const result = await guard.reconcileTarget(expectedProject);

          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("expected ok:false");
          const activeNorm =
            activeProject.trim() === "" || activeProject.trim() === "(unset)"
              ? "(unset)"
              : activeProject.trim();
          expect(result.mismatch).toContain(expectedProject.trim());
          expect(result.mismatch).toContain(activeNorm);
          // Both config reads performed before the abort decision.
          expect(readBothProjectAndAccount(runner.reads)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("surfaces the missing account when the project matches but no account is authenticated", async () => {
    await fc.assert(
      fc.asyncProperty(
        expectedProjectArb,
        blankValueArb,
        async (expectedProject, blankAccount) => {
          const runner = recordingConfigRunner({
            // Matching project (re-wrapped in whitespace to exercise trim).
            project: ` ${expectedProject.trim()}\n`,
            account: blankAccount,
          });
          const guard = new DefaultOperationalSafety(runner);

          const result = await guard.reconcileTarget(expectedProject);

          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("expected ok:false");
          expect(result.mismatch).toMatch(/account/i);
          expect(readBothProjectAndAccount(runner.reads)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("refuses to run against an unknown target when the expected project is empty/whitespace", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("", " ", "   ", "\n", "\t", "  \n\t "),
        nonEmptyIdentArb,
        nonEmptyIdentArb,
        async (emptyExpected, activeProject, activeAccount) => {
          const runner = recordingConfigRunner({
            project: activeProject,
            account: activeAccount,
          });
          const guard = new DefaultOperationalSafety(runner);

          const result = await guard.reconcileTarget(emptyExpected);

          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("expected ok:false");
          expect(result.mismatch.length).toBeGreaterThan(0);
          // With no known target the guard refuses outright and never queries
          // gcloud for an active project/account.
          expect(runner.reads).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
