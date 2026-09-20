import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// LLM-IMPORT BOUNDARY static check (Task 9.11; Requirement 2.4).
//
// Requirement 2.4: "route all LLM calls through the LLM_Interface." This test
// enforces that structurally at the MODULE level by statically scanning the
// `src/` tree and asserting:
//
//   (a) NO module OUTSIDE src/llm/ imports a raw LLM client / SDK from the
//       forbidden list below. Only the LLM_Interface implementation (src/llm/)
//       is permitted to know about a concrete provider SDK, and v1 ships none
//       yet — so the correct current state is ZERO forbidden imports anywhere.
//   (b) Any module that needs LLM access reaches it through the LLM_Interface
//       barrel ("../llm" / "./llm" / an "…/llm/…" entry) rather than a provider
//       SDK.
//
// The scan resolves paths deterministically relative to the src root (derived
// from this test file's own URL) and inspects only IMPORT / REQUIRE specifiers,
// so SDK names mentioned in comments or docstrings never trip it. The forbidden
// list is explicit and the test fails loudly if a future violation is
// introduced.

// Derive the src root deterministically from this file: src/llm/<thisfile>.
const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(THIS_DIR, "..");
const LLM_DIR = join(SRC_ROOT, "llm");

/**
 * Raw LLM client / SDK modules that MUST NOT be imported outside the
 * LLM_Interface implementation. Matched against the exact import specifier or a
 * subpath of it (e.g. "openai" or "openai/resources"). Extend this list as new
 * providers are considered so the guard keeps biting.
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

/** Barrel/entry specifiers that count as "through the LLM_Interface". */
function isLlmInterfaceImport(specifier: string): boolean {
  // Relative barrel: "../llm", "./llm", "../../llm" (optionally with a subpath
  // like "../llm/index.js" or "../llm/types.js"), i.e. anything routed via the
  // module's own src/llm directory.
  return /(^|\/)llm(\/|$|\.js$)/.test(specifier) && specifier.startsWith(".");
}

/** True when a specifier targets a forbidden SDK (exact match or subpath). */
function isForbiddenModule(specifier: string): boolean {
  return FORBIDDEN_LLM_MODULES.some(
    (mod) => specifier === mod || specifier.startsWith(`${mod}/`),
  );
}

/** Recursively collect every .ts source file under `dir` (skips .test.ts). */
async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Extract the module specifiers of every static `import`/`export … from` and
 * `require(...)` in `source`. Comments/docstrings are stripped first so an SDK
 * name mentioned in prose is never treated as an import.
 */
function extractImportSpecifiers(source: string): string[] {
  // Strip block and line comments (good enough for import-detection here).
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const specifiers: string[] = [];
  const patterns: RegExp[] = [
    /\bimport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g, // import x from "mod"
    /\bimport\s*["']([^"']+)["']/g, // side-effect: import "mod"
    /\bexport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g, // re-export: export … from "mod"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("mod")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("mod")
  ];
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function isInsideLlmDir(file: string): boolean {
  return file === LLM_DIR || file.startsWith(LLM_DIR + sep);
}

describe("LLM import boundary (Requirement 2.4)", () => {
  it("no module outside src/llm imports a raw LLM client/SDK", async () => {
    const files = await collectSourceFiles(SRC_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      if (isInsideLlmDir(file)) continue; // src/llm is the sole SDK-aware layer.
      const source = await readFile(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        if (isForbiddenModule(specifier)) {
          violations.push(`${relative(SRC_ROOT, file)} imports forbidden LLM module "${specifier}"`);
        }
      }
    }

    expect(violations, `LLM SDK imported outside the LLM_Interface:\n${violations.join("\n")}`).toEqual([]);
  });

  it("no module imports a raw LLM SDK anywhere (v1 ships no provider SDK)", async () => {
    // Even src/llm must not yet pull in a concrete SDK: v1 exercises the backend
    // through the injectable LlmProvider port with a fake. This makes the guard
    // fail the moment a provider dependency is added without a sanctioned wiring.
    const files = await collectSourceFiles(SRC_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        if (isForbiddenModule(specifier)) {
          violations.push(`${relative(SRC_ROOT, file)} imports "${specifier}"`);
        }
      }
    }

    expect(violations, `A raw LLM SDK is imported; route LLM access through the LLM_Interface instead:\n${violations.join("\n")}`).toEqual([]);
  });

  it("modules that need LLM access import it through the LLM_Interface", async () => {
    const files = await collectSourceFiles(SRC_ROOT);

    // Consumers known to require LLM access — each MUST reach it via the
    // LLM_Interface barrel, never a provider SDK.
    const llmConsumers = [
      join(SRC_ROOT, "news-filter", "newsFilter.ts"),
      join(SRC_ROOT, "rationale", "rationale.ts"),
    ].filter((f) => files.includes(f));

    // Guard against the fixture drifting: if the modules move, fail loudly.
    expect(llmConsumers.length).toBeGreaterThan(0);

    for (const file of llmConsumers) {
      const source = await readFile(file, "utf8");
      const specifiers = extractImportSpecifiers(source);
      const routesThroughInterface = specifiers.some(isLlmInterfaceImport);
      const importsForbidden = specifiers.some(isForbiddenModule);

      expect(
        routesThroughInterface,
        `${relative(SRC_ROOT, file)} should import LLM access via the LLM_Interface barrel`,
      ).toBe(true);
      expect(
        importsForbidden,
        `${relative(SRC_ROOT, file)} must not import a raw LLM SDK`,
      ).toBe(false);
    }
  });

  it("the forbidden-module list is explicit and non-empty", () => {
    // A sanity check so the guard can never silently degrade to a no-op.
    expect(FORBIDDEN_LLM_MODULES.length).toBeGreaterThan(0);
    expect(FORBIDDEN_LLM_MODULES).toContain("@google/genai");
    expect(FORBIDDEN_LLM_MODULES).toContain("openai");
  });
});
