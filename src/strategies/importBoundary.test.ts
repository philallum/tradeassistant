import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// IMPORT-BOUNDARY and PURITY static scan for `src/strategies` (Task 13.2;
// Requirements 6.5, 8.9, 13.8).
//
// The Confluence_Engine, the four strategies, the adapters, the matrix builder,
// and the signal contract are PURE, DETERMINISTIC, LLM-free modules. This test
// enforces that structurally by statically scanning every NON-TEST source file
// under `src/strategies/` and asserting that none of them:
//
//   (a) imports from `../llm/` by any path OTHER than `../llm/types.js` — the
//       only LLM dependency a runtime strategy module may have is the shared
//       compile-time types (`Deterministic`, `isLlmTagged`, `LlmTagged`), never
//       the LLM_Interface implementation or a provider wiring (Requirement
//       13.8);
//   (b) imports a provider LLM SDK (Requirement 13.8);
//   (c) references any of the non-deterministic / side-effecting globals
//       `Date`, `Math.random`, `process.env`, `fetch`, or `fs`, which would
//       break determinism and purity (Requirements 6.5, 8.9).
//
// The ONE sanctioned exception is `src/strategies/config.ts`, which reads
// `process.env` solely as the DEFAULT VALUE of its `env` parameter so the
// function stays pure and testable; it is the single environment boundary for
// the slice (Requirement 8.9).
//
// EXEMPT from the scan: test files (`*.test.ts`) and everything under
// `src/strategies/testing/` (shared fast-check generators are test-support only
// and may reach for the real LLM brand via the LLM_Interface).
//
// The scan strips comments and string-free whitespace before matching so an SDK
// name, the word "Date", or `process.env` mentioned in prose never trips it,
// and it inspects import/require specifiers separately from global references.
// Word boundaries are chosen so identifiers such as `TradingDate`,
// `compareTradingDates`, `candle.date`, and `Math.max` are never mistaken for
// the `Date` constructor or `Math.random`.

// Derive the strategies root deterministically from this file:
// src/strategies/<thisfile>.
const STRATEGIES_ROOT = fileURLToPath(new URL(".", import.meta.url));
const TESTING_DIR = join(STRATEGIES_ROOT, "testing");
const CONFIG_FILE = join(STRATEGIES_ROOT, "config.ts");

/**
 * Provider LLM SDK modules that MUST NOT be imported anywhere under
 * `src/strategies`. Matched against the exact specifier or a subpath of it
 * (e.g. "openai" or "openai/resources"). Kept in sync with the LLM-layer guard
 * (`src/llm/importBoundary.smoke.test.ts`).
 */
const FORBIDDEN_LLM_MODULES: readonly string[] = [
  "@google/genai",
  "@google/generative-ai",
  "google-gen-ai",
  "google-genai",
  "openai",
  "@anthropic-ai/sdk",
  "cohere-ai",
  "@mistralai/mistralai",
];

/**
 * Forbidden non-deterministic / side-effecting GLOBAL references. Each entry is
 * a regular expression applied to comment-stripped source. The patterns use
 * word boundaries and negative look-behind so that identifiers embedding the
 * same letters (e.g. `TradingDate`, `candle.date`, `Math.max`) do not match.
 */
