import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { BAR_LENGTH_MS, expectedBarOpenUtc, selectFormingBar } from "./formingBar.js";
import type { Intraday4hBar } from "./types.js";

// Task 2: timezone-aware forming-bar selection. Fixed UTC 4H boundaries, DST
// equivalence, stale-bar rejection, empty input.

function bar(openTimeUtc: string): Intraday4hBar {
  return { openTimeUtc, open: 1, high: 1.1, low: 0.9, currentPrice: 1.05 };
}

describe("expectedBarOpenUtc", () => {
  it("floors to the fixed 00/04/08/12/16/20 UTC boundaries", () => {
    expect(expectedBarOpenUtc(new Date("2026-11-06T07:59:59.000Z"))).toBe("2026-11-06T04:00:00.000Z");
    expect(expectedBarOpenUtc(new Date("2026-11-06T08:00:00.000Z"))).toBe("2026-11-06T08:00:00.000Z");
    expect(expectedBarOpenUtc(new Date("2026-11-06T00:00:00.000Z"))).toBe("2026-11-06T00:00:00.000Z");
    expect(expectedBarOpenUtc(new Date("2026-11-06T23:59:00.000Z"))).toBe("2026-11-06T20:00:00.000Z");
  });

  it("handles UK DST equivalently via UTC: 08:00 UK summer (07:00 UTC) vs winter (08:00 UTC)", () => {
    // Summer: 08:00 BST = 07:00 UTC → still inside the 04:00 UTC bar.
    expect(expectedBarOpenUtc(new Date("2026-07-06T07:00:00.000Z"))).toBe("2026-07-06T04:00:00.000Z");
    // Winter: 08:00 GMT = 08:00 UTC → the 08:00 UTC bar has just opened.
    expect(expectedBarOpenUtc(new Date("2026-11-06T08:00:00.000Z"))).toBe("2026-11-06T08:00:00.000Z");
  });
});

describe("selectFormingBar", () => {
  it("returns the bar whose open equals the expected forming-bar open", () => {
    const now = new Date("2026-11-06T06:30:00.000Z"); // inside the 04:00 UTC bar
    const bars = [bar("2026-11-06T04:00:00.000Z"), bar("2026-11-06T00:00:00.000Z")];
    expect(selectFormingBar(bars, now)?.openTimeUtc).toBe("2026-11-06T04:00:00.000Z");
  });

  it("tolerates a non-millisecond ISO form (normalizes before comparing)", () => {
    const now = new Date("2026-11-06T06:30:00.000Z");
    expect(selectFormingBar([bar("2026-11-06T04:00:00Z")], now)?.openTimeUtc).toBe(
      "2026-11-06T04:00:00Z",
    );
  });

  it("returns null (stale) when the provider has not published the forming bar", () => {
    const now = new Date("2026-11-06T06:30:00.000Z");
    // Only an older closed bar is present.
    expect(selectFormingBar([bar("2026-11-06T00:00:00.000Z")], now)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(selectFormingBar([], new Date("2026-11-06T06:30:00.000Z"))).toBeNull();
  });

  it("returns null when the matching bar carries an unparseable timestamp", () => {
    const now = new Date("2026-11-06T06:30:00.000Z");
    expect(selectFormingBar([bar("not-a-date")], now)).toBeNull();
  });
});

describe("selectFormingBar (properties)", () => {
  it("selects exactly the bar aligned to the expected open for any instant", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), (sec) => {
        const now = new Date(sec * 1000);
        const expected = expectedBarOpenUtc(now);
        const prev = new Date(Date.parse(expected) - BAR_LENGTH_MS).toISOString();
        const next = new Date(Date.parse(expected) + BAR_LENGTH_MS).toISOString();
        const bars = [bar(next), bar(expected), bar(prev)];
        expect(selectFormingBar(bars, now)?.openTimeUtc).toBe(expected);
      }),
    );
  });
});
