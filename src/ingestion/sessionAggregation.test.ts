import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  HOUR_MS,
  aggregateSessions,
  describeNoSession,
  latestCompleteSession,
  sessionCloseUtcMs,
  sessionLabelOf,
  sessionWindowUtcMs,
  type HourlyBar,
} from "./sessionAggregation.js";

// Daily candles are built from hourly bars on the 17:00 New York close. These tests pin the
// failure shapes found in production (see docs/state/RISKS.md, "DAILY CANDLE DATA INTEGRITY"):
// a minutes-old forming bar stored as final, a Saturday-labelled bar, and the Sunday open.

const utc = (iso: string): number => Date.parse(iso);

/** Hourly bars from `startIso`, `count` of them; price = start + i*step so OHLC is predictable. */
function hourly(startIso: string, count: number, startPrice = 1.1, step = 0.001): HourlyBar[] {
  const start = utc(startIso);
  return Array.from({ length: count }, (_, i) => {
    const open = startPrice + i * step;
    const close = open + step;
    return { openMs: start + i * HOUR_MS, open, high: close + 0.0002, low: open - 0.0002, close };
  });
}

// 2026-11-03 is in winter time (EST, UTC-5): 17:00 NY = 22:00 UTC.
// 2026-07-15 is in summer time (EDT, UTC-4): 17:00 NY = 21:00 UTC.
const AFTER_EVERYTHING = utc("2026-12-31T00:00:00Z");