const FORBIDDEN_GLOBALS: readonly { name: string; pattern: RegExp }[] = [
  // The `Date` global as a constructor or namespaced call: `new Date(`,
  // `Date.now()`, `Date(`. A preceding word char or `.` (as in `TradingDate`
  // or `candle.Date`) disqualifies the match.
  { name: "Date", pattern: /(?<![\w.])Date\s*[.(]/ },
  // `Math.random` specifically — `Math.max` / `Math.min` are allowed.
  { name: "Math.random", pattern: /(?<![\w.])Math\s*\.\s*random\b/ },
  // `process.env` in any form.
  { name: "process.env", pattern: /(?<![\w.])process\s*\.\s*env\b/ },
  // The `fetch` global as a call. A preceding word char or `.` disqualifies it.
  { name: "fetch", pattern: /(?<![\w.])fetch\s*\(/ },
  // The `fs` module referenced as a namespace call, e.g. `fs.readFile(`.
  { name: "fs", pattern: /(?<![\w.])fs\s*\./ },
];

/** True when a specifier targets a forbidden provider SDK (match or subpath). */
function isForbiddenModule(specifier: string): boolean {
  return FORBIDDEN_LLM_MODULES.some(
    (mod) => specifier === mod || specifier.startsWith(`${mod}/`),
  );
}

/**
 * True when a specifier imports from a module's `../llm` directory (any depth)
 * by a path OTHER than `../llm/types.js`. The shared contract (`types.js`) is
 * the ONLY sanctioned LLM dependency for a runtime strategy module.
 */
function isDisallowedLlmImport(specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const targetsLlm = /(^|\/)llm(\/|$)/.test(specifier);
  if (!targetsLlm) return false;
  // Allow exactly the shared types barrel entry.
  return !/(^|\/)llm\/types\.js$/.test(specifier);
}

/** Recursively collect every non-test .ts file under `dir`, skipping testing/. */
async function collectScannedFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `testing/` is test-support only and exempt from the scan.
      if (full === TESTING_DIR) continue;
      files.push(...(await collectScannedFiles(full)));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Strip block and line comments (good enough for this static scan). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Extract the module specifiers of every static `import`/`export … from` and
 * `require(...)` / dynamic `import(...)` in comment-stripped `source`.
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns: RegExp[] = [
    /\bimport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g, // import x from "mod"
    /\bimport\s*["']([^"']+)["']/g, // side-effect: import "mod"
    /\bexport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g, // re-export: export … from "mod"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("mod")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("mod")
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe("strategies import boundary and purity (Requirements 6.5, 8.9, 13.8)", () => {
  it("scans a non-trivial set of non-test strategy modules", async () => {
    // Guard against the enumeration silently degrading to a no-op (e.g. a path
    // typo), which would make every assertion below vacuously pass.
    const files = await collectScannedFiles(STRATEGIES_ROOT);
    expect(files.length).toBeGreaterThan(5);
    // `config.ts` — the sole sanctioned `process.env` reader — must be scanned.
    expect(files).toContain(CONFIG_FILE);
    // Nothing under `testing/` or any `*.test.ts` file may be included.
    for (const file of files) {
      expect(file.startsWith(TESTING_DIR + sep)).toBe(false);
      expect(file.endsWith(".test.ts")).toBe(false);
    }
  });

  it("imports from ../llm only via ../llm/types.js", async () => {
    const files = await collectScannedFiles(STRATEGIES_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = stripComments(await readFile(file, "utf8"));
      for (const specifier of extractImportSpecifiers(source)) {
        if (isDisallowedLlmImport(specifier)) {
          violations.push(
            `${relative(STRATEGIES_ROOT, file)} imports "${specifier}" ` +
              `(only ../llm/types.js is permitted)`,
          );
        }
      }
    }

    expect(
      violations,
      `Disallowed src/llm import under src/strategies:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("imports no provider LLM SDK", async () => {
    const files = await collectScannedFiles(STRATEGIES_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = stripComments(await readFile(file, "utf8"));
      for (const specifier of extractImportSpecifiers(source)) {
        if (isForbiddenModule(specifier)) {
          violations.push(
            `${relative(STRATEGIES_ROOT, file)} imports forbidden LLM SDK "${specifier}"`,
          );
        }
      }
    }

    expect(
      violations,
      `A provider LLM SDK is imported under src/strategies:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("references no non-deterministic or side-effecting global (config.ts excepted for process.env)", async () => {
    const files = await collectScannedFiles(STRATEGIES_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = stripComments(await readFile(file, "utf8"));
      const isConfig = file === CONFIG_FILE;
      for (const { name, pattern } of FORBIDDEN_GLOBALS) {
        // `config.ts` is the single sanctioned `process.env` boundary: it reads
        // it only as the default value of its `env` parameter (Requirement 8.9).
        if (isConfig && name === "process.env") continue;
        if (pattern.test(source)) {
          violations.push(
            `${relative(STRATEGIES_ROOT, file)} references "${name}"`,
          );
        }
      }
    }

    expect(
      violations,
      `Non-deterministic/side-effecting global under src/strategies:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("confirms config.ts is the only legitimate process.env user", async () => {
    // A positive assertion that the exception is real and narrow: config.ts DOES
    // reference process.env, and no OTHER scanned file does.
    const files = await collectScannedFiles(STRATEGIES_ROOT);
    const processEnv = /(?<![\w.])process\s*\.\s*env\b/;
    const envUsers: string[] = [];

    for (const file of files) {
      const source = stripComments(await readFile(file, "utf8"));
      if (processEnv.test(source)) envUsers.push(file);
    }

    expect(envUsers).toEqual([CONFIG_FILE]);
  });

  it("keeps the forbidden lists explicit and non-empty", () => {
    expect(FORBIDDEN_LLM_MODULES.length).toBeGreaterThan(0);
    expect(FORBIDDEN_LLM_MODULES).toContain("openai");
    expect(FORBIDDEN_GLOBALS.map((g) => g.name)).toEqual([
      "Date",
      "Math.random",
      "process.env",
      "fetch",
      "fs",
    ]);
  });
});
