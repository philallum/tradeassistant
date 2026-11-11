import { describe, expect, it } from "vitest";

import { formingBar, summariseFourHour, type FourHourObservation } from "./fourHourStudy.js";
import type { ResearchRow } from "./researchDataset.js";

const HOUR = 3_600_000;
const base = Date.parse("2022-03-08T04:00:00Z");

function bar(k: number, o: number, h: number, l: number, c: number): { openMs: number; open: number; high: number; low: number; close: number } {
  return { openMs: base + k * HOUR, open: o, high: h, low: l, close: c };
}

describe("formingBar", () => {
  it("combines the 04:00, 05:00 and 06:00 UTC hours", () => {
    const bars = new Map([
      [base, bar(0, 1.1, 1.12, 1.09, 1.11)],
      [base + HOUR, bar(1, 1.11, 1.13, 1.1, 1.12)],
      [base + 2 * HOUR, bar(2, 1.12, 1.125, 1.095, 1.105)],
    ]);
    expect(formingBar(bars, "2022-03-08")).toEqual({ open: 1.1, high: 1.13, low: 1.09, currentPrice: 1.105 });
  });

  it("does NOT use the 07:00 hour (that bar is still forming at the read)", () => {
    const bars = new Map([
      [base, bar(0, 1.1, 1.12, 1.09, 1.11)],
      [base + HOUR, bar(1, 1.11, 1.13, 1.1, 1.12)],
      [base + 2 * HOUR, bar(2, 1.12, 1.125, 1.095, 1.105)],
      [base + 3 * HOUR, bar(3, 1.105, 9, 0.1, 5)],
    ]);
    expect(formingBar(bars, "2022-03-08")?.high).toBe(1.13);
  });

  it("is null when any of the three hours is missing", () => {
    const bars = new Map([
      [base, bar(0, 1.1, 1.12, 1.09, 1.11)],
      [base + 2 * HOUR, bar(2, 1.12, 1.125, 1.095, 1.105)],
    ]);
    expect(formingBar(bars, "2022-03-08")).toBeNull();
  });
});

function obs(group: FourHourObservation["group"], remainingHit: boolean | null, hit: boolean): FourHourObservation {
  const row = { date: "2022-03-08", fires: true, hit } as unknown as ResearchRow;
  return { row, group, remainingPips: remainingHit === true ? 5 : remainingHit === false ? -5 : 0, remainingHit };
}

describe("summariseFourHour", () => {
  it("separates the remaining-move hit from the mechanically overlapping full-session hit", () => {
    const list: FourHourObservation[] = [];
    // 'supports' days win the full session 80% of the time but only 50% of the remaining move.
    for (let i = 0; i < 100; i += 1) list.push(obs("supports", i % 2 === 0, i % 5 !== 0));
    for (let i = 0; i < 100; i += 1) list.push(obs("contradicts", i % 2 === 0, i % 5 === 0));
    const r = summariseFourHour(list, "directional", 200, 0);
    expect(r.diffRemaining).toBeCloseTo(0, 12);
    expect(r.diffFullSession).toBeCloseTo(0.6, 12);
    const sup = r.groups.find((g) => g.group === "supports");
    expect(sup?.remainingHit).toBeCloseTo(0.5, 12);
    expect(sup?.fullSessionHit).toBeCloseTo(0.8, 12);
  });

  it("flags a thin sample", () => {
    const list = [obs("supports", true, true), obs("contradicts", false, false)];
    expect(summariseFourHour(list, "directional", 2, 0).adequate).toBe(false);
  });
});
