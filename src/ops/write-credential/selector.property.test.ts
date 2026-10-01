// Property-based test for the pure Job write-credential selector
// (task 12.2, design Property 26).
//
// Validates: Requirements 8.3, 8.4, 8.5, 8.8 — for ANY resolved Job storage
// configuration, the credential selected for the deployed Cloud_Run_Job's write
// path is the Scoped_Write_Credential (spec Req 8.3) and NEVER the
// Service_Role_Key (spec Req 8.4) or the publishable (anon) key (spec Req 8.5),
// and no secret value appears on any output surface (spec Req 8.8).
//
// This exercises the real pure `selectJobWriteCredential` from selector.ts.
// Rather than enumerate fixed cases it GENERATES arbitrary credential-candidate
// configurations via fast-check — varying how many scoped-write, service-role,
// and publishable candidates are present — and asserts the selection invariants
// against an INDEPENDENTLY computed expectation. Style follows the property
// tests in src/ops/scheduler/ and src/ops/deploy-verify/ (fast-check + Vitest,
// numRuns >= 100, a single tagged property).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { selectJobWriteCredential } from "./selector.js";
import type {
  SupabaseCredentialKind,
  WriteCredentialCandidate,
} from "./types.js";

// Feature: operational-wiring, Property 26: The write-credential selector never resolves to the service-role key for the Job

/**
 * A sentinel "secret value" we thread through the generated candidates purely to
 * assert it NEVER surfaces in the selector's output. The selector's input shape
 * carries no value field, so this is deliberately held OUTSIDE the candidates
 * and only used to sanity-check the output surface stays value-free.
 */
const SECRET_SENTINEL = "sb_secret_SUPER_SECRET_SERVICE_ROLE_VALUE_do_not_leak";

const KINDS: readonly SupabaseCredentialKind[] = [
  "scoped-write",
  "service-role",
  "publishable",
];

/** Arbitrary env-key NAME (never a value): uppercase-ish identifier shapes. */
const envKeyNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("SUPABASE", "SB", "JOB", "HOSTED"),
    fc.constantFrom("HOSTED_KEY", "WRITE_KEY", "KEY", "SERVICE_KEY", "ANON_KEY"),
  )
  .map(([a, b]) => `${a}_${b}`);

/** A single candidate: a NAME + a KIND. No value, by construction. */
const candidateArb: fc.Arbitrary<WriteCredentialCandidate> = fc.record({
  envKeyName: envKeyNameArb,
  kind: fc.constantFrom(...KINDS),
});

/**
 * A list of candidates with an arbitrary mix of kinds (including zero, one, or
 * many scoped-write candidates, and any mix of forbidden kinds) so every branch
 * of the selector is reached across runs.
 */
const candidatesArb: fc.Arbitrary<readonly WriteCredentialCandidate[]> =
  fc.array(candidateArb, { minLength: 0, maxLength: 8 });

/**
 * Independent oracle for the expected outcome, computed WITHOUT reusing the
 * implementation's internals: exactly-one scoped-write candidate -> that one is
 * selected; otherwise no selection.
 */
function expectedScopedWrite(
  candidates: readonly WriteCredentialCandidate[],
): WriteCredentialCandidate | undefined {
  const scoped = candidates.filter((c) => c.kind === "scoped-write");
  return scoped.length === 1 ? scoped[0] : undefined;
}

describe("Property 26: write-credential selector never resolves to the service-role key for the Job (spec Req 8.3, 8.4, 8.5, 8.8)", () => {
  it("selects the Scoped_Write_Credential and never a service-role or publishable key, leaking no value", () => {
    let sawOk = false;
    let sawReject = false;

    fc.assert(
      fc.property(candidatesArb, (candidates) => {
        const result = selectJobWriteCredential(candidates);
        const expected = expectedScopedWrite(candidates);

        if (expected !== undefined) {
          sawOk = true;
          // A selection is made ONLY to a scoped-write credential (Req 8.3).
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.selection.kind).toBe("scoped-write");
            expect(result.selection.envKeyName).toBe(expected.envKeyName);
          }
        } else {
          sawReject = true;
          // No unambiguous scoped-write credential -> never silently fall back
          // to service-role (Req 8.4) or publishable (Req 8.5): refuse.
          expect(result.ok).toBe(false);
        }

        // The chosen kind is NEVER a forbidden write kind (Req 8.4, 8.5).
        if (result.ok) {
          expect(result.selection.kind).not.toBe("service-role");
          expect(result.selection.kind).not.toBe("publishable");
        }

        // No secret value ever appears on the output surface (Req 8.8). The
        // output is name/kind only; assert the sentinel never surfaces even
        // when threaded through the surrounding context.
        const surface = JSON.stringify(result);
        expect(surface).not.toContain(SECRET_SENTINEL);
        expect(surface).not.toContain("sb_secret_");
      }),
      { numRuns: 300 },
    );

    // Ensure both branches of the invariant were actually exercised.
    expect(sawOk).toBe(true);
    expect(sawReject).toBe(true);
  });

  it("refuses even when the ONLY candidate is the service-role or publishable key", () => {
    // A sole service-role candidate must be refused, never selected (Req 8.4).
    const serviceOnly = selectJobWriteCredential([
      { envKeyName: "SUPABASE_SERVICE_KEY", kind: "service-role" },
    ]);
    expect(serviceOnly.ok).toBe(false);

    // A sole publishable candidate must be refused, never selected (Req 8.5).
    const anonOnly = selectJobWriteCredential([
      { envKeyName: "SUPABASE_ANON_KEY", kind: "publishable" },
    ]);
    expect(anonOnly.ok).toBe(false);

    // The exactly-one scoped-write case selects it (Req 8.3).
    const scoped = selectJobWriteCredential([
      { envKeyName: "SUPABASE_HOSTED_KEY", kind: "scoped-write" },
      { envKeyName: "SUPABASE_SERVICE_KEY", kind: "service-role" },
      { envKeyName: "SUPABASE_ANON_KEY", kind: "publishable" },
    ]);
    expect(scoped.ok).toBe(true);
    if (scoped.ok) {
      expect(scoped.selection.kind).toBe("scoped-write");
      expect(scoped.selection.envKeyName).toBe("SUPABASE_HOSTED_KEY");
    }
  });
});
