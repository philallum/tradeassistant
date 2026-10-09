// Type declarations for the pure JS audit module (`audit.js`).
//
// The audit logic lives in plain JS so the CI wrapper (scripts/version-policy.mjs)
// and the typed core can share one implementation without a build step. These
// declarations give the TypeScript core strict types over that shared module.

/** How a single specification was classified during an audit. */
export interface SpecClassification {
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly valid: boolean;
  readonly reason: string | null;
}

/** A specification that violated the policy. */
export interface SpecViolation {
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly reason: string;
}

/** Result of auditing a flat list of specifications. */
export interface AuditResult {
  readonly ok: boolean;
  readonly violations: readonly SpecViolation[];
  readonly checked: readonly SpecClassification[];
}

/** A single version specification to audit. */
export interface VersionSpec {
  readonly name: string;
  readonly spec: string;
  readonly source: string;
}

/** Options controlling which specification sources are collected. */
export interface CollectOptions {
  readonly dependencies?: boolean;
  readonly devDependencies?: boolean;
  readonly runtime?: readonly { readonly name: string; readonly spec: string }[];
}

/** A newer stable version available for human review. */
export interface UpgradeCandidate {
  readonly name: string;
  readonly current: string;
  readonly available: string;
}

/** A map of package name -> maximum allowed major version (integer). */
export type SupportedMajorCeilings = Readonly<Record<string, number>>;

/** A specification that exceeds its supported-major ceiling. */
export interface CeilingViolation {
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly major: number;
  readonly ceiling: number;
  readonly reason: string;
}

/** Result of auditing specifications against supported-major ceilings. */
export interface CeilingAuditResult {
  readonly ok: boolean;
  readonly violations: readonly CeilingViolation[];
}

/**
 * Canonical supported-major ceilings. Kept consistent with the Dependabot
 * `ignore:` rules in `.github/dependabot.yml` (see that file and audit.js).
 */
export const SUPPORTED_MAJOR_CEILINGS: SupportedMajorCeilings;

export function auditSpecs(specs: readonly VersionSpec[]): AuditResult;

export function auditCeilings(
  specs: readonly VersionSpec[],
  ceilings: SupportedMajorCeilings,
): CeilingAuditResult;

export function collectSpecs(
  pkg: unknown,
  options?: CollectOptions,
): VersionSpec[];

export function availableUpgradesFor(
  currentSpecs: readonly { readonly name: string; readonly spec: string }[],
  availableVersions: Readonly<Record<string, string>>,
): UpgradeCandidate[];

export function compareVersions(a: string, b: string): number;
