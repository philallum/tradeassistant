// Pure version-policy audit logic (Requirements 18.3, 18.4, 18.7, 18.8).
//
// This module is authored in plain JavaScript on purpose: it is the single
// source of truth for version-specification classification and it is imported
// BOTH by the deterministic TypeScript core (`versionPolicy.ts`, via the
// companion `audit.d.ts`) AND by the CI wrapper script `scripts/version-policy.mjs`.
//
// CI runs `node scripts/version-policy.mjs` with no build step, so the check
// cannot depend on compiled output under `dist/`. Keeping the logic in a
// runtime-loadable ESM `.js` module lets the raw Node script and the typed core
// share exactly one implementation, so there is no drift between what CI
// enforces and what the core reasons about.
//
// Everything here is a pure function with no hidden mutable state
// (Requirement 3.2): given the same specifications it always returns the same
// classification.

/**
 * Interpretation of the policy (documented per task guidance):
 *
 *   A version SPECIFICATION passes iff it is an EXACT, non-prerelease semantic
 *   version (e.g. "5.9.3"). It FAILS if it is either
 *     (a) a prerelease build  -> contains a semver prerelease tag such as
 *         -alpha / -beta / -rc / -next / -canary / -nightly, or
 *     (b) an open-ended range -> uses any range operator or wildcard
 *         (^, ~, >=, <=, >, <, =, *, x/X wildcards, "||", hyphen ranges,
 *         blank, "latest", "*").
 *
 * SPECIFICATION SOURCES: Requirement 18.3/18.4 target pinned third-party
 * dependency SPECIFICATIONS (the `dependencies` / `devDependencies` maps). The
 * `engines.node` field (e.g. ">=22.0.0 <23.0.0") is a supported-runtime
 * CONSTRAINT, not a pin, and the `.nvmrc` file records the Node Active_LTS
 * release LINE (e.g. "22") per Requirement 18.2 — neither is a third-party
 * dependency pin. `collectSpecs` therefore audits dependencies/devDependencies
 * by default and lets callers opt IN to auditing explicit language/runtime pins
 * (exact versions) via `options.runtime` when they want them enforced as pins.
 * The CI wrapper (scripts/version-policy.mjs) audits the dependency maps and
 * reports the `.nvmrc` line for visibility (it is tracked in the version ledger
 * rather than failed, since 18.2 targets the release line, not an exact patch).
 */

/** Prerelease identifiers that always mark a spec as a prerelease build. */
const PRERELEASE_WORDS = ["alpha", "beta", "rc", "next", "canary", "nightly", "pre", "dev"];

/**
 * Range operators / wildcards that make a specification open-ended.
 * `=` is included: an explicitly-operator-prefixed version is still a range
 * expression rather than a bare exact pin.
 */
const RANGE_OPERATORS = ["^", "~", ">", "<", "=", "*", "|", " - "];

/**
 * True when `raw` is a bare exact semantic version like "1.2.3" (optionally
 * with a build-metadata suffix like "1.2.3+build"), with NO prerelease tag and
 * NO range operator.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isExactStableVersion(raw) {
  return /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z-.]+)?$/.test(raw.trim());
}

/**
 * True when the specification contains a semver prerelease tag or a known
 * prerelease word (alpha/beta/rc/next/canary/nightly/...).
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isPrerelease(raw) {
  const spec = raw.trim().toLowerCase();
  // A hyphen after the numeric version core denotes a semver prerelease tag,
  // e.g. "1.2.3-rc.1" or "1.2.3-0". Guard against hyphen RANGES ("1.0.0 - 2.0.0")
  // which contain spaces around the hyphen and are handled as open-ended ranges.
  if (/^\d+\.\d+\.\d+-[0-9a-z]/.test(spec)) {
    return true;
  }
  return PRERELEASE_WORDS.some((word) => spec.includes(word));
}

/**
 * True when the specification is an open-ended range or wildcard rather than an
 * exact pin. Covers ^, ~, comparison operators, "*"/"x" wildcards, "||" unions,
 * hyphen ranges, empty strings, and "latest".
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isOpenEndedRange(raw) {
  const spec = raw.trim().toLowerCase();
  if (spec === "" || spec === "latest" || spec === "*" || spec === "x") {
    return true;
  }
  if (RANGE_OPERATORS.some((op) => spec.includes(op))) {
    return true;
  }
  // x-ranges such as "1.x", "1.2.x", "1.X".
  if (/(^|\.)x($|\.)/.test(spec)) {
    return true;
  }
  // A partial version like "1" or "1.2" (fewer than three dotted parts) is an
  // implicit range and is not an exact pin.
  if (/^\d+(\.\d+)?$/.test(spec)) {
    return true;
  }
  return false;
}

/**
 * Classify a single version specification.
 *
 * @param {string} name
 * @param {string} raw
 * @param {string} source
 * @returns {{name: string, source: string, spec: string, valid: boolean, reason: string | null}}
 */
