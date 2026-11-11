// Pre-registration 4: the four rule strategies on H1 / H3 / H5 / BR outcomes (pure; no I/O).
//
// Primary statistic is the excess hit rate over the direction-mix expectation
// E = u*r + (1-u)*(1-r), where u = share of UP calls and r = share of UP outcomes on the same
// scored days. It removes the credit a strategy gets just from leaning with a trend in the period.
import type { Interval } from "../../performance/evidenceStats.js";
import type { Pair } from "../../ingestion/types.js";
import { totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import { netPips, OUTCOME_SPAN, OUTCOMES, type OutcomeId, type PairOutcomeTable } from "./horizonOutcomes.js";
import { RULE_STRATEGIES, type ResearchRow, type RuleStrategyId } from "./researchDataset.js";
import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
  MIN_STABILITY_SCORED,
  RESEARCH_EXPLORATION_WINDOW,
} from "./researchProtocol.js";
import { benjaminiHochberg, blockBootstrap } from "./researchStats.js";

export interface StrategyTrade {
  readonly pair: Pair;
  readonly date: string;
  readonly call: "UP" | "DOWN";
  readonly weeklyTrendSign: "UP" | "DOWN";
  readonly realisedSide: "UP" | "DOWN" | null;
  readonly hit: boolean | null;
  readonly baselineHit: boolean | null;
  readonly net: number;
}

/** Trades of one strategy for one outcome. Rows whose 5-session window leaves the window are dropped. */
export function strategyTrades(
  rows: readonly ResearchRow[],
  tables: ReadonlyMap<Pair, PairOutcomeTable>,
  strategy: RuleStrategyId,
  outcome: OutcomeId,
  model: ExecutionModel,
  windowEnd: string = RESEARCH_EXPLORATION_WINDOW.end,
): StrategyTrade[] {
  const maxSpan = Math.max(...OUTCOMES.map((o) => OUTCOME_SPAN[o]));
  const out: StrategyTrade[] = [];
  for (const r of rows) {
    const call = r.strategies[strategy];
    if (call !== "UP" && call !== "DOWN") continue;
    const t = tables.get(r.pair);
    const i = t?.indexByDate.get(r.date);
    if (t === undefined || i === undefined) continue;
    const last = t.candles[i + maxSpan];
    if (last === undefined || last.date > windowEnd) continue;
    const realised = t.byOutcome[outcome][i];
    if (realised === null || realised === undefined) continue;
    const side = realised.side;
    out.push({
      pair: r.pair,
      date: r.date,
      call,
      weeklyTrendSign: r.weeklyTrendSign,
      realisedSide: side,
      hit: side === null ? null : call === side,
      baselineHit: side === null ? null : r.weeklyTrendSign === side,
      net: netPips(call, realised, totalCostPips(model, r.pair)),
    });
  }
  return out;
}

/** Excess hit rate over the direction-mix expectation, on scored trades. NaN when undefined. */
export function excessHit(trades: readonly StrategyTrade[]): number {
  let n = 0;
  let hits = 0;
  let upCalls = 0;
  let upOutcomes = 0;
  for (const t of trades) {
    if (t.hit === null) continue;
    n += 1;
    if (t.hit) hits += 1;
    if (t.call === "UP") upCalls += 1;
    if (t.realisedSide === "UP") upOutcomes += 1;
  }
  if (n === 0) return Number.NaN;
  const u = upCalls / n;
  const r = upOutcomes / n;
  return hits / n - (u * r + (1 - u) * (1 - r));
}

const monthBlock = (t: { date: string }): string => t.date.slice(0, 7);

export interface StrategyCell {
  readonly strategy: RuleStrategyId;
  readonly outcome: OutcomeId;
  readonly trades: number;
  readonly scored: number;
  readonly hit: number;
  readonly hitCi: Interval;
  readonly expected: number;
  readonly excess: number;
  readonly excessCi: Interval;
  readonly excessP: number;
  readonly baselineHit: number;
  readonly uplift: number;
  readonly netMean: number;
  readonly netCi: Interval;
  readonly upCallShare: number;
  readonly upOutcomeShare: number;
  readonly yearsPositive: number;
  readonly yearsTotal: number;
  readonly pairsPositive: number;
  readonly pairsTotal: number;
  excessQ: number | null;
  significant: boolean;
  promising: boolean;
}

