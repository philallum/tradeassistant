// mobile-dashboard-single-window — data-invariance guard (task 7.1).
//
// Property 5: Shaper outputs are unchanged by the refactor (data invariance).
// Validates: Requirements 9.3, 9.4.
//
// "Pre-refactor vs post-refactor source tree" is not a runtime input a generated-input
// property test can vary; it is a statement about the diff itself. So this guard enforces
// Property 5 structurally: each protected file must be byte-identical to its base-commit
// content, pinned by sha256 in `dataInvariance.hashes.json`. If the refactor does not edit
// these files, their shaper outputs cannot have changed. The existing behavioural suites for
// these modules keep running unmodified as the second guarantee.
//
// MAINTENANCE: if a future change DELIBERATELY edits one of these files, update
// `dataInvariance.hashes.json` in the SAME commit (and justify it in the commit message).
// Never regenerate the fixture just to silence a failure caused by an accidental edit.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const GUARDS_DIR = dirname(fileURLToPath(import.meta.url));
/** `web/src/` — protected paths in the fixture are relative to this directory. */
const SRC_DIR = join(GUARDS_DIR, "..");

// dashboard-simplification deliberately removed/rewrote the other six originally pinned files
// (see the fixture's `_comment`); these two are unchanged and stay pinned.
const PROTECTED_FILES = ["pure/shapeDailyNote.ts", "pure/format.ts"] as const;

type HashFixture = Record<string, string>;

function loadFixture(): HashFixture {
  const raw = readFileSync(join(GUARDS_DIR, "dataInvariance.hashes.json"), "utf8");
  return JSON.parse(raw) as HashFixture;
}

/** sha256 over the raw file bytes (no text decoding, so line endings are significant). */
function sha256OfFile(relPath: string): string {
  return createHash("sha256")
    .update(readFileSync(join(SRC_DIR, relPath)))
    .digest("hex");
}

describe("data invariance guard (Property 5; Req 9.3, 9.4)", () => {
  const fixture = loadFixture();

  it("pins exactly the protected files", () => {
    const pinned = Object.keys(fixture)
      .filter((key) => !key.startsWith("_"))
      .sort();
    expect(pinned).toEqual([...PROTECTED_FILES].sort());
  });

  it.each(PROTECTED_FILES)("%s is byte-identical to the base commit", (relPath) => {
    const expected = fixture[relPath];
    expect(expected, `no pinned hash for ${relPath}`).toMatch(/^[0-9a-f]{64}$/);
    const actual = sha256OfFile(relPath);
    expect(
      actual,
      `PROTECTED FILE MODIFIED: web/src/${relPath} differs from its base-commit hash. ` +
        `This refactor must not change shaper output. If the change is deliberate, update ` +
        `web/src/guards/dataInvariance.hashes.json in the same commit.`,
    ).toBe(expected);
  });
});
