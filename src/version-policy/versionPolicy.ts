// Version-Policy Check and version ledger (Requirements 18.3, 18.4, 18.6, 18.7, 18.8).
//
// Deterministic core (Requirement 3.2): `audit` and `availableUpgrades` are
// pure functions with no hidden mutable state. `record` is the only
// side-effecting operation and it writes through an injectable store PORT, so
// the ledger persistence is independent of any concrete storage/serving layer
// (Requirement 17.1). The Supabase-backed `version_ledger` table (task 2.1) can
// implement the same port later without changing this module. Until then a
// default in-memory store keeps this task self-contained and testable.

import {
  auditSpecs,
  availableUpgradesFor,
  collectSpecs,
} from "./audit.js";
import type {
  AuditResult,
  CollectOptions,
  UpgradeCandidate,
  VersionSpec,
} from "./audit.js";

export type {
  AuditResult,
  CollectOptions,
  SpecClassification,
  SpecViolation,
  UpgradeCandidate,
  VersionSpec,
} from "./audit.js";

/**
 * A single row of the version ledger (mirrors the `version_ledger` table in the
 * design: component/version/is_prerelease/verified_at/latest_known).
 * Requirement 18.6.
 */
export interface VersionLedgerEntry {
  /** language / runtime / dependency name (ledger primary key). */
  readonly name: string;
  /** the exact pinned version selected (Requirement 18.3). */
  readonly selectedVersion: string;
  /** ISO date (YYYY-MM-DD) the version was verified as Latest_Stable. */
  readonly verificationDate: string;
  /** newest stable version known at verification time, for upgrade review. */
  readonly latestKnown?: string;
}

/**
 * The ledger persistence PORT. Compute stays independent of storage
 * (Requirement 17.1): callers inject any implementation (in-memory today,
 * Supabase-backed after task 2.1) without changing the policy logic.
 */
export interface VersionLedgerStore {
  /** Upsert a ledger entry keyed by `entry.name`. */
  put(entry: VersionLedgerEntry): void;
  /** Read all recorded entries (order not guaranteed). */
  all(): readonly VersionLedgerEntry[];
}

/**
 * Default in-memory ledger store. Deterministic and dependency-free; suitable
 * for tests and for wiring before the Supabase schema exists.
 */
export class InMemoryVersionLedgerStore implements VersionLedgerStore {
  readonly #entries = new Map<string, VersionLedgerEntry>();

  put(entry: VersionLedgerEntry): void {
    this.#entries.set(entry.name, entry);
  }

  all(): readonly VersionLedgerEntry[] {
    return [...this.#entries.values()];
  }
}

/**
 * The Version-Policy Check (design component 13).
 *
 * `audit` classifies each specification as valid (exact, non-prerelease) or
 * invalid (prerelease OR open-ended range). `record` writes a ledger entry
 * through the injected store. `availableUpgrades` surfaces newer stable
 * versions for human review.
 */
export class VersionPolicyCheck {
  readonly #store: VersionLedgerStore;

  constructor(store: VersionLedgerStore = new InMemoryVersionLedgerStore()) {
    this.#store = store;
  }

  /**
   * Audit a flat list of version specifications. Pure.
   * Fails (`ok === false`) if any specification is a prerelease build or an
   * open-ended version range (Requirements 18.4, 18.8).
   */
  audit(specs: readonly VersionSpec[]): AuditResult {
    return auditSpecs(specs);
  }

  /**
   * Convenience: collect specifications from a package.json-shaped object
   * (plus optional language/runtime pins) and audit them. Which sources are
   * inspected is configurable (Requirement 18.3/18.4 target pinned third-party
   * dependency specifications and explicit language/runtime pins).
   */
  auditPackage(pkg: unknown, options?: CollectOptions): AuditResult {
    return this.audit(collectSpecs(pkg, options));
  }

  /**
   * Record a selected version + verification date in the ledger
   * (Requirement 18.6). Persists through the injected store port.
   */
  record(entry: VersionLedgerEntry): void {
    this.#store.put(entry);
  }

  /** All recorded ledger entries. */
  ledger(): readonly VersionLedgerEntry[] {
    return this.#store.all();
  }

  /**
   * Surface newer stable versions for human review (Requirement 18.7). Pure:
   * callers supply the map of latest-known versions (obtained out-of-band).
   */
  availableUpgrades(
    currentSpecs: readonly { readonly name: string; readonly spec: string }[],
    availableVersions: Readonly<Record<string, string>>,
  ): UpgradeCandidate[] {
    return availableUpgradesFor(currentSpecs, availableVersions);
  }
}

export { collectSpecs };
