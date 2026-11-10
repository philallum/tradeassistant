import { describe, expect, it } from "vitest";

import { dailyRun } from "../dashboard/dashboard.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import { buildDashboardSnapshot } from "./snapshot.js";
import { EMPTY_RUN_HEALTH, buildRunHealthSlice, silenceReason } from "./runHealthSlice.js";

function ev(over: Partial<PairEvaluation> = {}): PairEvaluation {
  return {
    pair: "EURUSD",
    earnedConfidence: 0.58 as PairEvaluation["earnedConfidence"],
    direction: "UP",
    horizon: 1,
    excursionProfile: { favorablePips: 20, adversePips: 10 },
    stopLossPips: 30,
    takeProfitPips: 45,
    choppiness: 0.4,
    rationale: "",
    analogueLabels: [],
    analogueCount: 120,
    ...over,
  };
}

/** A shallow copy of `obj` without `key` (keeps property order). */
function omitKey<T extends object>(obj: T, key: string): object {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

describe("silenceReason", () => {
  it("a firing pair has no silence reason", () => {
    expect(silenceReason(ev(), false)).toBeNull();
  });

  it("names exactly one reason, in priority order", () => {
    expect(silenceReason(ev({ earnedConfidence: 0.5 as never, direction: "FLAT", analogueCount: 3 }), true)).toBe("DATA_BEHIND");
    expect(silenceReason(ev({ earnedConfidence: 0.5 as never, direction: "FLAT", analogueCount: 3 }), false)).toBe("THIN_NEIGHBOURHOOD");
    expect(silenceReason(ev({ earnedConfidence: 0.5 as never, direction: "FLAT" }), false)).toBe("NO_DIRECTIONAL_VIEW");
    expect(silenceReason(ev({ earnedConfidence: 0.52 as never }), false)).toBe("BELOW_THRESHOLD");
  });

  it("does not claim a thin neighbourhood when n was not recorded", () => {
    const noCount = omitKey(ev({ earnedConfidence: 0.52 as never }), "analogueCount");
    expect(silenceReason(noCount as PairEvaluation, false)).toBe("BELOW_THRESHOLD");
  });
});

describe("buildRunHealthSlice", () => {
  it("emits one row per evaluated pair with n, the stale flag and the reason", () => {
    const slice = buildRunHealthSlice(
      [ev(), ev({ pair: "GBPUSD", direction: "FLAT", earnedConfidence: 0.5 as never, analogueCount: 12 }), ev({ pair: "USDJPY" })],
      ["USDJPY", "GBPUSD"],
    );
    expect(slice.degradedPairs).toEqual(["GBPUSD", "USDJPY"]);
    expect(slice.rows).toEqual([
      { pair: "EURUSD", analogue_count: 120, data_behind: false, silence_reason: null },
      { pair: "GBPUSD", analogue_count: 12, data_behind: true, silence_reason: "DATA_BEHIND" },
      // Fired on stale data: flagged behind, but NOT reported as silent.
      { pair: "USDJPY", analogue_count: 120, data_behind: true, silence_reason: null },
    ]);
  });

  it("is empty-safe", () => {
    expect(buildRunHealthSlice([])).toEqual({ ...EMPTY_RUN_HEALTH, degradedPairs: [] });
  });

  it("does not mutate its input", () => {
    const input = Object.freeze([Object.freeze(ev())]);
    expect(() => buildRunHealthSlice(input, ["EURUSD"])).not.toThrow();
  });
});

describe("guard: run health never changes a decision", () => {
  it("the dashboard view and every earlier snapshot key are identical with and without the slice", () => {
    const evaluations = [ev(), ev({ pair: "GBPUSD", earnedConfidence: 0.51 as never })];
    const view = dailyRun("2026-11-11", evaluations);
    const now = new Date("2026-11-10T22:30:00Z");
    const pairEvals = evaluations.map((e) => ({
      decision_date: "2026-11-11",
      pair: e.pair,
      direction: e.direction,
      horizon: e.horizon,
      earned_confidence: e.earnedConfidence,
      fired: e.direction !== "FLAT" && e.earnedConfidence >= 0.55,
      choppiness: e.choppiness,
    }));
    const without = buildDashboardSnapshot(view, undefined, {}, now, pairEvals);
    const withSlice = buildDashboardSnapshot(
      view, undefined, {}, now, pairEvals, {}, undefined, undefined, undefined, undefined,
      buildRunHealthSlice(evaluations, ["EURUSD", "GBPUSD"]),
    );
    const restWithout = omitKey(without, "runHealth");
    const restWith = omitKey(withSlice, "runHealth");
    expect(JSON.stringify(restWith)).toBe(JSON.stringify(restWithout));
    // Marking every pair as stale does not remove a firing setup (no withholding).
    expect(withSlice.firingSetups).toEqual(without.firingSetups);
    expect(withSlice.firingSetups.length).toBe(1);
    // runHealth is appended after v8 (before eventFlags), so earlier keys keep their byte order.
    expect(Object.keys(withSlice).slice(-2)).toEqual(["runHealth", "eventFlags"]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildEventFlags } from "../event-calendar/eventFlags.js";

describe("guard: event flags never change a decision", () => {
  it("firing output and every earlier snapshot key are identical with and without the flags", () => {
    const evaluations = [ev(), ev({ pair: "GBPUSD", earnedConfidence: 0.51 as never })];
    const view = dailyRun("2026-12-09", evaluations); // an FOMC decision day
    const now = new Date("2026-12-08T22:30:00Z");
    const without = buildDashboardSnapshot(view, undefined, {}, now, []);
    const withFlags = buildDashboardSnapshot(
      view, undefined, {}, now, [], {}, undefined, undefined, undefined, undefined, undefined,
      buildEventFlags("2026-12-09"),
    );
    expect(withFlags.eventFlags.events.map((e) => e.kind)).toEqual(["FOMC"]);
    const restWith = omitKey(withFlags, "eventFlags");
    const restWithout = omitKey(without, "eventFlags");
    expect(JSON.stringify(restWith)).toBe(JSON.stringify(restWithout));
    expect(withFlags.firingSetups).toEqual(without.firingSetups);
    expect(withFlags.firingSetups.length).toBe(1);
    expect(Object.keys(withFlags).at(-1)).toBe("eventFlags");
  });

  it("no live-path module imports the event calendar", () => {
    const SRC = join(__dirname, "..");
    const live = ["retrieval", "confidence", "risk-boundaries", "pipeline", "encoder", "baseline", "guard", "kill-gate"];
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const f = join(dir, n);
        return statSync(f).isDirectory() ? files(f) : n.endsWith(".ts") && !n.endsWith(".test.ts") ? [f] : [];
      });
    for (const mod of live) {
      for (const f of files(join(SRC, mod))) {
        expect(readFileSync(f, "utf8")).not.toMatch(/event-calendar/);
      }
    }
    // dashboard (firing predicate) must not import it either
    for (const f of files(join(SRC, "dashboard"))) expect(readFileSync(f, "utf8")).not.toMatch(/event-calendar/);
  });
});
