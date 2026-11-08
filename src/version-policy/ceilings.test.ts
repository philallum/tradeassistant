import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SUPPORTED_MAJOR_CEILINGS,
  VersionPolicyCheck,
} from "./versionPolicy.js";
import type { SupportedMajorCeilings, VersionSpec } from "./versionPolicy.js";

// Supported-major CEILING audit (CHANGE 2 of the dependency-upgrade-policy
// hardening). These ceilings are the durable, CI-enforced record of which
// major upgrades are deliberately held (TS7 blocked upstream, the React 19
// deferred migration, @types/node tracking the Node 22 line). They
// MUST stay consistent with the Dependabot `ignore:` rules in
// .github/dependabot.yml.

const spec = (name: string, s: string, source = "dependencies"): VersionSpec => ({
  name,
  spec: s,
  source,
});

describe("auditCeilings — unit", () => {
  const policy = new VersionPolicyCheck();

  it("passes a spec exactly at its ceiling", () => {
    const result = policy.auditCeilings([spec("react", "18.3.1")]);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes a spec below its ceiling", () => {
    const result = policy.auditCeilings([spec("typescript", "5.9.3", "devDependencies")]);
    expect(result.ok).toBe(true);
  });

  it("fails a spec whose major exceeds its ceiling", () => {
    const result = policy.auditCeilings([spec("@types/node", "23.0.0", "devDependencies")]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.name).toBe("@types/node");
    expect(result.violations[0]?.major).toBe(23);
    expect(result.violations[0]?.ceiling).toBe(22);
    expect(result.violations[0]?.reason).toBe("exceeds-supported-major (<=22)");
  });

  it("ignores packages absent from the ceilings map", () => {
    const result = policy.auditCeilings([spec("vitest", "99.0.0", "devDependencies")]);
    expect(result.ok).toBe(true);
  });

  it("flags typescript 7 (blocked upstream hold)", () => {
    const result = policy.auditCeilings([spec("typescript", "7.0.2", "devDependencies")]);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.ceiling).toBe(6);
  });

  it("flags React 19 across the whole coupled family", () => {
    const result = policy.auditCeilings([
      spec("react", "19.0.0"),
      spec("react-dom", "19.0.0"),
      spec("@types/react", "19.0.0", "devDependencies"),
      spec("@types/react-dom", "19.0.0", "devDependencies"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.name).sort()).toEqual([
      "@types/react",
      "@types/react-dom",
      "react",
      "react-dom",
    ]);
  });

  it("accepts a custom ceilings map", () => {
    const ceilings: SupportedMajorCeilings = { foo: 4 };
    expect(policy.auditCeilings([spec("foo", "4.9.9")], ceilings).ok).toBe(true);
    expect(policy.auditCeilings([spec("foo", "5.0.0")], ceilings).ok).toBe(false);
  });

  it("the canonical constant pins the documented ceilings", () => {
    expect(SUPPORTED_MAJOR_CEILINGS).toEqual({
      typescript: 6,
      "@types/node": 22,
      react: 18,
      "react-dom": 18,
      "@types/react": 18,
      "@types/react-dom": 18,
    });
  });
});

// --- Property-based coverage (fast-check, >=100 iterations) ---

const CEILING_NAMES = Object.keys(SUPPORTED_MAJOR_CEILINGS);

/** An exact version string with a chosen major and arbitrary minor/patch. */
const versionWithMajorArb = (major: number): fc.Arbitrary<string> =>
  fc
    .tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }))
    .map(([minor, patch]) => `${String(major)}.${String(minor)}.${String(patch)}`);

const nameArb = fc.constantFrom(...CEILING_NAMES);

describe("auditCeilings — properties", () => {
  const policy = new VersionPolicyCheck();

  it("any version with major > ceiling is flagged", () => {
    fc.assert(
      fc.property(
        nameArb.chain((name) => {
          const ceiling = SUPPORTED_MAJOR_CEILINGS[name] as number;
          return fc
            .integer({ min: ceiling + 1, max: ceiling + 50 })
            .chain((major) => versionWithMajorArb(major).map((v) => ({ name, v, ceiling })));
        }),
        ({ name, v, ceiling }) => {
          const result = policy.auditCeilings([spec(name, v)]);
          return (
            !result.ok &&
            result.violations.length === 1 &&
            result.violations[0]?.ceiling === ceiling
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("any version with major <= ceiling passes", () => {
    fc.assert(
      fc.property(
        nameArb.chain((name) => {
          const ceiling = SUPPORTED_MAJOR_CEILINGS[name] as number;
          return fc
            .integer({ min: 0, max: ceiling })
            .chain((major) => versionWithMajorArb(major).map((v) => ({ name, v })));
        }),
        ({ name, v }) => policy.auditCeilings([spec(name, v)]).ok,
      ),
      { numRuns: 200 },
    );
  });
});
