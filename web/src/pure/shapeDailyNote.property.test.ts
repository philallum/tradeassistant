import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { shapeDailyNote } from "./shapeDailyNote.ts";
import type { DailyCommentary } from "../api/types.ts";

// `shapeDailyNote` maps the pair-independent `dailyCommentary` object into the three display
// states the Setups note renders: "generated" (real note, verbatim text), "unavailable" (run
// completed but AI layer did not produce a note — explicit non-error marker, never
// fabricated), and "absent" (no commentary slice at all → omit).

const NUM_RUNS = 300;

describe("shapeDailyNote", () => {
  it("is absent for an empty/missing record (older snapshot) → caller omits the note", () => {
    expect(shapeDailyNote(undefined)).toEqual({ status: "absent", text: null, decisionDate: null });
    expect(
      shapeDailyNote({ decision_date: "", note_text: "", generated: false }),
    ).toEqual({ status: "absent", text: null, decisionDate: null });
  });

  it("renders a generated note verbatim", () => {
    const vm = shapeDailyNote({
      decision_date: "2026-10-09",
      note_text: "No setups cleared the 55% threshold today; majors were choppy.",
      generated: true,
    });
    expect(vm.status).toBe("generated");
    expect(vm.text).toBe("No setups cleared the 55% threshold today; majors were choppy.");
    expect(vm.decisionDate).toBe("2026-10-09");
  });

  it("is 'unavailable' when a record exists but the note was not generated", () => {
    const vm = shapeDailyNote({ decision_date: "2026-10-09", note_text: "", generated: false });
    expect(vm.status).toBe("unavailable");
    expect(vm.text).toBeNull();
    expect(vm.decisionDate).toBe("2026-10-09");
  });

  it("is 'unavailable' when generated is true but the text is empty/whitespace (never fabricate)", () => {
    const vm = shapeDailyNote({ decision_date: "2026-10-09", note_text: "   ", generated: true });
    expect(vm.status).toBe("unavailable");
    expect(vm.text).toBeNull();
  });

  it("property: never fabricates text, and status is a pure function of (decision_date, generated, text)", () => {
    const arb: fc.Arbitrary<DailyCommentary> = fc.record({
      decision_date: fc.constantFrom("", "2026-10-09"),
      note_text: fc.constantFrom("", "   ", "a real note"),
      generated: fc.boolean(),
    });
    fc.assert(
      fc.property(arb, (c) => {
        const vm = shapeDailyNote(c);
        if (c.decision_date === "") {
          expect(vm.status).toBe("absent");
          expect(vm.text).toBeNull();
        } else if (c.generated && c.note_text.trim() !== "") {
          expect(vm.status).toBe("generated");
          // Verbatim — exactly the source text, never altered or fabricated.
          expect(vm.text).toBe(c.note_text);
        } else {
          expect(vm.status).toBe("unavailable");
          expect(vm.text).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
