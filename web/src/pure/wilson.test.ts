import { describe, expect, it } from "vitest";

import { wilsonInterval } from "./wilson";

describe("wilsonInterval", () => {
  it("matches a known value (50/100)", () => {
    const ci = wilsonInterval(50, 100);
    expect(ci.lo).toBeCloseTo(0.4038, 3);
    expect(ci.hi).toBeCloseTo(0.5962, 3);
  });
  it("is uninformative with no data and stays inside [0,1]", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    const edge = wilsonInterval(10, 10);
    expect(edge.hi).toBeLessThanOrEqual(1);
    expect(edge.lo).toBeGreaterThan(0.6);
  });
});
