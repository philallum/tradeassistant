import { describe, expect, it } from "vitest";

import type { SignalRationaleRow } from "../api/types.ts";
import { shapePairNote } from "./shapePairNote.ts";

const row = (pair: string, date: string, text: string): SignalRationaleRow => ({
  decision_date: date,
  pair,
  rationale_text: text,
  analogue_labels: [],
  proposals: [],
});

const ROWS = [
  row("EURUSD", "2026-11-03", "EUR note"),
  row("USDCAD", "2026-11-03", "CAD note"),
  row("USDCAD", "2026-11-02", "older CAD note"),
];

describe("shapePairNote", () => {
  it("returns the selected pair's own rationale verbatim, never another pair's", () => {
    const vm = shapePairNote(ROWS, "USDCAD", "2026-11-03");
    expect(vm).toEqual({ status: "generated", text: "CAD note", decisionDate: "2026-11-03" });
    expect(shapePairNote(ROWS, "EURUSD", "2026-11-03").text).toBe("EUR note");
  });

  it("only matches the requested decision date", () => {
    expect(shapePairNote(ROWS, "USDCAD", "2026-11-02").text).toBe("older CAD note");
    expect(shapePairNote(ROWS, "USDCAD", "2026-11-04").status).toBe("absent");
  });

  it("is absent for a pair with no rationale (did not fire) and for a missing slice", () => {
    expect(shapePairNote(ROWS, "GBPUSD", "2026-11-03")).toEqual({
      status: "absent",
      text: null,
      decisionDate: null,
    });
    expect(shapePairNote(undefined, "USDCAD", "2026-11-03").status).toBe("absent");
  });

  it("is unavailable when the row text is blank (never fabricated)", () => {
    const vm = shapePairNote([row("USDCAD", "2026-11-03", "   ")], "USDCAD", "2026-11-03");
    expect(vm).toEqual({ status: "unavailable", text: null, decisionDate: "2026-11-03" });
  });
});
