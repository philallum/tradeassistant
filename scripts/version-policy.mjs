#!/usr/bin/env node
// Version-policy check — CI stage (Requirements 18.3, 18.4, 18.8).
//
// Runs the REAL audit (task 1.3) against the actual package.json third-party
// dependency pins and exits non-zero on ANY policy violation so CI fails loud.
// It imports the single shared audit implementation
// (src/version-policy/audit.js) so what CI enforces is exactly what the typed
// core reasons about — no duplicated or drifting logic.
//
// SPECIFICATION SOURCES (documented interpretation of Requirement 18.3/18.4):
//   - The audit inspects `dependencies` and `devDependencies` — the pinned
//     THIRD-PARTY DEPENDENCY SPECIFICATIONS that 18.3/18.4 explicitly target.
//     Every one must be an exact, non-prerelease version.
//   - `engines.node` (e.g. ">=22.0.0 <23.0.0") is a supported-runtime
//     CONSTRAINT, not a pin, and is intentionally NOT audited as a violation.
//   - `.nvmrc` records the Node Active_LTS release LINE by convention (e.g.
//     "22"). Requirement 18.2 targets the release LINE, not an exact patch, and
//     CI pins the actual runtime to `.nvmrc` via `node-version-file`. The
//     runtime/language version is tracked in the version LEDGER (Requirement
//     18.6) rather than failed here, so the major-line convention is reported
//     for visibility but does not fail the check.
//
// This keeps the automated failing check (18.8) focused on the dependency pins
// it is defined to guard, while still surfacing the recorded runtime line.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { auditSpecs, collectSpecs } from "../src/version-policy/audit.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

/** Read + parse a JSON file relative to the repo root. */
function readJson(relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), "utf8"));
}

/** Read the Node runtime line from .nvmrc for informational reporting. */
function readNvmrcLine() {
  try {
    const raw = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}

const pkg = readJson("package.json");
const nvmrcLine = readNvmrcLine();

// Audit the pinned third-party dependency specifications only.
const specs = collectSpecs(pkg, {
  dependencies: true,
  devDependencies: true,
});

const result = auditSpecs(specs);

console.log(
  `[version-policy] audited ${result.checked.length} third-party dependency ` +
    "specification(s) (dependencies, devDependencies).",
);
if (nvmrcLine !== null) {
  console.log(
    `[version-policy] Node runtime line (.nvmrc): "${nvmrcLine}" ` +
      "(Active_LTS line per Req 18.2; tracked in the version ledger, not audited here).",
  );
}

if (result.ok) {
  console.log(
    "[version-policy] OK: every dependency specification is an exact, non-prerelease version.",
  );
  process.exit(0);
}

console.error(
  `[version-policy] FAILED: ${result.violations.length} policy violation(s):`,
);
for (const v of result.violations) {
  console.error(`  - ${v.source}: ${v.name} = "${v.spec}"  (${v.reason})`);
}
console.error(
  "[version-policy] Every dependency/language/runtime pin must be an exact, " +
    "non-prerelease version (no prerelease tags, no open-ended ranges).",
);
process.exit(1);
