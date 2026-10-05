import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEFAULT_TAB,
  TAB_IDS,
  hashForTab,
  isTabId,
  tabFromHash,
  type TabId,
} from "./routes.js";

// Feature: dashboard-ui, Property (shell routing): client-side tab routing is a total,
// round-tripping URL↔tab mapping with a defined fallback.
//
// This is NOT one of the numbered design correctness properties (those cover the pure data
// shapers). It locks the app-shell routing invariants task 9.1 introduces so the mobile
// bottom tab bar + SPA deep-link fallback behave deterministically (Req 16.1, 16.2, 1.6):
//
//   (A) `tabFromHash` is TOTAL — every string resolves to one of the five tabs, and an
//       unknown/garbage hash resolves to the defined DEFAULT_TAB (no blank view on a cold
//       deep-load behind the catch-all SPA fallback, Req 1.6).
//   (B) `hashForTab`/`tabFromHash` round-trip over the valid tab ids:
//       tabFromHash(hashForTab(t)) === t for every TabId t.
//   (C) extra query/path garbage after the tab segment is ignored (selection lives in the
//       query string, not the hash).
//
// **Validates: Requirements 1.6, 16.1, 16.2**

const NUM_RUNS = 300; // >= 100 iterations.

const tabIdArb: fc.Arbitrary<TabId> = fc.constantFrom(...TAB_IDS);

describe("app-shell routing: total, round-tripping URL↔tab mapping", () => {
  it("round-trips every valid tab id through its canonical hash (B)", () => {
    fc.assert(
      fc.property(tabIdArb, (tab) => {
        expect(hashForTab(tab)).toBe(`#/${tab}`);
        expect(tabFromHash(hashForTab(tab))).toBe(tab);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("resolves ANY string to a known tab, falling back to DEFAULT_TAB (A)", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const resolved = tabFromHash(raw);
        // Total: always one of the five known tabs.
        expect(isTabId(resolved)).toBe(true);
        expect(TAB_IDS).toContain(resolved);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("falls back to DEFAULT_TAB for hashes whose first segment is not a tab (A)", () => {
    fc.assert(
      fc.property(
        // A first segment that is explicitly NOT a tab id, with assorted leading markers.
        fc
          .string({ minLength: 1, maxLength: 12 })
          .filter((s) => !isTabId(s) && !s.includes("/") && !s.includes("?") && !s.includes("#"))
          .chain((seg) =>
            fc
              .constantFrom("", "#", "#/", "/")
              .map((prefix) => `${prefix}${seg}`),
          ),
        (hash) => {
          expect(tabFromHash(hash)).toBe(DEFAULT_TAB);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("ignores query/path garbage after the tab segment (C)", () => {
    fc.assert(
      fc.property(
        tabIdArb,
        fc.string(),
        fc.constantFrom("?", "/", "#"),
        (tab, garbage, sep) => {
          // e.g. "#/gate?pair=EURUSD" or "#/setups/extra" must still resolve to the tab.
          const hash = `#/${tab}${sep}${garbage}`;
          expect(tabFromHash(hash)).toBe(tab);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
