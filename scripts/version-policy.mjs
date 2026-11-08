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
//
// SCOPE: both package trees are audited. The root manifest (package.json,
// source "dependencies"/"devDependencies") AND the standalone dashboard SPA
// (web/package.json, source "web/dependencies"/"web/devDependencies") are
// checked for exact pins, so a non-exact spec in EITHER tree fails CI.
//
// SUPPORTED-MAJOR CEILINGS: in addition to the exact-pin check, every spec in
// both trees is audited against SUPPORTED_MAJOR_CEILINGS (defined in
// src/version-policy/audit.js). A pin whose major exceeds its ceiling fails CI
// loud. These ceilings are the durable record of deliberately-held majors
// (TS7 blocked upstream; React 19 deferred migration; @types/node
// tracking the Node 22 line) and MUST stay consistent with the Dependabot
// `ignore:` rules in .github/dependabot.yml.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  auditCeilings,
  auditSpecs,
  collectSpecs,
  SUPPORTED_MAJOR_CEILINGS,
} from "../src/version-policy/audit.js";

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

const nvmrcLine = readNvmrcLine();

/**
 * Collect pinned third-party specs from a manifest, tagging each spec's source
 * with a tree-qualified label so violations name the right package tree.
 * @param {object} pkg parsed package.json
 * @param {string} prefix e.g. "" for root, "web/" for the SPA
 */
function collectTree(pkg, prefix) {
  return collectSpecs(pkg, { dependencies: true, devDependencies: true }).map(
    (s) => ({ ...s, source: `${prefix}${s.source}` }),
  );
}

// Audit the pinned third-party dependency specifications across BOTH package
// trees: the deterministic core (root) and the standalone dashboard SPA (web/).
const rootPkg = readJson("package.json");
const webPkg = readJson("web/package.json");

const rootSpecs = collectTree(rootPkg, "");
const webSpecs = collectTree(webPkg, "web/");
const allSpecs = [...rootSpecs, ...webSpecs];

const result = auditSpecs(allSpecs);
const ceilingResult = auditCeilings(allSpecs, SUPPORTED_MAJOR_CEILINGS);

console.log(
  `[version-policy] audited ${allSpecs.length} third-party dependency ` +
    `specification(s) across 2 package trees (${rootSpecs.length} root, ` +
    `${webSpecs.length} web; dependencies + devDependencies).`,
);
console.log(
  "[version-policy] enforcing supported-major ceilings: " +
    Object.entries(SUPPORTED_MAJOR_CEILINGS)
      .map(([name, max]) => `${name}<=${String(max)}`)
      .join(", ") +
    " (kept consistent with .github/dependabot.yml ignore rules).",
);
if (nvmrcLine !== null) {
  console.log(
    `[version-policy] Node runtime line (.nvmrc): "${nvmrcLine}" ` +
      "(Active_LTS line per Req 18.2; tracked in the version ledger, not audited here).",
  );
}

let failed = false;

if (result.ok) {
  console.log(
    "[version-policy] OK: every dependency specification is an exact, non-prerelease version.",
  );
} else {
  failed = true;
  console.error(
    `[version-policy] FAILED (exact-pin): ${result.violations.length} policy violation(s):`,
  );
  for (const v of result.violations) {
    console.error(`  - ${v.source}: ${v.name} = "${v.spec}"  (${v.reason})`);
  }
  console.error(
    "[version-policy] Every dependency/language/runtime pin must be an exact, " +
      "non-prerelease version (no prerelease tags, no open-ended ranges).",
  );
}

if (ceilingResult.ok) {
  console.log(
    "[version-policy] OK: every dependency is within its supported-major ceiling.",
  );
} else {
  failed = true;
  console.error(
    `[version-policy] FAILED (supported-major ceiling): ${ceilingResult.violations.length} violation(s):`,
  );
  for (const v of ceilingResult.violations) {
    console.error(
      `  - ${v.source}: ${v.name} = "${v.spec}" is major ${String(v.major)} but ` +
        `the supported ceiling is ${String(v.ceiling)} (${v.reason}).`,
    );
  }
  console.error(
    "[version-policy] A held major was breached. Either revert the bump or, if the " +
      "migration is deliberately happening, raise the ceiling in BOTH " +
      "src/version-policy/audit.js (SUPPORTED_MAJOR_CEILINGS) and " +
      ".github/dependabot.yml (ignore rules).",
  );
}

process.exit(failed ? 1 : 0);
