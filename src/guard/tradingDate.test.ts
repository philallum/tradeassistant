import { describe, expect, it } from "vitest";
import { previousCalendarDate } from "./tradingDate.js";

describe("previousCalendarDate", () => {
  it("steps back exactly one calendar day", () => {
    expect(previousCalendarDate("2024-03-15")).toBe("2024-03-14");
  });

  it("is a calendar step, not a trading-day step: a Monday maps to the Sunday", () => {
    expect(previousCalendarDate("2024-03-18")).toBe("2024-03-17");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(previousCalendarDate("2024-03-01")).toBe("2024-02-29");
    expect(previousCalendarDate("2023-03-01")).toBe("2023-02-28");
    expect(previousCalendarDate("2024-01-01")).toBe("2023-12-31");
  });
});
