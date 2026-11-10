import { describe, expect, it } from "vitest";

import type { EventFlags } from "../api/types";
import { EVENT_CAUTION, RULE_BASED_NOTE, shapeEventFlag } from "./shapeEventFlag";

const FOMC: EventFlags = {
  decisionDate: "2026-12-09",
  events: [{ kind: "FOMC", label: "US Federal Reserve rate decision", basis: "official" }],
  calendarCovers: true,
};
const NFP: EventFlags = {
  decisionDate: "2026-12-04",
  events: [{ kind: "US_NFP", label: "US jobs report (non-farm payrolls)", basis: "rule" }],
  calendarCovers: true,
};

describe("shapeEventFlag", () => {
  it("states an official event as a caution, not a signal", () => {
    const vm = shapeEventFlag(FOMC, "2026-12-09", true)!;
    expect(vm.headline).toBe("High-impact event today: US Federal Reserve rate decision");
    expect(vm.detail).toBe(EVENT_CAUTION);
    expect(vm.includesRuleBasedDate).toBe(false);
    expect(vm.detail).toMatch(/not a signal/i);
  });

  it("adds the rule-based caveat for a jobs-report date", () => {
    const vm = shapeEventFlag(NFP, "2026-12-04", true)!;
    expect(vm.includesRuleBasedDate).toBe(true);
    expect(vm.detail).toContain(RULE_BASED_NOTE);
  });

  it("lists several events together", () => {
    const both: EventFlags = { ...FOMC, events: [...FOMC.events, { kind: "ECB", label: "ECB rate decision", basis: "official" }] };
    expect(shapeEventFlag(both, "2026-12-09", true)?.headline).toContain("; ECB rate decision");
  });

  it("says nothing when there is nothing listed, for an older browsed date, or for another date", () => {
    expect(shapeEventFlag({ ...FOMC, events: [] }, "2026-12-09", true)).toBeNull();
    expect(shapeEventFlag(FOMC, "2026-12-09", false)).toBeNull();
    expect(shapeEventFlag(FOMC, "2026-12-08", true)).toBeNull();
  });
});
