// Part B analysis: score each encoding variant and run the four pre-registered paired comparisons
// (pure; no I/O). See docs/research/PRE-REGISTRATION-2.md.
import type { Interval } from "../../performance/evidenceStats.js";
import { totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import type { DayRecord } from "../local-eval/dayRecords.js";
import type { ResearchRow } from "./researchDataset.js";
import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
} from "./researchProtocol.js";
import { benjaminiHochberg, blockBootstrap, weekBlock } from "./researchStats.js";
import type { VariantId } from "./encodingVariants.js";

export interface VariantRow {
  readonly pair: string;
  readonly date: string;
  readonly direction: "UP" | "DOWN" | "FLAT";
  readonly fires: boolean;
  readonly confidence: number;
  readonly n: number;
  readonly weeklyTrendSign: "UP" | "DOWN";
  readonly hit: boolean | null;
  readonly baselineHit: boolean | null;
  readonly net: number | null;
}

export function rowsFromRecords(records: readonly DayRecord[], model: ExecutionModel): VariantRow[] {
  return records.map((r) => {
    const called = r.direction === "UP" || r.direction === "DOWN" ? r.direction : null;
    const real = r.realizedAfter;
    const scoreable = real !== null && real.sign !== "FLAT";
    return {
      pair: r.pair,
      date: r.date,
      direction: r.direction,
      fires: r.fires,
      confidence: r.confidence,
      n: r.n,
      weeklyTrendSign: r.weeklyTrendSign,
      hit: called === null || !scoreable ? null : real.sign === called,
      baselineHit: !scoreable ? null : real.sign === r.weeklyTrendSign,
      net: called === null || real === null ? null : (called === "UP" ? real.pips : -real.pips) - totalCostPips(model, r.pair),
    };
  });
}

export function rowsFromResearch(rows: readonly ResearchRow[]): VariantRow[] {
  return rows.map((r) => ({
    pair: r.pair,
    date: r.date,
    direction: r.direction,
    fires: r.fires,
    confidence: r.confidence,
    n: r.n,
    weeklyTrendSign: r.weeklyTrendSign,
    hit: r.hit,
    baselineHit: r.baselineHit,
    net: r.netPips,
  }));
}

export type VariantLabel = VariantId | "V0";
export type Subset = "directional" | "firing";

export interface VariantSummary {
  readonly id: VariantLabel;
  readonly subset: Subset;
  readonly days: number;
  readonly scored: number;
  readonly hit: number;
  readonly baselineHit: number;
  readonly uplift: number;
  readonly upliftCi: Interval;
  readonly netMean: number;
  readonly netCi: Interval;
  readonly meanN: number;
  /** Share of called days on which the variant's call equals the weekly-trend sign. */
  readonly equalsWeeklyTrend: number;
  /** Hit rate on days where the call differs from the weekly trend / equals it (descriptive). */
  readonly hitWhenDiffers: { readonly scored: number; readonly hit: number };
  readonly hitWhenEquals: { readonly scored: number; readonly hit: number };
}

const blockOf = (r: { date: string }): string => weekBlock(r.date);

function inSubset(r: VariantRow, subset: Subset): boolean {
  return r.direction !== "FLAT" && (subset === "directional" || r.fires);
}

export function summariseVariant(id: VariantLabel, rows: readonly VariantRow[], subset: Subset, seed: number): VariantSummary {
  const sub = rows.filter((r) => inSubset(r, subset));
  const scored = sub.filter((r) => r.hit !== null && r.baselineHit !== null);
  const upliftStat = (s: readonly VariantRow[]): number => {
    const sc = s.filter((r) => r.hit !== null && r.baselineHit !== null);
    if (sc.length === 0) return Number.NaN;
    return (sc.filter((r) => r.hit === true).length - sc.filter((r) => r.baselineHit === true).length) / sc.length;
  };
  const netRows = sub.filter((r) => r.net !== null);
  const netStat = (s: readonly VariantRow[]): number => {
    const sc = s.filter((r) => r.net !== null);
    return sc.length === 0 ? Number.NaN : sc.reduce((a, r) => a + (r.net as number), 0) / sc.length;
  };
  const u = blockBootstrap(scored, blockOf, upliftStat, BOOTSTRAP_ITERATIONS, seed);
  const n = blockBootstrap(netRows, blockOf, netStat, BOOTSTRAP_ITERATIONS, seed + 1);
  const rate = (s: readonly VariantRow[]): { scored: number; hit: number } => {
    const sc = s.filter((r) => r.hit !== null);
    return { scored: sc.length, hit: sc.length === 0 ? 0 : sc.filter((r) => r.hit === true).length / sc.length };
  };
  return {
    id,
    subset,
    days: sub.length,
    scored: scored.length,
    hit: scored.length === 0 ? 0 : scored.filter((r) => r.hit === true).length / scored.length,
    baselineHit: scored.length === 0 ? 0 : scored.filter((r) => r.baselineHit === true).length / scored.length,
    uplift: Number.isFinite(u.estimate) ? u.estimate : 0,
    upliftCi: u.ci95,
    netMean: Number.isFinite(n.estimate) ? n.estimate : 0,
    netCi: n.ci95,
    meanN: sub.length === 0 ? 0 : sub.reduce((a, r) => a + r.n, 0) / sub.length,
    equalsWeeklyTrend: sub.length === 0 ? 0 : sub.filter((r) => r.direction === r.weeklyTrendSign).length / sub.length,
    hitWhenDiffers: rate(sub.filter((r) => r.direction !== r.weeklyTrendSign)),
    hitWhenEquals: rate(sub.filter((r) => r.direction === r.weeklyTrendSign)),
  };
}

