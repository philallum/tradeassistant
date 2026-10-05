// dashboard-ui `web/` — pure-module purity structural guard test (task 7.12).
//
// This test locks the PURITY INVARIANT of `web/src/pure/**` structurally (by reading the
// source text), not behaviorally. Every production module under `web/src/pure/` must be a
// deterministic function of its arguments alone, so the shapers stay property-testable
// without a browser, a network, or a clock (Req 19.1, 19.2). Concretely, a pure module:
//
//   1. performs no network I/O — no `fetch(` call,
//   2. touches no DOM / browser globals — no `window`, `document`, `localStorage`, …,
//   3. pulls in no charting library — no `recharts` import (Recharts is impure render-only),
//   4. reads no ambient clock — no `Date.now(` (the clock is injected as an argument),
//   5. does not reach into the deterministic core — no import from `src/`,
//   6. does not escape the `web/` app via a relative path (e.g. `../../../src`).
//
// The file list is enumerated from disk (`readdirSync`) rather than hardcoded, so any new
// pure module is automatically covered. Test files (`*.test.ts`) are excluded — they
// legitimately import `vitest` / `fast-check` and may construct `Date`s in generators.
//
// _Requirements: 19.1, 19.2_

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Enumerate the production (non-test) `.ts` modules under `web/src/pure/`. Reading the
 * directory from disk means a newly added pure module is covered automatically, with no
 * change to this test.
 */
function pureModuleFiles(): string[] {
  return readdirSync(HERE)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .sort();
}

/**
 * Strip line comments, block comments, and string / template literals from TypeScript
 * source so the forbidden-token scan only inspects EXECUTABLE code. Several pure modules
 * mention `fetch`, `Date.now()`, `DOM`, `window`, and `document` in their doc comments to
 * document the very invariant this test enforces; without stripping, those mentions would
 * produce false positives. The replacement preserves nothing of the removed content.
 */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;

  type Mode =
    | "code"
    | "line-comment"
    | "block-comment"
    | "single"
    | "double"
    | "template";
  let mode: Mode = "code";

  while (i < n) {
    const ch = src[i] ?? "";
    const next = i + 1 < n ? src[i + 1] : "";

    switch (mode) {
      case "code": {
        if (ch === "/" && next === "/") {
          mode = "line-comment";
          i += 2;
        } else if (ch === "/" && next === "*") {
          mode = "block-comment";
          i += 2;
        } else if (ch === "'") {
          mode = "single";
          i += 1;
        } else if (ch === '"') {
          mode = "double";
          i += 1;
        } else if (ch === "`") {
          mode = "template";
          i += 1;
        } else {
          out += ch;
          i += 1;
        }
        break;
      }
      case "line-comment": {
        if (ch === "\n") {
          mode = "code";
          out += ch;
        }
        i += 1;
        break;
      }
      case "block-comment": {
        if (ch === "*" && next === "/") {
          mode = "code";
          i += 2;
        } else {
          i += 1;
        }
        break;
      }
      case "single":
      case "double":
      case "template": {
        const quote = mode === "single" ? "'" : mode === "double" ? '"' : "`";
        if (ch === "\\") {
          // Skip the escaped character so an escaped quote does not end the literal.
          i += 2;
        } else if (ch === quote) {
          mode = "code";
          i += 1;
        } else {
          i += 1;
        }
        break;
      }
    }
  }

  return out;
}

/** All import module specifiers (the quoted part of `import ... from "<spec>"`). */
function importSpecifiers(rawSrc: string): string[] {
  const specs: string[] = [];
  // `import ... from "x"`, `import "x"`, and `export ... from "x"` forms.
  const re = /(?:import|export)\s+(?:[^"'`]*?\sfrom\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawSrc)) !== null) {
    const spec = m[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

interface PureModule {
  readonly name: string;
  readonly raw: string;
  /** Source with comments and string/template literals removed. */
  readonly code: string;
  readonly specifiers: readonly string[];
}

const MODULES: readonly PureModule[] = pureModuleFiles().map((name) => {
  const raw = readFileSync(join(HERE, name), "utf8");
  return {
    name,
    raw,
    code: stripCommentsAndStrings(raw),
    specifiers: importSpecifiers(raw),
  };
});

/**
 * DOM / browser-global identifiers a pure module must never reference. Matched on a word
 * boundary against comment-and-string-stripped code so property names like `obj.document`
 * are still flagged (a pure module has no business touching any of these).
 */
const DOM_GLOBALS = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "location",
  "history",
  "XMLHttpRequest",
  "HTMLElement",
  "requestAnimationFrame",
] as const;

describe("web/src/pure purity invariant (Req 19.1, 19.2)", () => {
  it("enumerates at least the known pure shaper modules", () => {
    // Guards against the scan silently covering nothing (e.g. a bad path). The list is
    // enumerated from disk; this only asserts the known modules are present, not an exact
    // set, so new pure modules do not require editing this test.
    const names = MODULES.map((mod) => mod.name);
    expect(names.length).toBeGreaterThan(0);
    for (const expected of [
      "selectDates.ts",
      "shapeDashboard.ts",
      "format.ts",
      "shapeCharts.ts",
      "shapePredictionActual.ts",
      "shapeAi.ts",
      "shapeExternal.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("excludes test files from the purity scan", () => {
    expect(MODULES.every((mod) => !mod.name.endsWith(".test.ts"))).toBe(true);
  });

  describe.each(MODULES.map((mod) => [mod.name, mod] as const))(
    "%s",
    (_name, mod) => {
      it("performs no fetch() call", () => {
        expect(mod.code).not.toMatch(/\bfetch\s*\(/);
      });

      it("reads no ambient clock via Date.now()", () => {
        expect(mod.code).not.toMatch(/\bDate\s*\.\s*now\s*\(/);
      });

      it("references no DOM / browser globals", () => {
        for (const global of DOM_GLOBALS) {
          const re = new RegExp(`\\b${global}\\b`);
          expect(
            re.test(mod.code),
            `${mod.name} must not reference the DOM global "${global}"`,
          ).toBe(false);
        }
      });

      it("imports no recharts (charting is impure, render-only)", () => {
        for (const spec of mod.specifiers) {
          expect(
            /^recharts(?:\/|$)/.test(spec),
            `${mod.name} must not import recharts (got "${spec}")`,
          ).toBe(false);
        }
      });

      it("imports nothing from the deterministic core (src/)", () => {
        for (const spec of mod.specifiers) {
          // No bare "src/..." specifier, and no relative path that escapes `web/` into a
          // sibling `src/` (e.g. "../../../src/..." / ".../src/foo").
          const reachesSrc =
            /(^|\/)src\//.test(spec) || /(^|\/)src$/.test(spec);
          expect(
            reachesSrc,
            `${mod.name} must not import from the core (got "${spec}")`,
          ).toBe(false);
        }
      });

      it("uses no relative import that escapes the web/ app", () => {
        for (const spec of mod.specifiers) {
          if (!spec.startsWith(".")) continue;
          // `web/src/pure/` is three segments below `web/`. A pure module should at most
          // climb to `web/src/` (`../api/...`). More than two `../` escapes `web/src`,
          // and reaching `web/`'s parent would need three — forbid that outright.
          const resolved = join(HERE, spec);
          const webRoot = join(HERE, "..", "..", ".."); // web/src/pure -> web/
          expect(
            resolved.startsWith(webRoot),
            `${mod.name} relative import "${spec}" must stay inside web/`,
          ).toBe(true);
        }
      });
    },
  );
});
