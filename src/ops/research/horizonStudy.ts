// Pre-registration 3 analysis: score each source x outcome, run families U and C (pure; no I/O).
import type { Interval } from "../../performance/evidenceStats.js";
import type { Pair } from "../../ingestion/types.js";
import { totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import {
  analogueCall,
  netPips,
  OUTCOME_SPAN,
  OUTCOMES,
  type OutcomeId,
  type PairOutcomeTable,
} from "./horizonOutcomes.js";
import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
  MIN_STABILITY_SCORED,
  RESEARCH_EXPLORATION_WINDOW,
} from "./researchProtocol.js";
import { benjaminiHochberg, blockBootstrap, blockBootstrapSpearman } from "./researchStats.js";

export const SOURCES = ["V0", "V0b", "V1"] as const;
export type SourceId = (typeof SOURCES)[number];

/** One decision date with the retrieved neighbourhood (analogue dates, nearest first). */
export interface NeighbourRow {
  readonly pair: Pair;
  readonly date: string;
  readonly weeklyTrendSign: "UP" | "DOWN";
  readonly analogueDates: readonly string[];
}

export interface ScoredRow {
  readonly pair: Pair;
  readonly date: string;
  readonly direction: "UP" | "DOWN" | "FLAT";
  readonly confidence: number;
  readonly n: number;
  readonly fires: boolean;
  readonly weeklyTrendSign: "UP" | "DOWN";
  readonly realisedSide: "UP" | "DOWN" | null;
  readonly hit: boolean | null;
  readonly baselineHit: boolean | null;
  readonly net: number | null;
  readonly baselineNet: number | null;
}

const monthBlock = (r: { date: string }): string => r.date.slice(0, 7);

/**
 * Score one outcome for one source. Rows whose outcome window would end after the exploration
 * window are dropped, so no realised outcome reads a holdout price.
 */
export function scoreOutcome(
  rows: readonly NeighbourRow[],
  tables: ReadonlyMap<Pair, PairOutcomeTable>,
  outcome: OutcomeId,
  model: ExecutionModel,
  windowEnd: string = RESEARCH_EXPLORATION_WINDOW.end,
): ScoredRow[] {
  const out: ScoredRow[] = [];
  const maxSpan = Math.max(...OUTCOMES.map((o) => OUTCOME_SPAN[o]));
  for (const r of rows) {
    const t = tables.get(r.pair);
    if (t === undefined) continue;
    const i = t.indexByDate.get(r.date);
    if (i === undefined) continue;
    // The same row set for every outcome: the longest window must close inside the window.
    const lastNeeded = t.candles[i + maxSpan];
    if (lastNeeded === undefined || lastNeeded.date > windowEnd) continue;
    const realised = t.byOutcome[outcome][i];
    if (realised === null || realised === undefined) continue;
    const call = analogueCall(t, i, r.analogueDates, outcome);
    const cost = totalCostPips(model, r.pair);
    const side = realised.side;
    out.push({
      pair: r.pair,
      date: r.date,
      direction: call.direction,
      confidence: call.confidence,
      n: call.n,
      fires: call.direction !== "FLAT" && call.confidence >= 0.55,
      weeklyTrendSign: r.weeklyTrendSign,
      realisedSide: side,
      hit: call.direction === "FLAT" || side === null ? null : call.direction === side,
      baselineHit: side === null ? null : r.weeklyTrendSign === side,
      net: call.direction === "FLAT" ? null : netPips(call.direction, realised, cost),
      baselineNet: netPips(r.weeklyTrendSign, realised, cost),
    });
  }
  return out;
}

export type Subset = "directional" | "firing";

export interface CellSummary {
  readonly source: SourceId;
  readonly outcome: OutcomeId;
  readonly subset: Subset;
  readonly days: number;
  readonly scored: number;
  readonly meanN: number;
  readonly hit: number;
  readonly baselineHit: number;
  readonly uplift: number;
  readonly upliftCi: Interval;
  readonly upliftP: number;
  readonly netMean: number;
  readonly netCi: Interval;
  readonly baselineNetMean: number;
  readonly upShare: number;
  readonly equalsWeeklyTrend: number;
  readonly hitWhenDiffers: { readonly scored: number; readonly hit: number };
  readonly yearsPositive: number;
  readonly yearsTotal: number;
  readonly pairsPositive: number;
  readonly pairsTotal: number;
  readonly confRho: number;
  readonly confCi: Interval;
  readonly confP: number;
  upliftQ: number | null;
  upliftSignificant: boolean;
  confQ: number | null;
  confSignificant: boolean;
  promising: boolean;
}

function upliftStat(s: readonly ScoredRow[]): number {
  let n = 0;
  let m = 0;
  let b = 0;
  for (const r of s) {
    if (r.hit === null || r.baselineHit === null) continue;
    n += 1;
    if (r.hit) m += 1;
    if (r.baselineHit) b += 1;
  }
  return n === 0 ? Number.NaN : (m - b) / n;
}

function netStat(s: readonly ScoredRow[]): number {
  let n = 0;
  let sum = 0;
  for (const r of s) {
    if (r.net === null) continue;
    n += 1;
    sum += r.net;
  }
  return n === 0 ? Number.NaN : sum / n;
}