export interface Comparison {
  readonly variant: VariantId;
  readonly control: VariantLabel;
  readonly subset: Subset;
  readonly matchedScored: number;
  readonly variantHit: number;
  readonly controlHit: number;
  readonly diff: number;
  readonly ci95: Interval;
  readonly p: number;
  qValue: number;
  significant: boolean;
}

interface Pair {
  readonly date: string;
  readonly a: boolean;
  readonly b: boolean;
}

/** Paired difference in hit rate (variant minus control) on days where BOTH call and the outcome is scoreable. */
export function compareVariants(
  variant: VariantId,
  control: VariantLabel,
  v: readonly VariantRow[],
  c: readonly VariantRow[],
  subset: Subset,
  seed: number,
): Comparison {
  const byKey = new Map<string, VariantRow>();
  for (const r of c) if (inSubset(r, subset) && r.hit !== null) byKey.set(`${r.pair}|${r.date}`, r);
  const pairs: Pair[] = [];
  for (const r of v) {
    if (!inSubset(r, subset) || r.hit === null) continue;
    const other = byKey.get(`${r.pair}|${r.date}`);
    if (other === undefined) continue;
    pairs.push({ date: r.date, a: r.hit, b: other.hit === true });
  }
  const stat = (s: readonly Pair[]): number =>
    s.length === 0 ? Number.NaN : (s.filter((p) => p.a).length - s.filter((p) => p.b).length) / s.length;
  const boot = blockBootstrap(pairs, blockOf, stat, BOOTSTRAP_ITERATIONS, seed);
  return {
    variant,
    control,
    subset,
    matchedScored: pairs.length,
    variantHit: pairs.length === 0 ? 0 : pairs.filter((p) => p.a).length / pairs.length,
    controlHit: pairs.length === 0 ? 0 : pairs.filter((p) => p.b).length / pairs.length,
    diff: Number.isFinite(boot.estimate) ? boot.estimate : 0,
    ci95: boot.ci95,
    p: boot.p,
    qValue: 1,
    significant: false,
  };
}

export interface VariantStudy {
  readonly summaries: readonly VariantSummary[];
  readonly comparisons: readonly Comparison[];
  readonly promising: readonly VariantId[];
}

/** The four pre-registered comparisons. */
export const COMPARISONS: readonly { readonly variant: VariantId; readonly control: VariantId }[] = [
  { variant: "V1", control: "V0b" },
  { variant: "V2", control: "V0b" },
  { variant: "V3", control: "V1" },
  { variant: "V4", control: "V0b" },
];

/** Run the summaries and comparisons. `rowsById` must contain V0b, V1..V4 and optionally V0. */
export function studyVariants(rowsById: Readonly<Partial<Record<VariantLabel, readonly VariantRow[]>>>): VariantStudy {
  const summaries: VariantSummary[] = [];
  let seed = BOOTSTRAP_SEED + 30000;
  for (const id of ["V0", "V0b", "V1", "V2", "V3", "V4"] as const) {
    const rows = rowsById[id];
    if (rows === undefined) continue;
    for (const subset of ["directional", "firing"] as const) {
      seed += 7;
      summaries.push(summariseVariant(id, rows, subset, seed));
    }
  }

  const comparisons: Comparison[] = [];
  for (const subset of ["directional", "firing"] as const) {
    const group: Comparison[] = [];
    for (const cmp of COMPARISONS) {
      const v = rowsById[cmp.variant];
      const c = rowsById[cmp.control];
      if (v === undefined || c === undefined) continue;
      seed += 7;
      group.push(compareVariants(cmp.variant, cmp.control, v, c, subset, seed));
    }
    const fdr = benjaminiHochberg(group.map((g) => g.p), FDR_Q);
    group.forEach((g, i) => {
      g.qValue = fdr.adjusted[i] as number;
      g.significant = fdr.rejected[i] === true && g.matchedScored >= MIN_REPORTABLE_SCORED;
    });
    comparisons.push(...group);
  }

  const promising: VariantId[] = [];
  for (const cmp of comparisons) {
    if (cmp.subset !== "directional") continue;
    const s = summaries.find((x) => x.id === cmp.variant && x.subset === "directional");
    if (s !== undefined && cmp.significant && cmp.diff > 0 && s.uplift > 0 && s.netCi.lo > 0) promising.push(cmp.variant);
  }
  return { summaries, comparisons, promising };
}
