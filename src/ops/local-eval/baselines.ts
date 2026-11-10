// Comparator strategies and net expectancy over {@link DayRecord}s (offline measurement).
//
// Every strategy is scored on the SAME matched days, against the SAME realised session, with
// the SAME execution costs, so the only thing that differs is the direction it chose:
//
//   model            - the pattern engine's dominant direction
//   weekly_trend     - sign of the 5-day move (the project's baseline)
//   follow_yesterday - repeat the previous completed session's direction
//   random_direction - a fair coin on the same days (analytic: 50% hit, zero gross, costs only)
//   always_long / always_short - the unconditional base rate of the target
//
// Headline metric: NET expectancy per trade in pips, entering at the open of the target session
// and exiting at its close (no stop or target), after the Execution_Model's per-pair friction.
// Pure and deterministic. Feeds nothing back into firing.
import { DEFAULT_EXECUTION_MODEL, totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import { summarizeRate, Z_95, type Interval, type RateSummary } from "../../performance/evidenceStats.js";
import { realizedFor, type DayRecord, type TargetSession } from "./dayRecords.js";
import { subsetOf, type SubsetName } from "./scoring.js";

export type ComparatorId =
  | "model"
  | "weekly_trend"
  | "follow_yesterday"
  | "random_direction"
  | "always_long"
  | "always_short";

export interface StrategySummary {
  readonly id: ComparatorId;
  /** Trades taken (days where the strategy had a call and the session result exists). */
  readonly trades: number;
  /** Hit rate against the realised sign (realised-FLAT days excluded from the denominator). */
  readonly hitRate: RateSummary;
  readonly hitRateByDirection: Readonly<Record<"UP" | "DOWN", RateSummary>>;
  readonly meanGrossPips: number;
  readonly meanNetPips: number;
  /** Normal-approximation 95% interval on the mean net pips (raw n; overlap not discounted). */
  readonly netPipsCi95: Interval;
  readonly meanCostPips: number;
}

interface Trade {
  readonly call: "UP" | "DOWN";
  readonly grossPips: number;
  readonly costPips: number;
  readonly hit: boolean | null;
}

function pickCall(id: ComparatorId, r: DayRecord): "UP" | "DOWN" | null {
  switch (id) {
    case "model":
      return r.direction === "FLAT" ? null : r.direction;
    case "weekly_trend":
      return r.weeklyTrendSign;
    case "follow_yesterday":
      return r.yesterdaySign === "UP" || r.yesterdaySign === "DOWN" ? r.yesterdaySign : null;
    case "always_long":
      return "UP";
    case "always_short":
      return "DOWN";
    case "random_direction":
      return null; // handled analytically
  }
}

function summarizeTrades(id: ComparatorId, trades: readonly Trade[]): StrategySummary {
  const n = trades.length;
  const scored = trades.filter((t) => t.hit !== null);
  const hits = scored.filter((t) => t.hit === true).length;
  const byDir = { UP: { h: 0, n: 0 }, DOWN: { h: 0, n: 0 } };
  for (const t of scored) {
    byDir[t.call].n += 1;
    if (t.hit === true) byDir[t.call].h += 1;
  }
  const net = trades.map((t) => t.grossPips - t.costPips);
  const mean = n === 0 ? 0 : net.reduce((a, b) => a + b, 0) / n;
  const variance = n < 2 ? 0 : net.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = n === 0 ? 0 : Math.sqrt(variance / n);
  return {
    id,
    trades: n,
    hitRate: summarizeRate(hits, scored.length),
    hitRateByDirection: { UP: summarizeRate(byDir.UP.h, byDir.UP.n), DOWN: summarizeRate(byDir.DOWN.h, byDir.DOWN.n) },
    meanGrossPips: n === 0 ? 0 : trades.reduce((a, t) => a + t.grossPips, 0) / n,
    meanNetPips: mean,
    netPipsCi95: { lo: mean - Z_95 * se, hi: mean + Z_95 * se },
    meanCostPips: n === 0 ? 0 : trades.reduce((a, t) => a + t.costPips, 0) / n,
  };
}

/**
 * Compare all strategies on the days where the model has a call (`directional`) or fires
 * (`firing`). `random_direction` is analytic: a fair coin has a 50% hit rate and zero gross
 * expectancy, so its net expectancy is exactly minus the mean cost on those days.
 */
export function compareStrategies(
  records: readonly DayRecord[],
  subset: SubsetName,
  session: TargetSession,
  executionModel: ExecutionModel = DEFAULT_EXECUTION_MODEL,
): readonly StrategySummary[] {
  const days = subsetOf(records, subset).filter((r) => realizedFor(r, session) !== null);
  const ids: readonly ComparatorId[] = ["model", "weekly_trend", "follow_yesterday", "always_long", "always_short"];
  const out: StrategySummary[] = ids.map((id) => {
    const trades: Trade[] = [];
    for (const r of days) {
      const call = pickCall(id, r);
      const real = realizedFor(r, session);
      if (call === null || real === null) continue;
      trades.push({
        call,
        grossPips: call === "UP" ? real.pips : -real.pips,
        costPips: totalCostPips(executionModel, r.pair),
        hit: real.sign === "FLAT" ? null : real.sign === call,
      });
    }
    return summarizeTrades(id, trades);
  });

  const meanCost = days.length === 0 ? 0 : days.reduce((a, r) => a + totalCostPips(executionModel, r.pair), 0) / days.length;
  out.splice(3, 0, {
    id: "random_direction",
    trades: days.length,
    hitRate: summarizeRate(Math.round(days.length / 2), days.length),
    hitRateByDirection: { UP: summarizeRate(0, 0), DOWN: summarizeRate(0, 0) },
    meanGrossPips: 0,
    meanNetPips: -meanCost,
    netPipsCi95: { lo: -meanCost, hi: -meanCost },
    meanCostPips: meanCost,
  });
  return out;
}
