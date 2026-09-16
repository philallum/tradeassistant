import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SCAFFOLD_READY } from "./index.js";

// Placeholder test so the runner passes on a fresh scaffold. Real property
// tests (fast-check, >=100 iterations) arrive with the feature modules.
describe("scaffold", () => {
  it("exposes a scaffold-ready marker", () => {
    expect(SCAFFOLD_READY).toBe(true);
  });

  it("fast-check is wired and runs properties", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => n + 0 === n),
      { numRuns: 100 },
    );
  });
});
