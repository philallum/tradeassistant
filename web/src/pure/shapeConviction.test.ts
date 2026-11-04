import { describe, expect, it } from "vitest";

import type { Confluence, ConfluenceCell, ConfluencePair, ConfluenceStatus, Direction } from "../api/types";
import { EMPTY_CONFLUENCE } from "../api/snapshot";
import { formatTally, shapeConviction, tallyVotes, tierGlyph } from "./shapeConviction";

const WEIGHTS: Confluence["weights"] = EMPTY_CONFLUENCE.weights; // third_party is 0 (display-only)

const cell = (
  id: ConfluenceCell["strategyId"],
  direction: Direction,
  strength = 0.7,
): ConfluenceCell => ({
  strategyId: id,
  available: true,
  direction,
  strength: direction === "FLAT" ? 0 : strength,
  rationale: "r",
});
const off = (id: ConfluenceCell["strategyId"]): ConfluenceCell => ({
  strategyId: id,
  available: false,
  reason: "insufficient_data",
});

function pairOf(
  status: ConfluenceStatus,
  cells: Record<string, ConfluenceCell | undefined>,
  opposing: ConfluencePair["opposingStrategyIds"] = [],
  score = 0,
): ConfluencePair {
  const ids = ["trend", "breakout", "range", "reversal", "custom_pattern", "third_party"] as const;
  return {
    pair: "EURUSD",
    score,
    status,
    opposingStrategyIds: opposing,
    cells: ids.map((id) => cells[id] ?? cell(id, "FLAT")),
  };
}

describe("tallyVotes", () => {
  it("counts only positive-weight strategies; the display-only third party never votes", () => {
    const p = pairOf("NEUTRAL", {
      trend: cell("trend", "DOWN"),
      custom_pattern: cell("custom_pattern", "UP"),
      third_party: cell("third_party", "UP"),
      range: off("range"),
    });
    expect(tallyVotes(p, WEIGHTS)).toEqual({ up: 1, down: 1, flat: 2, unavailable: 1 });
  });
  it("formats the tally and appends unavailable only when present", () => {
    expect(formatTally({ up: 1, down: 1, flat: 3, unavailable: 0 })).toBe("1 up \u00B7 1 down \u00B7 3 flat");
    expect(formatTally({ up: 0, down: 0, flat: 4, unavailable: 1 })).toContain("1 unavailable");
  });
});

describe("shapeConviction", () => {
  it("the EURUSD case: pattern up vs trend down is a SPLIT with a readable tally", () => {
    const p = pairOf(
      "CONFLICT_FLAT",
      { trend: cell("trend", "DOWN", 0.9), custom_pattern: cell("custom_pattern", "UP", 0.57) },
      ["trend", "custom_pattern"],
    );
    const vm = shapeConviction(p, WEIGHTS);
    expect(vm.tier).toBe("SPLIT");
    expect(vm.label).toBe("Split");
    expect(vm.tallyText).toBe("1 up \u00B7 1 down \u00B7 3 flat");
    expect(vm.opposing).toEqual(["trend", "custom_pattern"]);
    expect(vm.direction).toBeNull();
  });

  it("an engine-aligned pair is ALIGNED in its direction", () => {
    const up = shapeConviction(
      pairOf("ALIGNED_UP", { trend: cell("trend", "UP"), breakout: cell("breakout", "UP") }, [], 0.5),
      WEIGHTS,
    );
    expect(up).toMatchObject({ tier: "ALIGNED", direction: "UP", label: "Aligned up" });
    const down = shapeConviction(
      pairOf("ALIGNED_DOWN", { trend: cell("trend", "DOWN"), breakout: cell("breakout", "DOWN") }, [], -0.5),
      WEIGHTS,
    );
    expect(down).toMatchObject({ tier: "ALIGNED", direction: "DOWN", label: "Aligned down" });
  });

  it("a majority below the alignment bar is a LEAN, not 'Neutral'", () => {
    const vm = shapeConviction(
      pairOf("NEUTRAL", {
        trend: cell("trend", "UP", 0.3),
        breakout: cell("breakout", "UP", 0.2),
        range: cell("range", "DOWN", 0.1),
      }),
      WEIGHTS,
    );
    expect(vm).toMatchObject({ tier: "LEAN", direction: "UP", label: "Lean up" });
    expect(vm.tallyText).toBe("2 up \u00B7 1 down \u00B7 2 flat");
  });

  it("a single directional voter is a LEAN in its direction", () => {
    const vm = shapeConviction(pairOf("NEUTRAL", { trend: cell("trend", "DOWN", 0.4) }), WEIGHTS);
    expect(vm).toMatchObject({ tier: "LEAN", direction: "DOWN", label: "Lean down" });
  });

  it("an exact weak up/down tie is a SPLIT even without a strong conflict", () => {
    const vm = shapeConviction(
      pairOf("NEUTRAL", { trend: cell("trend", "UP", 0.3), range: cell("range", "DOWN", 0.2) }),
      WEIGHTS,
    );
    expect(vm.tier).toBe("SPLIT");
    expect(vm.opposing).toEqual([]);
  });

  it("no directional voter is NO_VIEW; insufficient data is NO_VIEW with its own copy", () => {
    const flat = shapeConviction(pairOf("NEUTRAL", {}), WEIGHTS);
    expect(flat).toMatchObject({ tier: "NO_VIEW", label: "No view" });
    expect(flat.explanation).toMatch(/no strategy/i);
    const none = shapeConviction(pairOf("INSUFFICIENT_DATA", {}), WEIGHTS);
    expect(none.tier).toBe("NO_VIEW");
    expect(none.explanation).toMatch(/not enough data/i);
  });

  it("never emits the retired bare 'Neutral' label", () => {
    const statuses: ConfluenceStatus[] = ["ALIGNED_UP", "ALIGNED_DOWN", "NEUTRAL", "CONFLICT_FLAT", "INSUFFICIENT_DATA"];
    for (const status of statuses) {
      expect(shapeConviction(pairOf(status, {}), WEIGHTS).label).not.toMatch(/neutral/i);
    }
  });

  it("is deterministic", () => {
    const p = pairOf("NEUTRAL", { trend: cell("trend", "UP") });
    expect(shapeConviction(p, WEIGHTS)).toEqual(shapeConviction(p, WEIGHTS));
  });
});

describe("tierGlyph", () => {
  it("gives every tier a non-colour cue", () => {
    expect(tierGlyph({ tier: "ALIGNED", direction: "UP" })).toBe("\u25B2");
    expect(tierGlyph({ tier: "LEAN", direction: "DOWN" })).toBe("\u25BC");
    expect(tierGlyph({ tier: "SPLIT", direction: null })).not.toBe("");
    expect(tierGlyph({ tier: "NO_VIEW", direction: null })).not.toBe("");
  });
});
