import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  InMemoryVersionLedgerStore,
  VersionPolicyCheck,
} from "./versionPolicy.js";
import type { VersionSpec } from "./versionPolicy.js";

// Solid unit + property coverage for the code added in task 1.3. (The mandated
// Property 34 test is task 1.4 and the full ledger unit suite is task 1.5;
// these tests exist to satisfy verification for what this task introduces.)

const spec = (name: string, s: string, source = "dependencies"): VersionSpec => ({
  name,
  spec: s,
  source,
});

describe("VersionPolicyCheck.audit — exact versions pass", () => {
  it("passes for a list of exact, non-prerelease versions", () => {
    const policy = new VersionPolicyCheck();
    const result = policy.audit([
      spec("typescript", "5.9.3"),
      spec("vitest", "3.2.7", "devDependencies"),
      spec("node (.nvmrc)", "22.20.2", "runtime"),
    ]);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes an exact version carrying only build metadata", () => {
    const policy = new VersionPolicyCheck();
    const result = policy.audit([spec("pkg", "1.2.3+build.7")]);
    expect(result.ok).toBe(true);
  });
});

describe("VersionPolicyCheck.audit — prerelease tags fail", () => {
  it.each([
    ["1.2.3-alpha.1"],
    ["1.2.3-beta"],
    ["2.0.0-rc.2"],
    ["3.1.0-next.5"],
    ["4.0.0-canary"],
    ["5.0.0-nightly.20240101"],
    ["1.2.3-0"],
  ])("fails prerelease spec %s", (s) => {
    const policy = new VersionPolicyCheck();
    const result = policy.audit([spec("pkg", s)]);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.reason).toBe("prerelease");
  });
});

describe("VersionPolicyCheck.audit — open-ended ranges fail", () => {
  it.each([
    ["^1.2.3"],
    ["~1.2.3"],
    [">=1.2.3"],
    ["<=2.0.0"],
    [">1.0.0"],
    ["<2.0.0"],
    ["=1.2.3"],
    ["*"],
    ["1.x"],
    ["1.2.x"],
    ["1"],
    ["1.2"],
    ["latest"],
    [""],
    ["1.0.0 - 2.0.0"],
    ["1.2.3 || 2.0.0"],
  ])("fails open-ended spec %s", (s) => {
    const policy = new VersionPolicyCheck();
    const result = policy.audit([spec("pkg", s)]);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.reason).toMatch(/open-ended-range|unrecognized/);
  });
});

describe("VersionPolicyCheck.audit — mixed and structured result", () => {
  it("reports each violation with its source and spec", () => {
    const policy = new VersionPolicyCheck();
    const result = policy.audit([
      spec("good", "1.0.0"),
      spec("range", "^2.0.0", "devDependencies"),
      spec("pre", "3.0.0-beta.1", "runtime"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
    const names = result.violations.map((v) => v.name).sort();
    expect(names).toEqual(["pre", "range"]);
  });
});

describe("VersionPolicyCheck.auditPackage — source selection", () => {
  const pkg = {
    dependencies: { good: "1.0.0" },
    devDependencies: { bad: "^2.0.0" },
    engines: { node: ">=22.0.0 <23.0.0" },
  };

  it("audits dependencies and devDependencies by default (engines ignored)", () => {
    const policy = new VersionPolicyCheck();
    const result = policy.auditPackage(pkg);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.name)).toEqual(["bad"]);
  });

  it("can restrict inspection to dependencies only", () => {
    const policy = new VersionPolicyCheck();
    const result = policy.auditPackage(pkg, { devDependencies: false });
    expect(result.ok).toBe(true);
  });

  it("audits explicit runtime pins when supplied", () => {
    const policy = new VersionPolicyCheck();
    const result = policy.auditPackage(
      { dependencies: { good: "1.0.0" } },
      { runtime: [{ name: "node", spec: "22.20.2" }] },
    );
    expect(result.ok).toBe(true);
  });
});

describe("version ledger — record via injectable store port", () => {
  it("records selected version + verification date through the store", () => {
    const store = new InMemoryVersionLedgerStore();
    const policy = new VersionPolicyCheck(store);
    policy.record({
      name: "typescript",
      selectedVersion: "5.9.3",
      verificationDate: "2025-01-15",
    });
    expect(policy.ledger()).toEqual([
      { name: "typescript", selectedVersion: "5.9.3", verificationDate: "2025-01-15" },
    ]);
  });

  it("upserts by name (latest write wins)", () => {
    const policy = new VersionPolicyCheck();
    policy.record({ name: "typescript", selectedVersion: "5.9.2", verificationDate: "2025-01-01" });
    policy.record({ name: "typescript", selectedVersion: "5.9.3", verificationDate: "2025-02-01" });
    const ledger = policy.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.selectedVersion).toBe("5.9.3");
  });
});

describe("availableUpgrades — surface newer stable versions", () => {
  it("surfaces only entries with a newer stable version", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [
        { name: "typescript", spec: "5.9.3" },
        { name: "vitest", spec: "3.2.7" },
        { name: "eslint", spec: "9.39.5" },
      ],
      { typescript: "5.10.0", vitest: "3.2.7", eslint: "9.40.0" },
    );
    const names = upgrades.map((u) => u.name).sort();
    expect(names).toEqual(["eslint", "typescript"]);
  });

  it("never surfaces a prerelease as an upgrade", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [{ name: "typescript", spec: "5.9.3" }],
      { typescript: "5.10.0-beta.1" },
    );
    expect(upgrades).toHaveLength(0);
  });
});

// --- Property-based coverage (fast-check, >=100 iterations) ---

const exactVersionArb = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([a, b, c]) => `${a}.${b}.${c}`);

const prereleaseArb = fc
  .tuple(exactVersionArb, fc.constantFrom("alpha", "beta", "rc", "next", "canary", "nightly"))
  .map(([v, tag]) => `${v}-${tag}.1`);

const rangeArb = fc
  .tuple(fc.constantFrom("^", "~", ">=", "<=", ">", "<"), exactVersionArb)
  .map(([op, v]) => `${op}${v}`);

describe("VersionPolicyCheck.audit — properties", () => {
  it("all exact non-prerelease versions pass", () => {
    fc.assert(
      fc.property(fc.array(exactVersionArb, { minLength: 1, maxLength: 20 }), (versions) => {
        const policy = new VersionPolicyCheck();
        const specs = versions.map((v, i) => spec(`p${String(i)}`, v));
        return policy.audit(specs).ok === true;
      }),
      { numRuns: 200 },
    );
  });

  it("any prerelease spec forces the audit to fail", () => {
    fc.assert(
      fc.property(prereleaseArb, fc.array(exactVersionArb), (pre, rest) => {
        const policy = new VersionPolicyCheck();
        const specs = [spec("pre", pre), ...rest.map((v, i) => spec(`p${String(i)}`, v))];
        return policy.audit(specs).ok === false;
      }),
      { numRuns: 200 },
    );
  });

  it("any open-ended range spec forces the audit to fail", () => {
    fc.assert(
      fc.property(rangeArb, fc.array(exactVersionArb), (range, rest) => {
        const policy = new VersionPolicyCheck();
        const specs = [spec("range", range), ...rest.map((v, i) => spec(`p${String(i)}`, v))];
        return policy.audit(specs).ok === false;
      }),
      { numRuns: 200 },
    );
  });
});
