import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BAR_LENGTH_MS } from "../intraday-validation/formingBar.js";

// REGRESSION GUARD for the intraday trigger time.
//
// The intraday Job validates against the 4H bar that is "currently forming": the bar whose open
// equals floor(now, 4h). That bar only exists at the provider once it has some ticks, so a run
// that fires exactly ON a 4H boundary finds no bar and every pair comes back "unavailable".
//
// That is exactly what happened on Mon 2026-11-09: the schedule was `0 8 * * 1-5` Europe/London,
// which is 08:00 UTC (a boundary) from the end of British Summer Time, so the first scheduled run
// started 35 s into the bar, validated 0 of 5 pairs and published nothing. Friday's manual runs had
// all been mid-bar (10 min and 221 min in), so it was never seen.
//
// This test reads the COMMITTED scheduler config and checks the margin in BOTH seasons, so the
// time cannot drift back onto a boundary - in winter OR when the clocks change.

interface SchedulerConfig {
  readonly schedule: string;
  readonly timeZone: string;
}

const config = JSON.parse(
  readFileSync(
    new URL("../../ops/intraday-validation-scheduler.config.json", import.meta.url),
    "utf8",
  ),
) as SchedulerConfig;

/** Minimum clearance, in minutes, from the nearest 4H boundary on EITHER side. */
const MIN_CLEARANCE_MIN = 30;

/** The UTC instant at which a `M H * * *` cron fires in `timeZone` on the given calendar day. */
function fireInstantUtc(cron: string, timeZone: string, year: number, month: number, day: number): Date {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(cron);
  if (match === null) {
    throw new Error(`unsupported cron shape for this test: "${cron}" (expected "M H * * 1-5")`);
  }
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  // Local wall-clock -> UTC: guess the instant as if local were UTC, measure the zone's offset
  // there, and subtract it. (Correct away from DST transitions, which these dates avoid.)
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (localAsUtc - guess));
}

/** Minutes between the 4H bar's open and the instant (0 = exactly on a boundary). */
function minutesIntoBar(instant: Date): number {
  return (instant.getTime() % BAR_LENGTH_MS) / 60_000;
}

// A mid-winter weekday (GMT = UTC) and a mid-summer weekday (BST = UTC+1).
const WINTER = [2026, 12, 16] as const;
const SUMMER = [2026, 7, 15] as const;

describe("intraday trigger time keeps clear of the 4H bar boundaries", () => {
  it("is a weekday schedule in Europe/London", () => {
    expect(config.timeZone).toBe("Europe/London");
    expect(config.schedule).toMatch(/ \* \* 1-5$/);
  });

  for (const [season, [y, m, d]] of [
    ["winter (GMT)", WINTER],
    ["summer (BST)", SUMMER],
  ] as const) {
    it(`is at least ${MIN_CLEARANCE_MIN} min inside a 4H bar in ${season}`, () => {
      const fires = fireInstantUtc(config.schedule, config.timeZone, y, m, d);
      const into = minutesIntoBar(fires);
      const untilNext = BAR_LENGTH_MS / 60_000 - into;

      expect(
        into,
        `fires ${fires.toISOString()} = ${into} min into the bar - too close to the boundary`,
      ).toBeGreaterThanOrEqual(MIN_CLEARANCE_MIN);
      expect(untilNext).toBeGreaterThanOrEqual(MIN_CLEARANCE_MIN);
    });
  }

  it("the check itself catches the original 08:00 London mistake (documents the incident)", () => {
    const winter = fireInstantUtc("0 8 * * 1-5", "Europe/London", ...WINTER);
    const summer = fireInstantUtc("0 8 * * 1-5", "Europe/London", ...SUMMER);

    expect(winter.toISOString()).toBe("2026-12-16T08:00:00.000Z");
    expect(minutesIntoBar(winter)).toBe(0); // exactly on the boundary: the bug
    expect(minutesIntoBar(summer)).toBe(180); // fine in summer, which is why it looked healthy
  });

  it("the committed 07:00 London time is mid-bar in both seasons", () => {
    expect(minutesIntoBar(fireInstantUtc("0 7 * * 1-5", "Europe/London", ...WINTER))).toBe(180);
    expect(minutesIntoBar(fireInstantUtc("0 7 * * 1-5", "Europe/London", ...SUMMER))).toBe(120);
  });
});
