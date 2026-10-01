// Property-based test for DeployVerifier.checkPrerequisites (spec Req 4.5;
// task 7.4, design Property 19).
//
// Validates: Requirements 4.5 — "block verification whenever the required
// secrets OR the roles/secretmanager.secretAccessor grant for the
// Runtime_Service_Account is absent, and surface the SPECIFIC missing item
// ('required secrets' or 'accessor grant') rather than an ambiguous execution
// failure."
//
// This is a TEST-ONLY task. It exercises the real `checkPrerequisites` from
// verifier.ts (implemented in task 7.1). Rather than enumerate fixed cases, it
// GENERATES random `PrerequisiteStatus` inputs via fast-check — a random SA
// identity plus the two presence booleans — and asserts the returned check
// matches the convention: the specific missing item is surfaced (never an
// ambiguous/empty string), and the required-secrets blocker takes precedence
// over the accessor grant when both are absent. Style follows the property
// tests in src/ops/safety/ and src/ops/secret-manager/ (fast-check + Vitest,
// numRuns >= 100, a single tagged property), using ESM `.js` imports.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { checkPrerequisites } from "./verifier.js";
import {
  MISSING_ACCESSOR_GRANT,
  MISSING_REQUIRED_SECRETS,
  type PrerequisiteStatus,
} from "./types.js";

// Feature: operational-wiring, Property 19: A missing verify prerequisite is surfaced specifically

/** The two known, specific missing-prerequisite labels (spec Req 4.5). */
const KNOWN_LABELS: readonly string[] = [
  MISSING_REQUIRED_SECRETS,
  MISSING_ACCESSOR_GRANT,
];

/**
 * A random `Runtime_Service_Account` identity (name/email only — never a secret
 * value). It is deliberately unconstrained in content because the predicate's
 * decision depends ONLY on the two presence booleans, not on the SA string; a
 * varied identity confirms the SA plays no part in the outcome.
 */
const serviceAccountArb: fc.Arbitrary<string> = fc.string({
  minLength: 0,
  maxLength: 60,
});

/**
 * A random `PrerequisiteStatus`: a random SA identity plus independently
 * generated presence booleans, so all four combinations of
 * (requiredSecretsPresent, accessorGrantPresent) are explored.
 */
const prerequisiteStatusArb: fc.Arbitrary<PrerequisiteStatus> = fc.record({
  runtimeServiceAccount: serviceAccountArb,
  requiredSecretsPresent: fc.boolean(),
  accessorGrantPresent: fc.boolean(),
});

describe("Property 19: a missing verify prerequisite is surfaced specifically (spec Req 4.5)", () => {
  it("blocks on an absent prerequisite with the SPECIFIC label, secrets taking precedence", () => {
    fc.assert(
      fc.property(prerequisiteStatusArb, (status) => {
        const result = checkPrerequisites(status);

        if (status.requiredSecretsPresent && status.accessorGrantPresent) {
          // Both prerequisites present → verification is permitted and no
          // missing item is surfaced.
          expect(result.ok).toBe(true);
          expect(result.missing).toBeUndefined();
          return;
        }

        // At least one prerequisite is absent → verification is blocked and the
        // SPECIFIC missing item is surfaced (never ambiguous/empty).
        expect(result.ok).toBe(false);
        expect(result.missing).toBeDefined();
        expect(typeof result.missing).toBe("string");
        expect((result.missing as string).length).toBeGreaterThan(0);
        expect(KNOWN_LABELS).toContain(result.missing);

        if (!status.requiredSecretsPresent) {
          // Required secrets absent → surfaced specifically, and this takes
          // precedence even if the accessor grant is ALSO absent (the more
          // fundamental blocker is reported).
          expect(result.missing).toBe(MISSING_REQUIRED_SECRETS);
        } else {
          // Secrets present but the accessor grant is absent → the grant is the
          // surfaced missing item.
          expect(result.missing).toBe(MISSING_ACCESSOR_GRANT);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("permits only when BOTH prerequisites are present", () => {
    fc.assert(
      fc.property(serviceAccountArb, (runtimeServiceAccount) => {
        const result = checkPrerequisites({
          runtimeServiceAccount,
          requiredSecretsPresent: true,
          accessorGrantPresent: true,
        });
        expect(result.ok).toBe(true);
        expect(result.missing).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("surfaces the required-secrets blocker ahead of the accessor grant when both are absent", () => {
    fc.assert(
      fc.property(serviceAccountArb, (runtimeServiceAccount) => {
        const result = checkPrerequisites({
          runtimeServiceAccount,
          requiredSecretsPresent: false,
          accessorGrantPresent: false,
        });
        expect(result.ok).toBe(false);
        // Precedence: the missing secrets are the more fundamental blocker, so
        // they are surfaced rather than the (also-absent) accessor grant.
        expect(result.missing).toBe(MISSING_REQUIRED_SECRETS);
      }),
      { numRuns: 100 },
    );
  });

  it("surfaces the accessor grant specifically when secrets are present but the grant is absent", () => {
    fc.assert(
      fc.property(serviceAccountArb, (runtimeServiceAccount) => {
        const result = checkPrerequisites({
          runtimeServiceAccount,
          requiredSecretsPresent: true,
          accessorGrantPresent: false,
        });
        expect(result.ok).toBe(false);
        expect(result.missing).toBe(MISSING_ACCESSOR_GRANT);
      }),
      { numRuns: 100 },
    );
  });
});
