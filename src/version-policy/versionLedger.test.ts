import { describe, expect, it } from "vitest";
import {
  InMemoryVersionLedgerStore,
  VersionPolicyCheck,
} from "./versionPolicy.js";
import type {
  VersionLedgerEntry,
  VersionLedgerStore,
} from "./versionPolicy.js";

// Unit tests for the version ledger (task 1.5).
//
// These focus specifically on the two behaviours task 1.5 calls out:
//   - record() persists the selected version + verification date to the ledger
//     (Requirement 18.6)
//   - availableUpgrades() surfaces newer stable versions for human review, and
//     does NOT surface prereleases or non-newer versions (Requirement 18.7)
//
// The property-based enforcement of the audit itself is covered by Property 34
// (task 1.4); here we exercise example-based edge cases of the ledger API.

const entry = (
  name: string,
  selectedVersion: string,
  verificationDate: string,
  latestKnown?: string,
): VersionLedgerEntry =>
  latestKnown === undefined
    ? { name, selectedVersion, verificationDate }
    : { name, selectedVersion, verificationDate, latestKnown };

// --- record(): persists version + verification date (Requirement 18.6) ------

describe("VersionPolicyCheck.record — persists version + verification date", () => {
  it("persists the selected version and verification date to the ledger", () => {
    const policy = new VersionPolicyCheck();
    policy.record(entry("typescript", "5.9.3", "2025-01-15"));

    const ledger = policy.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual({
      name: "typescript",
      selectedVersion: "5.9.3",
      verificationDate: "2025-01-15",
    });
  });

  it("persists the optional latest-known stable version for upgrade review", () => {
    const policy = new VersionPolicyCheck();
    policy.record(entry("vitest", "3.2.7", "2025-01-15", "3.3.0"));

    const [row] = policy.ledger();
    expect(row?.selectedVersion).toBe("3.2.7");
    expect(row?.verificationDate).toBe("2025-01-15");
    expect(row?.latestKnown).toBe("3.3.0");
  });

  it("records multiple distinct components independently", () => {
    const policy = new VersionPolicyCheck();
    policy.record(entry("typescript", "5.9.3", "2025-01-15"));
    policy.record(entry("vitest", "3.2.7", "2025-01-16"));
    policy.record(entry("eslint", "9.39.5", "2025-01-17"));

    const byName = new Map(policy.ledger().map((e) => [e.name, e]));
    expect(byName.size).toBe(3);
    expect(byName.get("typescript")?.selectedVersion).toBe("5.9.3");
    expect(byName.get("vitest")?.verificationDate).toBe("2025-01-16");
    expect(byName.get("eslint")?.selectedVersion).toBe("9.39.5");
  });

  it("upserts by component name so the latest verification wins", () => {
    const policy = new VersionPolicyCheck();
    policy.record(entry("typescript", "5.9.2", "2025-01-01"));
    policy.record(entry("typescript", "5.9.3", "2025-02-01"));

    const ledger = policy.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.selectedVersion).toBe("5.9.3");
    expect(ledger[0]?.verificationDate).toBe("2025-02-01");
  });

  it("starts empty before any record is made", () => {
    const policy = new VersionPolicyCheck();
    expect(policy.ledger()).toHaveLength(0);
  });

  it("writes through the injected store port (storage stays decoupled)", () => {
    const store = new InMemoryVersionLedgerStore();
    const policy = new VersionPolicyCheck(store);
    policy.record(entry("typescript", "5.9.3", "2025-01-15"));

    // The entry is observable directly on the injected store, proving the
    // policy persists through the port rather than any private state.
    expect(store.all()).toEqual([
      {
        name: "typescript",
        selectedVersion: "5.9.3",
        verificationDate: "2025-01-15",
      },
    ]);
    expect(store.all()).toEqual(policy.ledger());
  });

  it("uses an alternate store implementation when supplied", () => {
    // A minimal spy store confirms record() delegates to the port's put().
    const puts: VersionLedgerEntry[] = [];
    const spyStore: VersionLedgerStore = {
      put: (e) => puts.push(e),
      all: () => puts,
    };
    const policy = new VersionPolicyCheck(spyStore);
    policy.record(entry("node", "22.20.2", "2025-01-15"));

    expect(puts).toHaveLength(1);
    expect(puts[0]?.name).toBe("node");
    expect(puts[0]?.selectedVersion).toBe("22.20.2");
    expect(puts[0]?.verificationDate).toBe("2025-01-15");
  });
});

// --- availableUpgrades(): surface newer stable versions (Requirement 18.7) --

describe("VersionPolicyCheck.availableUpgrades — surface newer stable versions", () => {
  it("surfaces a component whose newest known stable version is higher", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [{ name: "typescript", spec: "5.9.3" }],
      { typescript: "5.10.0" },
    );
    expect(upgrades).toEqual([
      { name: "typescript", current: "5.9.3", available: "5.10.0" },
    ]);
  });

  it("surfaces only the components that actually have a newer version", () => {
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

  it("does not surface a component already at its latest known version", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [{ name: "vitest", spec: "3.2.7" }],
      { vitest: "3.2.7" },
    );
    expect(upgrades).toHaveLength(0);
  });

  it("does not surface a component whose known version is older than the pin", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [{ name: "typescript", spec: "5.9.3" }],
      { typescript: "5.9.1" },
    );
    expect(upgrades).toHaveLength(0);
  });

  it("never surfaces a prerelease build as an available upgrade", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [
        { name: "typescript", spec: "5.9.3" },
        { name: "vitest", spec: "3.2.7" },
      ],
      { typescript: "5.10.0-beta.1", vitest: "3.3.0-rc.2" },
    );
    expect(upgrades).toHaveLength(0);
  });

  it("recognises a higher major/minor version as newer", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [
        { name: "major-bump", spec: "1.9.9" },
        { name: "minor-bump", spec: "2.1.4" },
        { name: "patch-bump", spec: "3.0.0" },
      ],
      { "major-bump": "2.0.0", "minor-bump": "2.2.0", "patch-bump": "3.0.1" },
    );
    const names = upgrades.map((u) => u.name).sort();
    expect(names).toEqual(["major-bump", "minor-bump", "patch-bump"]);
  });

  it("ignores components with no known available version", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [
        { name: "typescript", spec: "5.9.3" },
        { name: "private-pkg", spec: "1.0.0" },
      ],
      { typescript: "5.10.0" },
    );
    expect(upgrades.map((u) => u.name)).toEqual(["typescript"]);
  });

  it("returns an empty list when nothing is out of date", () => {
    const policy = new VersionPolicyCheck();
    const upgrades = policy.availableUpgrades(
      [
        { name: "typescript", spec: "5.9.3" },
        { name: "vitest", spec: "3.2.7" },
      ],
      { typescript: "5.9.3", vitest: "3.2.7" },
    );
    expect(upgrades).toHaveLength(0);
  });
});