describe("session boundaries are the 17:00 New York close, DST-aware", () => {
  it("winter: session closes 22:00 UTC and spans 24h from the previous evening", () => {
    expect(new Date(sessionCloseUtcMs("2026-11-05")).toISOString()).toBe("2026-11-05T22:00:00.000Z");
    const w = sessionWindowUtcMs("2026-11-05");
    expect(new Date(w.startMs).toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(w.endMs - w.startMs).toBe(24 * HOUR_MS);
  });

  it("summer: the same wall-clock close is 21:00 UTC", () => {
    expect(new Date(sessionCloseUtcMs("2026-07-15")).toISOString()).toBe("2026-07-15T21:00:00.000Z");
  });

  it("Monday's session opens Sunday 17:00 NY (not Friday, not Saturday)", () => {
    const w = sessionWindowUtcMs("2026-11-09"); // a Monday
    expect(new Date(w.startMs).toISOString()).toBe("2026-11-08T22:00:00.000Z"); // Sunday 17:00 EST
    expect(new Date(w.endMs).toISOString()).toBe("2026-11-09T22:00:00.000Z");
  });

  it("labels bars by the session they belong to", () => {
    expect(sessionLabelOf(utc("2026-11-05T21:00:00Z"))).toBe("2026-11-05"); // 16:00 NY Thu -> Thursday's session
    expect(sessionLabelOf(utc("2026-11-05T22:00:00Z"))).toBe("2026-11-06"); // 17:00 NY Thu -> Friday's session
    expect(sessionLabelOf(utc("2026-11-06T22:00:00Z"))).toBe("2026-11-07"); // Friday 17:00 NY -> Saturday: no such candle
    expect(sessionLabelOf(utc("2026-11-08T22:00:00Z"))).toBe("2026-11-09"); // Sunday 17:00 NY -> Monday
  });
});

describe("aggregateSessions: a complete, closed session becomes one candle", () => {
  it("builds O/H/L/C from the first open, max high, min low and last close", () => {
    // Thursday 2026-11-05 session: Wed 22:00 UTC -> Thu 22:00 UTC, 24 bars.
    const bars = hourly("2026-11-04T22:00:00Z", 24);
    const thu = aggregateSessions(bars, { nowMs: AFTER_EVERYTHING })[0];

    expect(thu?.ok).toBe(true);
    if (thu?.ok) {
      expect(thu.date).toBe("2026-11-05");
      expect(thu.bars).toBe(24);
      expect(thu.open).toBeCloseTo(1.1, 10);
      expect(thu.close).toBeCloseTo(1.1 + 24 * 0.001, 10);
      expect(thu.low).toBeCloseTo(1.1 - 0.0002, 10);
      expect(thu.high).toBeCloseTo(1.1 + 24 * 0.001 + 0.0002, 10);
    }
  });

  it("works in summer time too (21:00 UTC boundary)", () => {
    const bars = hourly("2026-07-14T21:00:00Z", 24);
    const s = aggregateSessions(bars, { nowMs: AFTER_EVERYTHING })[0];
    expect(s?.ok && s.date).toBe("2026-07-15");
  });
});

describe("aggregateSessions: the production failure shapes are rejected", () => {
  it("a FORMING session is never emitted (the 2026-11-04 bug: a bar captured minutes after the roll)", () => {
    // Wed 2026-11-04 22:00 UTC is the roll into Thursday's session. At 22:07 UTC only one hourly bar
    // of the new session exists, and the session is nowhere near closed.
    const bars = [
      ...hourly("2026-11-03T22:00:00Z", 24), // the complete Wednesday session
      ...hourly("2026-11-04T22:00:00Z", 1), // 7 minutes into Thursday's session
    ];
    const now = utc("2026-11-04T22:07:00Z");

    const results = aggregateSessions(bars, { nowMs: now });

    expect(results.map((r) => [r.date, r.ok])).toEqual([
      ["2026-11-04", true], // Wednesday: complete and closed - the correct candle for the target date
      ["2026-11-05", false], // Thursday: still forming
    ]);
    expect(results[1]).toMatchObject({ ok: false, reason: "not_closed" });
    expect(latestCompleteSession(results)?.date).toBe("2026-11-04");
  });

  it("a session whose FINAL hour has not been published is rejected, not stored short", () => {
    const bars = hourly("2026-11-04T22:00:00Z", 23); // 22:00 ... 20:00 UTC, last hour (21:00) missing
    const [r] = aggregateSessions(bars, { nowMs: AFTER_EVERYTHING });
    expect(r).toMatchObject({ ok: false, reason: "missing_end" });
  });

  it("a session that starts late in the fetched window (older bars cut off) is rejected", () => {
    const bars = hourly("2026-11-05T06:00:00Z", 16); // begins 8h after the session opened
    const [r] = aggregateSessions(bars, { nowMs: AFTER_EVERYTHING, minBars: 10 });
    expect(r).toMatchObject({ ok: false, reason: "missing_start" });
  });

  it("too few bars is rejected", () => {
    const bars = [...hourly("2026-11-04T22:00:00Z", 5), ...hourly("2026-11-05T20:00:00Z", 2)];
    const [r] = aggregateSessions(bars, { nowMs: AFTER_EVERYTHING });
    expect(r).toMatchObject({ ok: false, reason: "too_few_bars" });
  });

  it("Friday-evening and weekend bars never produce a Saturday or Sunday candle", () => {
    // Friday 2026-11-06 22:00 UTC (17:00 NY) through Sunday 21:00 UTC: market closed.
    const weekend = hourly("2026-11-06T22:00:00Z", 48);
    expect(aggregateSessions(weekend, { nowMs: AFTER_EVERYTHING })).toEqual([]);
  });

  it("Monday's candle starts at the Sunday-evening open and excludes the closed weekend", () => {
    // 6 weekend bars (should be ignored) + the full Monday session from Sunday 22:00 UTC.
    const weekend = hourly("2026-11-08T16:00:00Z", 6, 9.0); // Sunday 16:00-21:00 UTC: before the open
    const monday = hourly("2026-11-08T22:00:00Z", 24, 1.1);
    const results = aggregateSessions([...weekend, ...monday], { nowMs: AFTER_EVERYTHING });

    expect(results).toHaveLength(1);
    const mon = results[0]!;
    expect(mon.ok && mon.date).toBe("2026-11-09");
    // The 9.0-priced weekend bars must not leak into the candle.
    expect(mon.ok && mon.high).toBeLessThan(2);
    expect(mon.ok && mon.open).toBeCloseTo(1.1, 10);
  });

  it("asOf excludes the Decision_Date's own session and anything later (look-ahead safety)", () => {
    const bars = [...hourly("2026-11-03T22:00:00Z", 24), ...hourly("2026-11-04T22:00:00Z", 24)];
    const results = aggregateSessions(bars, { nowMs: AFTER_EVERYTHING, asOf: "2026-11-05" });
    expect(results.map((r) => r.date)).toEqual(["2026-11-04"]);
  });
});

describe("aggregateSessions: invariants", () => {
  it("input order and duplicate bars do not change the result", () => {
    const bars = hourly("2026-11-04T22:00:00Z", 24);
    const shuffled = [...bars].reverse().concat(bars.slice(0, 5));
    expect(aggregateSessions(shuffled, { nowMs: AFTER_EVERYTHING })).toEqual(
      aggregateSessions(bars, { nowMs: AFTER_EVERYTHING }),
    );
  });

  it("property: an emitted candle always satisfies low <= open,close <= high and is for a closed weekday session", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }), // days after a fixed Monday
        fc.integer({ min: 20, max: 48 }), // number of hourly bars
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (dayOffset, count, price) => {
          const start = utc("2026-09-07T22:00:00Z") + dayOffset * 24 * HOUR_MS;
          const bars: HourlyBar[] = Array.from({ length: count }, (_, i) => {
            const open = price + Math.sin(i) * 0.01;
            const close = price + Math.cos(i) * 0.01;
            return {
              openMs: start + i * HOUR_MS,
              open,
              close,
              high: Math.max(open, close) + 0.002,
              low: Math.min(open, close) - 0.002,
            };
          });
          const now = start + count * HOUR_MS;
          for (const r of aggregateSessions(bars, { nowMs: now })) {
            if (!r.ok) continue;
            expect(r.low).toBeLessThanOrEqual(Math.min(r.open, r.close));
            expect(r.high).toBeGreaterThanOrEqual(Math.max(r.open, r.close));
            expect(sessionCloseUtcMs(r.date)).toBeLessThanOrEqual(now);
            const day = new Date(`${r.date}T00:00:00Z`).getUTCDay();
            expect(day >= 1 && day <= 5).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("helpers", () => {
  it("describeNoSession explains the newest rejection", () => {
    const bars = hourly("2026-11-04T22:00:00Z", 23);
    expect(describeNoSession(aggregateSessions(bars, { nowMs: AFTER_EVERYTHING }))).toBe(
      "newest session 2026-11-05 is not usable: missing_end",
    );
    expect(describeNoSession([])).toBe("no hourly bars in the requested window");
  });
});