function classifySpec(name, raw, source) {
  const spec = String(raw);
  if (isPrerelease(spec)) {
    return { name, source, spec, valid: false, reason: "prerelease" };
  }
  if (isExactStableVersion(spec)) {
    return { name, source, spec, valid: true, reason: null };
  }
  if (isOpenEndedRange(spec)) {
    return { name, source, spec, valid: false, reason: "open-ended-range" };
  }
  // Anything that is neither a recognizable exact version nor a recognizable
  // range is treated as invalid (unrecognized specification) rather than
  // silently passing.
  return { name, source, spec, valid: false, reason: "unrecognized" };
}

/**
 * Audit a flat list of version specifications.
 *
 * @param {ReadonlyArray<{name: string, spec: string, source: string}>} specs
 * @returns {{ok: boolean, violations: Array<{name: string, source: string, spec: string, reason: string}>, checked: Array<{name: string, source: string, spec: string, valid: boolean, reason: string | null}>}}
 */
export function auditSpecs(specs) {
  const checked = specs.map((s) => classifySpec(s.name, s.spec, s.source));
  const violations = checked
    .filter((c) => !c.valid)
    .map((c) => ({ name: c.name, source: c.source, spec: c.spec, reason: c.reason ?? "invalid" }));
  return { ok: violations.length === 0, violations, checked };
}

/**
 * Flatten a package.json-shaped object and optional runtime pins into the flat
 * specification list `auditSpecs` consumes.
 *
 * @param {object} pkg parsed package.json
 * @param {{ dependencies?: boolean, devDependencies?: boolean, runtime?: ReadonlyArray<{name: string, spec: string}> }} [options]
 * @returns {Array<{name: string, spec: string, source: string}>}
 */
export function collectSpecs(pkg, options = {}) {
  const includeDeps = options.dependencies !== false;
  const includeDev = options.devDependencies !== false;
  /** @type {Array<{name: string, spec: string, source: string}>} */
  const out = [];

  if (includeDeps && pkg && typeof pkg.dependencies === "object" && pkg.dependencies) {
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      out.push({ name, spec: String(spec), source: "dependencies" });
    }
  }
  if (includeDev && pkg && typeof pkg.devDependencies === "object" && pkg.devDependencies) {
    for (const [name, spec] of Object.entries(pkg.devDependencies)) {
      out.push({ name, spec: String(spec), source: "devDependencies" });
    }
  }
  for (const pin of options.runtime ?? []) {
    out.push({ name: pin.name, spec: String(pin.spec), source: "runtime" });
  }
  return out;
}

/**
 * Compare pinned specifications against the newest known available versions and
 * surface entries where a newer STABLE (non-prerelease) version exists, for
 * human review (Requirement 18.7). Pure: no network access here.
 *
 * @param {ReadonlyArray<{name: string, spec: string}>} currentSpecs
 * @param {Readonly<Record<string, string>>} availableVersions map name -> latest known version
 * @returns {Array<{name: string, current: string, available: string}>}
 */
export function availableUpgradesFor(currentSpecs, availableVersions) {
  /** @type {Array<{name: string, current: string, available: string}>} */
  const upgrades = [];
  for (const { name, spec } of currentSpecs) {
    const available = availableVersions[name];
    if (available === undefined) {
      continue;
    }
    // Never suggest an upgrade to a prerelease build.
    if (isPrerelease(available)) {
      continue;
    }
    if (compareVersions(available, spec) > 0) {
      upgrades.push({ name, current: spec, available });
    }
  }
  return upgrades;
}

/**
 * Compare two dotted numeric version cores. Ignores range operators / prerelease
 * tags for ordering purposes; only the leading numeric core is considered.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 1 if a>b, -1 if a<b, 0 if equal
 */
export function compareVersions(a, b) {
  const pa = numericCore(a);
  const pb = numericCore(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * @param {string} raw
 * @returns {number[]}
 */
function numericCore(raw) {
  const core = String(raw)
    .trim()
    .replace(/^[^0-9]*/, "") // strip leading range operators like ^ ~ >=
    .split(/[-+]/, 1)[0]; // drop prerelease / build metadata
  return core.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}