function stability(trades: readonly StrategyTrade[], keyOf: (t: StrategyTrade) => string): { positive: number; total: number } {
  const g = new Map<string, StrategyTrade[]>();
  for (const t of trades) {
    if (t.hit === null) continue;
    const k = keyOf(t);
    const x = g.get(k);
    if (x === undefined) g.set(k, [t]);
    else x.push(t);
  }
  let positive = 0;
  let total = 0;
  for (const x of g.values()) {
    if (x.length < MIN_STABILITY_SCORED) continue;
    total += 1;
    if (excessHit(x) > 0) positive += 1;
  }
  return { positive, total };
}

export function summariseStrategy(strategy: RuleStrategyId, outcome: OutcomeId, trades: readonly StrategyTrade[], seed: number): StrategyCell {
  const scored = trades.filter((t) => t.hit !== null);
  const hitStat = (s: readonly StrategyTrade[]): number => {
    const x = s.filter((t) => t.hit !== null);
    return x.length === 0 ? Number.NaN : x.filter((t) => t.hit === true).length / x.length;
  };
  const netStat = (s: readonly StrategyTrade[]): number => (s.length === 0 ? Number.NaN : s.reduce((a, t) => a + t.net, 0) / s.length);
  const h = blockBootstrap(scored, monthBlock, hitStat, BOOTSTRAP_ITERATIONS, seed, 0.5);
  const e = blockBootstrap(scored, monthBlock, excessHit, BOOTSTRAP_ITERATIONS, seed + 1);
  const n = blockBootstrap(trades, monthBlock, netStat, BOOTSTRAP_ITERATIONS, seed + 2);
  const hit = scored.length === 0 ? 0 : scored.filter((t) => t.hit === true).length / scored.length;
  const ex = excessHit(scored);
  const baseScored = scored.filter((t) => t.baselineHit !== null);
  const baselineHit = baseScored.length === 0 ? 0 : baseScored.filter((t) => t.baselineHit === true).length / baseScored.length;
  const years = stability(trades, (t) => t.date.slice(0, 4));
  const pairs = stability(trades, (t) => t.pair);
  return {
    strategy,
    outcome,
    trades: trades.length,
    scored: scored.length,
    hit,
    hitCi: h.ci95,
    expected: Number.isFinite(ex) ? hit - ex : 0,
    excess: Number.isFinite(ex) ? ex : 0,
    excessCi: e.ci95,
    excessP: e.p,
    baselineHit,
    uplift: hit - baselineHit,
    netMean: Number.isFinite(n.estimate) ? n.estimate : 0,
    netCi: n.ci95,
    upCallShare: scored.length === 0 ? 0 : scored.filter((t) => t.call === "UP").length / scored.length,
    upOutcomeShare: scored.length === 0 ? 0 : scored.filter((t) => t.realisedSide === "UP").length / scored.length,
    yearsPositive: years.positive,
    yearsTotal: years.total,
    pairsPositive: pairs.positive,
    pairsTotal: pairs.total,
    excessQ: null,
    significant: false,
    promising: false,
  };
}

/** Outcomes inside family S (H1 is reference only). */
export const STRATEGY_FAMILY_OUTCOMES: readonly OutcomeId[] = ["H3", "H5", "BR"];

export interface StrategyHorizonStudy {
  readonly cells: readonly StrategyCell[];
  readonly promising: readonly StrategyCell[];
}

export function studyStrategyHorizons(
  trades: Readonly<Record<RuleStrategyId, Readonly<Record<OutcomeId, readonly StrategyTrade[]>>>>,
): StrategyHorizonStudy {
  const cells: StrategyCell[] = [];
  let seed = BOOTSTRAP_SEED + 50000;
  for (const s of RULE_STRATEGIES) {
    for (const o of OUTCOMES) {
      seed += 5;
      cells.push(summariseStrategy(s, o, trades[s][o], seed));
    }
  }
  const family = cells.filter((c) => STRATEGY_FAMILY_OUTCOMES.includes(c.outcome));
  const fdr = benjaminiHochberg(family.map((c) => c.excessP), FDR_Q);
  family.forEach((c, k) => {
    c.excessQ = fdr.adjusted[k] as number;
    c.significant = fdr.rejected[k] === true && c.scored >= MIN_REPORTABLE_SCORED;
    c.promising =
      c.significant &&
      c.excess > 0 &&
      c.netCi.lo > 0 &&
      c.yearsTotal > 0 &&
      c.yearsPositive / c.yearsTotal >= 0.6 &&
      c.pairsTotal > 0 &&
      c.pairsPositive / c.pairsTotal >= 0.6;
  });
  return { cells, promising: family.filter((c) => c.promising) };
}
