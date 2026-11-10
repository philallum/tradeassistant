import { describe, expect, it } from "vitest";

import { dailyRun, fires } from "../dashboard/dashboard.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import { adaptCustomPattern } from "../strategies/adapters.js";
import { withholdBehindPairs } from "./main.js";
import { buildRunHealthSlice } from "./runHealthSlice.js";
import { pairEvaluationRows } from "./snapshot.js";

function ev(pair: PairEvaluation["pair"], over: Partial<PairEvaluation> = {}): PairEvaluation {
  return {
    pair,
    earnedConfidence: 0.62 as PairEvaluation["earnedConfidence"],
    direction: "UP",
    horizon: 1,
    excursionProfile: { favorablePips: 20, adversePips: 10 },
    stopLossPips: 30,
    takeProfitPips: 45,
    choppiness: 0.4,
    rationale: "",
    analogueLabels: [],
    analogueCount: 80,
    ...over,
  };
}
const EVALS = [ev("EURUSD"), ev("GBPUSD"), ev("USDJPY")];
const loader = (evals: readonly PairEvaluation[]) => () => Promise.resolve(evals);

describe("withholding a pair whose candles are behind", () => {
  it("a withheld pair never fires, however confident", () => {
    expect(fires(ev("EURUSD"), 0.55)).toBe(true);
    expect(fires(ev("EURUSD", { withheld: true }), 0.55)).toBe(false);
  });

  it("marks only the pairs left behind", async () => {
    const out = await withholdBehindPairs(loader(EVALS), ["GBPUSD"])("2026-11-11", {} as never);
    expect(out.map((e) => [e.pair, e.withheld === true])).toEqual([["EURUSD", false], ["GBPUSD", true], ["USDJPY", false]]);
  });

  it("a healthy day is untouched: same loader, same view, byte-identical", async () => {
    const base = loader(EVALS);
    expect(withholdBehindPairs(base, [])).toBe(base);
    const healthy = await withholdBehindPairs(base, [])("2026-11-11", {} as never);
    expect(JSON.stringify(dailyRun("2026-11-11", healthy))).toBe(JSON.stringify(dailyRun("2026-11-11", EVALS)));
  });

  it("the view drops only the withheld pair's card", async () => {
    const out = await withholdBehindPairs(loader(EVALS), ["GBPUSD"])("2026-11-11", {} as never);
    expect(dailyRun("2026-11-11", out).cards.map((c) => c.pair)).toEqual(["EURUSD", "USDJPY"]);
  });

  it("is reported as silent with reason DATA_BEHIND and published as no call", async () => {
    const out = await withholdBehindPairs(loader(EVALS), ["GBPUSD"])("2026-11-11", {} as never);
    const health = buildRunHealthSlice(out, ["GBPUSD"]);
    expect(health.rows.find((r) => r.pair === "GBPUSD")).toMatchObject({ data_behind: true, silence_reason: "DATA_BEHIND" });
    expect(health.rows.find((r) => r.pair === "EURUSD")?.silence_reason).toBeNull();
    const rows = pairEvaluationRows("2026-11-11", out);
    expect(rows.find((r) => r.pair === "GBPUSD")).toMatchObject({ direction: "FLAT", earned_confidence: 0.5, fired: false });
    expect(rows.find((r) => r.pair === "EURUSD")).toMatchObject({ direction: "UP", fired: true });
  });

  it("contributes no custom_pattern signal, so it is not recorded to the scorecard", () => {
    expect(adaptCustomPattern(ev("EURUSD")).kind).toBe("signal");
    expect(adaptCustomPattern(ev("EURUSD", { withheld: true })).kind).toBe("unavailable");
  });
});
