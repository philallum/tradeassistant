import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { VersionPolicyCheck } from "./versionPolicy.js";
import type { VersionSpec } from "./versionPolicy.js";

// Feature: fx-daily-pattern-assistant, Property 34: For all dependency/language/runtime specifications, the automated version-policy check fails if any specification is a prerelease build or uses an open-ended version range, and passes only when every specification is an exact, non-prerelease version.
//
// Validates: Requirements 18.3, 18.4, 18.8.
//
// This is the mandated Property 34 test (task 1.4). It exercises
// `VersionPolicyCheck.audit()` (implemented in task 1.3) across many generated
// specification lists, asserting the bi-conditional the property states:
//
//   audit(specs).ok === true   IFF   every spec is exact & non-prerelease
//
// Equivalently: the presence of ANY prerelease build or open-ended version
// range in the list forces the audit to fail, and an all-exact list passes.

// --- Smart generators constrained to the input space -----------------------

/**
 * An exact, non-prerelease semantic version, e.g. "5.9.3" (optionally with a
 * numeric build-metadata suffix like "1.2.3+7"). Build metadata is constrained
 * to digits so it can never collide with a prerelease word (alpha/beta/rc/...),
 * keeping every generated value a genuinely exact, non-prerelease spec.
 */
const exactVersionArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.option(fc.integer({ min: 0, max: 9999 }), { nil: undefined }),
  )
  .map(([a, b, c, build]) =>
    build === undefined ? `${a}.${b}.${c}` : `${a}.${b}.${c}+${String(build)}`,
  );

/** A prerelease build spec, e.g. "1.2.3-beta.1" / "2.0.0-rc.2" / "1.2.3-0". */
const prereleaseArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.constantFrom("alpha", "beta", "rc", "next", "canary", "nightly", "pre", "dev", "0"),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([a, b, c, tag, n]) => `${a}.${b}.${c}-${tag}.${n}`);

/** An open-ended version range / wildcard, e.g. "^1.2.3", "~1.0.0", "*", "1.x". */
const openRangeArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom("^", "~", ">=", "<=", ">", "<", "="),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
    )
    .map(([op, a, b, c]) => `${op}${a}.${b}.${c}`),
  fc.constantFrom("*", "x", "latest", "", "1.x", "1.2.x", "1", "1.2"),
  fc
    .tuple(exactVersionArb, exactVersionArb)
    .map(([lo, hi]) => `${lo} - ${hi}`),
  fc
    .tuple(exactVersionArb, exactVersionArb)
    .map(([a, b]) => `${a} || ${b}`),
);

/** Any spec that must make the audit fail (prerelease OR open-ended range). */
const invalidSpecArb: fc.Arbitrary<string> = fc.oneof(prereleaseArb, openRangeArb);

const SOURCES = ["dependencies", "devDependencies", "runtime"] as const;

const namedSpec = (name: string, s: string, source: string): VersionSpec => ({
  name,
  spec: s,
  source,
});

/** Build a labelled VersionSpec list from raw spec strings with distinct names. */
function toSpecs(rawSpecs: readonly string[], sources: readonly string[]): VersionSpec[] {
  return rawSpecs.map((s, i) =>
    namedSpec(`pkg-${String(i)}`, s, sources[i % sources.length] ?? "dependencies"),
  );
}

// --- The property -----------------------------------------------------------

describe("Property 34: version-policy enforcement", () => {
  const policy = new VersionPolicyCheck();

  it("passes IFF every specification is exact and non-prerelease", () => {
    fc.assert(
      fc.property(
        // A pool of exact and invalid (prerelease / open-ended) raw specs, and a
        // source label per position; audit.ok must equal "all specs are exact".
        fc.array(fc.oneof(exactVersionArb, invalidSpecArb), { minLength: 1, maxLength: 25 }),
        fc.array(fc.constantFrom(...SOURCES), { minLength: 1, maxLength: 25 }),
        (rawSpecs, sources) => {
          const specs = toSpecs(rawSpecs, sources);
          const result = policy.audit(specs);

          // Ground truth independent of the audit: is EVERY spec exact & stable?
          const allExact = rawSpecs.every(
            (s) => /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z-.]+)?$/.test(s.trim()),
          );

          // The bi-conditional the property asserts.
          expect(result.ok).toBe(allExact);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fails whenever at least one prerelease build is present", () => {
    fc.assert(
      fc.property(
        prereleaseArb,
        fc.array(exactVersionArb, { maxLength: 20 }),
        fc.nat(),
        (pre, exacts, insertAt) => {
          const rawSpecs = [...exacts];
          rawSpecs.splice(insertAt % (rawSpecs.length + 1), 0, pre);
          const result = policy.audit(toSpecs(rawSpecs, SOURCES));
          expect(result.ok).toBe(false);
          // The violating spec is reported as a prerelease.
          expect(result.violations.some((v) => v.reason === "prerelease")).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fails whenever at least one open-ended range is present", () => {
    fc.assert(
      fc.property(
        openRangeArb,
        fc.array(exactVersionArb, { maxLength: 20 }),
        fc.nat(),
        (range, exacts, insertAt) => {
          const rawSpecs = [...exacts];
          rawSpecs.splice(insertAt % (rawSpecs.length + 1), 0, range);
          const result = policy.audit(toSpecs(rawSpecs, SOURCES));
          expect(result.ok).toBe(false);
          // A range/wildcard is reported as open-ended (or unrecognized for edge tokens).
          expect(
            result.violations.some((v) => /open-ended-range|unrecognized/.test(v.reason)),
          ).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("passes for any list composed only of exact, non-prerelease versions", () => {
    fc.assert(
      fc.property(
        fc.array(exactVersionArb, { minLength: 1, maxLength: 25 }),
        (exacts) => {
          const result = policy.audit(toSpecs(exacts, SOURCES));
          expect(result.ok).toBe(true);
          expect(result.violations).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
