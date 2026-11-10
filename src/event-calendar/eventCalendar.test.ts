import { describe, expect, it } from "vitest";

import {
  CALENDAR_COVERED_THROUGH,
  ECB_DECISION_DATES,
  EVENT_CALENDAR,
  FOMC_DECISION_DATES,
  eventsOn,
  isEventDay,
  nfpReleaseDateByRule,
} from "./eventCalendar.js";
import { buildEventFlags } from "./eventFlags.js";

describe("US jobs report rule", () => {
  it("reproduces every release date confirmed from BLS (2026)", () => {
    // [reference month, expected release]
    const confirmed: [number, string][] = [
      [1, "2026-02-06"],
      [3, "2026-04-03"],
      [4, "2026-05-08"],
      [8, "2026-09-04"],
      [9, "2026-10-02"],
      [10, "2026-11-06"],
    ];
    for (const [month, expected] of confirmed) expect(nfpReleaseDateByRule(2026, month)).toBe(expected);
  });

  it("always lands on a Friday", () => {
    for (let y = 2021; y <= 2027; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        expect(new Date(`${nfpReleaseDateByRule(y, m)}T00:00:00Z`).getUTCDay()).toBe(5);
      }
    }
  });
});

describe("central-bank lists", () => {
  it("every decision date is a weekday and the lists are ascending and unique", () => {
    for (const list of [FOMC_DECISION_DATES, ECB_DECISION_DATES]) {
      expect([...list].sort()).toEqual([...list]);
      expect(new Set(list).size).toBe(list.length);
      for (const d of list) {
        const day = new Date(`${d}T00:00:00Z`).getUTCDay();
        expect(day >= 1 && day <= 5).toBe(true);
      }
    }
  });

  it("FOMC has eight scheduled meetings a year for 2021-2027", () => {
    for (let y = 2021; y <= 2027; y += 1) {
      expect(FOMC_DECISION_DATES.filter((d) => d.startsWith(String(y)))).toHaveLength(8);
    }
  });

  it("pins a few dates confirmed from the official pages", () => {
    expect(FOMC_DECISION_DATES).toContain("2026-10-28");
    expect(FOMC_DECISION_DATES).toContain("2026-12-09");
    expect(ECB_DECISION_DATES).toContain("2026-12-17");
    expect(ECB_DECISION_DATES).toContain("2027-02-04");
  });
});

describe("eventsOn", () => {
  it("lists a Fed decision with its official basis", () => {
    expect(eventsOn("2026-12-09")).toEqual([
      { date: "2026-12-09", kind: "FOMC", label: "US Federal Reserve rate decision", basis: "official" },
    ]);
  });

  it("can list two events on one day and none on a quiet day", () => {
    const doubles = EVENT_CALENDAR.filter((e, i, all) => all.findIndex((x) => x.date === e.date) !== i);
    if (doubles.length > 0) expect(eventsOn(doubles[0]!.date).length).toBeGreaterThan(1);
    expect(eventsOn("2026-11-11")).toEqual([]);
    expect(isEventDay("2026-11-11")).toBe(false);
  });

  it("marks rule-derived jobs reports as such", () => {
    expect(eventsOn("2026-11-06").find((e) => e.kind === "US_NFP")?.basis).toBe("rule");
  });
});

describe("buildEventFlags", () => {
  it("is deterministic and reports whether the calendar covers the date", () => {
    expect(buildEventFlags("2026-12-09")).toEqual(buildEventFlags("2026-12-09"));
    expect(buildEventFlags("2026-12-09").events.map((e) => e.kind)).toEqual(["FOMC"]);
    expect(buildEventFlags("2026-11-11")).toMatchObject({ events: [], calendarCovers: true });
    expect(buildEventFlags("2028-06-01").calendarCovers).toBe(false);
    expect("2028-06-01" > CALENDAR_COVERED_THROUGH).toBe(true);
  });
});
