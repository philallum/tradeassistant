import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_HOLDOUT,
  DISCOVERY_WINDOW,
  inWindow,
  windowsOverlap,
} from "../../walk-forward/evidenceProtocol.js";
import {
  assertExplorationWindow,
  assertNoHoldoutRows,
  HoldoutAccessError,
  RESEARCH_EXPLORATION_WINDOW,
  RESEARCH_HOLDOUT,
  RESEARCH_HYPOTHESES,
} from "./researchProtocol.js";

describe("research protocol windows", () => {
  it("the locked holdout is the last 12 months of the existing confirmation holdout", () => {
    expect(RESEARCH_HOLDOUT.end).toBe(CONFIRMATION_HOLDOUT.end);
    expect(RESEARCH_HOLDOUT.start >= CONFIRMATION_HOLDOUT.start).toBe(true);
    const days = (Date.parse(`${RESEARCH_HOLDOUT.end}T00:00:00Z`) - Date.parse(`${RESEARCH_HOLDOUT.start}T00:00:00Z`)) / 86_400_000;
    // 2025-09-16 .. 2026-09-15 inclusive is exactly 365 days (366 dates).
    expect(days).toBe(364);
  });

  it("exploration and holdout are disjoint and contiguous", () => {
    expect(windowsOverlap(RESEARCH_EXPLORATION_WINDOW, RESEARCH_HOLDOUT)).toBe(false);
    expect(RESEARCH_EXPLORATION_WINDOW.start).toBe(DISCOVERY_WINDOW.start);
    const next = new Date(`${RESEARCH_EXPLORATION_WINDOW.end}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    expect(next.toISOString().slice(0, 10)).toBe(RESEARCH_HOLDOUT.start);
  });

  it("the existing discovery window is untouched by the new split", () => {
    expect(DISCOVERY_WINDOW.end).toBe("2024-12-31");
    expect(inWindow(DISCOVERY_WINDOW.end, RESEARCH_EXPLORATION_WINDOW)).toBe(true);
  });
});

describe("holdout guard", () => {
  it("accepts the exploration window and rejects anything reaching the holdout", () => {
    expect(assertExplorationWindow(RESEARCH_EXPLORATION_WINDOW)).toEqual(RESEARCH_EXPLORATION_WINDOW);
    expect(() => assertExplorationWindow({ start: "2025-01-01", end: RESEARCH_HOLDOUT.start })).toThrow(HoldoutAccessError);
    expect(() => assertExplorationWindow(RESEARCH_HOLDOUT)).toThrow(HoldoutAccessError);
    expect(() => assertExplorationWindow({ start: "2013-06-01", end: "2026-09-15" })).toThrow(HoldoutAccessError);
  });

  it("the boundary day before the holdout is allowed and the first holdout day is not", () => {
    expect(() => assertExplorationWindow({ start: "2025-09-01", end: "2025-09-15" })).not.toThrow();
    expect(() => assertExplorationWindow({ start: "2025-09-01", end: "2025-09-16" })).toThrow(HoldoutAccessError);
  });

  it("assertNoHoldoutRows rejects a single holdout-dated row", () => {
    expect(assertNoHoldoutRows([{ date: "2025-09-15" }])).toHaveLength(1);
    expect(() => assertNoHoldoutRows([{ date: "2025-09-15" }, { date: RESEARCH_HOLDOUT.start }])).toThrow(HoldoutAccessError);
    expect(() => assertNoHoldoutRows([{ date: RESEARCH_HOLDOUT.end }])).toThrow(HoldoutAccessError);
  });
});

describe("pre-registered hypotheses", () => {
  it("have unique ids", () => {
    expect(new Set(RESEARCH_HYPOTHESES.map((h) => h.id)).size).toBe(RESEARCH_HYPOTHESES.length);
  });
});