function stability(scored: readonly ScoredRow[], keyOf: (r: ScoredRow) => string): { positive: number; total: number } {
  const g = new Map<string, ScoredRow[]>();
  for (const r of scored) {
    const k = keyOf(r);
    const x = g.get(k);
    if (x === undefined) g.set(k, [r]);
    else x.push(r);
  }
  let positive = 0;
  let total = 0;
  for (const rows of g.values()) {
    if (rows.length < MIN_STABILITY_SCORED) continue;
    total += 1;
    if (upliftStat(rows) > 0) positive += 1;
  }
  return { positive, total };
}

export function summariseCell(
  source: SourceId,
  outcome: OutcomeId,
  subset: Subset,
  rows: readonly ScoredRow[],
  seed: number,
): CellSummary {
  const sub = rows.filter((r) => r.direction !== "FLAT" && (subset === "directional" || r.fires));
  const scored = sub.filter((r) => r.hit !== null && r.baselineHit !== null);
  const u = blockBootstrap(scored, monthBlock, upliftStat, BOOTSTRAP_ITERATIONS, seed);
  const netRows = sub.filter((r) => r.net !== null);
  const nb = blockBootstrap(netRows, monthBlock, netStat, BOOTSTRAP_ITERATIONS, seed + 1);
  const xs = scored.map((r) => r.confidence);
  const ys = scored.map((r) => (r.hit === true ? 1 : 0));
  const c =
    scored.length >= 30
      ? blockBootstrapSpearman(xs, ys, scored.map(monthBlock), BOOTSTRAP_ITERATIONS, seed + 2)
      : { estimate: 0, ci95: { lo: 0, hi: 0 }, p: 1 };
  const differs = scored.filter((r) => r.direction !== r.weeklyTrendSign);
  const years = stability(scored, (r) => r.date.slice(0, 4));
  const pairs = stability(scored, (r) => r.pair);
  const decisive = sub.filter((r) => r.realisedSide !== null);
  const baseNets = sub.filter((r) => r.baselineNet !== null);
  return {
    source,
    outcome,
    subset,
    days: sub.length,
    scored: scored.length,
    meanN: sub.length === 0 ? 0 : sub.reduce((a, r) => a + r.n, 0) / sub.length,
    hit: scored.length === 0 ? 0 : scored.filter((r) => r.hit === true).length / scored.length,
    baselineHit: scored.length === 0 ? 0 : scored.filter((r) => r.baselineHit === true).length / scored.length,
    uplift: Number.isFinite(u.estimate) ? u.estimate : 0,
    upliftCi: u.ci95,
    upliftP: u.p,
    netMean: Number.isFinite(nb.estimate) ? nb.estimate : 0,
    netCi: nb.ci95,
    baselineNetMean: baseNets.length === 0 ? 0 : baseNets.reduce((a, r) => a + (r.baselineNet as number), 0) / baseNets.length,
    upShare: decisive.length === 0 ? 0 : decisive.filter((r) => r.realisedSide === "UP").length / decisive.length,
    equalsWeeklyTrend: sub.length === 0 ? 0 : sub.filter((r) => r.direction === r.weeklyTrendSign).length / sub.length,
    hitWhenDiffers: {
      scored: differs.length,
      hit: differs.length === 0 ? 0 : differs.filter((r) => r.hit === true).length / differs.length,
    },
    yearsPositive: years.positive,
    yearsTotal: years.total,
    pairsPositive: pairs.positive,
    pairsTotal: pairs.total,
    confRho: c.estimate,
    confCi: c.ci95,
    confP: c.p,
    upliftQ: null,
    upliftSignificant: false,
    confQ: null,
    confSignificant: false,
    promising: false,
  };
}

/** The outcomes in the pre-registered families (H1 is reference only). */
export const FAMILY_OUTCOMES: readonly OutcomeId[] = ["H3", "H5", "BR"];

export interface HorizonStudy {
  readonly cells: readonly CellSummary[];
  readonly promising: readonly CellSummary[];
}

export function studyHorizons(scored: Readonly<Record<SourceId, Readonly<Record<OutcomeId, readonly ScoredRow[]>>>>): HorizonStudy {
  const cells: CellSummary[] = [];
  let seed = BOOTSTRAP_SEED + 40000;
  for (const source of SOURCES) {
    for (const outcome of OUTCOMES) {
      for (const subset of ["directional", "firing"] as const) {
        seed += 5;
        cells.push(summariseCell(source, outcome, subset, scored[source][outcome], seed));
      }
    }
  }
  const family = cells.filter((c) => c.subset === "directional" && FAMILY_OUTCOMES.includes(c.outcome));
  const u = benjaminiHochberg(family.map((c) => c.upliftP), FDR_Q);
  const cf = benjaminiHochberg(family.map((c) => c.confP), FDR_Q);
  family.forEach((c, k) => {
    const enough = c.scored >= MIN_REPORTABLE_SCORED;
    c.upliftQ = u.adjusted[k] as number;
    c.upliftSignificant = u.rejected[k] === true && enough;
    c.confQ = cf.adjusted[k] as number;
    c.confSignificant = cf.rejected[k] === true && enough;
    c.promising =
      c.upliftSignificant &&
      c.uplift > 0 &&
      c.netCi.lo > 0 &&
      c.yearsTotal > 0 &&
      c.yearsPositive / c.yearsTotal >= 0.6 &&
      c.pairsTotal > 0 &&
      c.pairsPositive / c.pairsTotal >= 0.6;
  });
  return { cells, promising: family.filter((c) => c.promising) };
}
