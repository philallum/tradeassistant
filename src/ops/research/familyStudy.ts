// Part A of docs/research/PRE-REGISTRATION-2.md: setup-family study (pure; no I/O).
//
// A setup is a day on which one rule strategy (trend, breakout, range, reversal) gives UP or DOWN,
// or (family "pattern") the analogue pattern gives a directional call. Hit = the setup direction
// equals the sign of the session after the decision date. Four oriented features per family are
// tested against hit with a week-block bootstrap; all 20 tests share one Benjamini-Hochberg family.
import type { Interval } from "../../performance/evidenceStats.js";
import { orient, type OrientedFeatures } from "./chartFeatures.js";
import type { ResearchRow } from "./researchDataset.js";
import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
} from "./researchProtocol.js";
import { benjaminiHochberg, blockBootstrap, blockBootstrapSpearman, weekBlock } from "./researchStats.js";

export const FAMILIES = ["trend", "breakout", "range", "reversal", "pattern"] as const;
export type Family = (typeof FAMILIES)[number];

export type FeatureName = Exclude<keyof OrientedFeatures, never>;

/** The four pre-registered features per family. */
export const FAMILY_FEATURES: Readonly<Record<Family, readonly FeatureName[]>> = {
  trend: ["trendDir", "swingDir", "rangePosDir", "distDir"],
  breakout: ["compression", "excursionDir", "bodyDir", "closePosDir"],
  range: ["rangePosDir", "distDir", "wickRejection", "compression"],
  reversal: ["distDir", "wickRejection", "swingDir", "bodyDir"],
  pattern: ["swingDir", "rangePosDir", "distDir", "bodyDir"],
};

export interface Setup {
  readonly date: string;
  readonly pair: string;
  readonly side: "UP" | "DOWN";
  readonly hit: boolean | null;
  readonly net: number | null;
  readonly features: OrientedFeatures;
  /** Relation to the pattern call (strategy families only). */
  readonly patternRelation: "agree" | "oppose" | "none";
}

/** Extract the setups of one family from the research rows. */
export function extractSetups(rows: readonly ResearchRow[], family: Family): Setup[] {
  const out: Setup[] = [];
  for (const r of rows) {
    if (r.features === null) continue;
    const side = family === "pattern" ? r.direction : r.strategies[family];
    if (side !== "UP" && side !== "DOWN") continue;
    const sign = r.realizedSign;
    const hit = sign === "UP" || sign === "DOWN" ? sign === side : null;
    const net = r.realizedPips === null ? null : (side === "UP" ? r.realizedPips : -r.realizedPips) - r.costPips;
    out.push({
      date: r.date,
      pair: r.pair,
      side,
      hit,
      net,
      features: orient(r.features, side),
      patternRelation: r.direction === "UP" || r.direction === "DOWN" ? (r.direction === side ? "agree" : "oppose") : "none",
    });
  }
  return out;
}

export interface TercileCell {
  readonly label: string;
  readonly scored: number;
  readonly hit: number;
  readonly netMean: number;
}

export interface FeatureResult {
  readonly family: Family;
  readonly feature: FeatureName;
  readonly n: number;
  readonly rho: number;
  readonly ci95: Interval;
  readonly p: number;
  qValue: number;
  significant: boolean;
  readonly terciles: readonly TercileCell[];
}

export interface FamilySummary {
  readonly family: Family;
  readonly setups: number;
  readonly scored: number;
  readonly hit: number;
  readonly hitCi95: Interval;
  readonly hitP: number;
  readonly netMean: number;
  readonly netCi95: Interval;
  readonly relation: readonly { readonly label: string; readonly scored: number; readonly hit: number; readonly netMean: number }[];
  readonly features: readonly FeatureResult[];
}

const blockOf = (s: Setup): string => weekBlock(s.date);

function tercileCells(items: readonly Setup[], get: (s: Setup) => number | null): TercileCell[] {
  const withValue = items.filter((s) => get(s) !== null);
  if (withValue.length < 30) return [];
  const sorted = withValue.map((s) => get(s) as number).sort((a, b) => a - b);
  const e1 = sorted[Math.floor(sorted.length / 3)] as number;
  const e2 = sorted[Math.floor((2 * sorted.length) / 3)] as number;
  const groups: [string, (v: number) => boolean][] = [
    [`low (<${e1.toFixed(3)})`, (v) => v < e1],
    [`mid (${e1.toFixed(3)} to ${e2.toFixed(3)})`, (v) => v >= e1 && v < e2],
    [`high (>=${e2.toFixed(3)})`, (v) => v >= e2],
  ];
  return groups.map(([label, test]) => {
    const g = withValue.filter((s) => test(get(s) as number));
    const scored = g.filter((s) => s.hit !== null);
    const nets = g.filter((s) => s.net !== null);
    return {
      label,
      scored: scored.length,
      hit: scored.length === 0 ? 0 : scored.filter((s) => s.hit === true).length / scored.length,
      netMean: nets.length === 0 ? 0 : nets.reduce((a, s) => a + (s.net as number), 0) / nets.length,
    };
  });
}

/** Study every family. Setups are extracted from the rows; one BH family of 20 feature tests. */
export function studyFamilies(rows: readonly ResearchRow[]): FamilySummary[] {
  const all: FeatureResult[] = [];
  const base: Omit<FamilySummary, "features">[] = [];
  const perFamilyFeatures = new Map<Family, FeatureResult[]>();
  let seed = BOOTSTRAP_SEED + 20000;

  for (const family of FAMILIES) {
    const setups = extractSetups(rows, family);
    const scoredSetups = setups.filter((s) => s.hit !== null);
    const hitStat = (sample: readonly Setup[]): number => {
      const sc = sample.filter((s) => s.hit !== null);
      return sc.length === 0 ? Number.NaN : sc.filter((s) => s.hit === true).length / sc.length - 0.5;
    };
    const netStat = (sample: readonly Setup[]): number => {
      const sc = sample.filter((s) => s.net !== null);
      return sc.length === 0 ? Number.NaN : sc.reduce((a, s) => a + (s.net as number), 0) / sc.length;
    };
    seed += 11;
    const h = blockBootstrap(scoredSetups, blockOf, hitStat, BOOTSTRAP_ITERATIONS, seed);
    seed += 11;
    const n = blockBootstrap(setups.filter((s) => s.net !== null), blockOf, netStat, BOOTSTRAP_ITERATIONS, seed);

    const relation = (["agree", "oppose", "none"] as const).map((label) => {
      const g = setups.filter((s) => s.patternRelation === label);
      const sc = g.filter((s) => s.hit !== null);
      const nets = g.filter((s) => s.net !== null);
      return {
        label,
        scored: sc.length,
        hit: sc.length === 0 ? 0 : sc.filter((s) => s.hit === true).length / sc.length,
        netMean: nets.length === 0 ? 0 : nets.reduce((a, s) => a + (s.net as number), 0) / nets.length,
      };
    });

    const feats: FeatureResult[] = [];
    for (const feature of FAMILY_FEATURES[family]) {
      const get = (s: Setup): number | null => s.features[feature];
      const xs: number[] = [];
      const ys: number[] = [];
      const blocks: string[] = [];
      for (const s of scoredSetups) {
        const v = get(s);
        if (v === null) continue;
        xs.push(v);
        ys.push(s.hit === true ? 1 : 0);
        blocks.push(weekBlock(s.date));
      }
      seed += 11;
      const c =
        xs.length >= 30
          ? blockBootstrapSpearman(xs, ys, blocks, BOOTSTRAP_ITERATIONS, seed)
          : { n: xs.length, estimate: 0, ci95: { lo: 0, hi: 0 }, p: 1 };
      const result: FeatureResult = {
        family,
        feature,
        n: c.n,
        rho: c.estimate,
        ci95: c.ci95,
        p: c.p,
        qValue: 1,
        significant: false,
        terciles: tercileCells(setups, get),
      };
      feats.push(result);
      all.push(result);
    }
    perFamilyFeatures.set(family, feats);
    base.push({
      family,
      setups: setups.length,
      scored: scoredSetups.length,
      hit: scoredSetups.length === 0 ? 0 : scoredSetups.filter((s) => s.hit === true).length / scoredSetups.length,
      hitCi95: { lo: h.ci95.lo + 0.5, hi: h.ci95.hi + 0.5 },
      hitP: h.p,
      netMean: Number.isFinite(n.estimate) ? n.estimate : 0,
      netCi95: n.ci95,
      relation,
    });
  }

  const fdr = benjaminiHochberg(all.map((f) => f.p), FDR_Q);
  all.forEach((f, i) => {
    f.qValue = fdr.adjusted[i] as number;
    f.significant = fdr.rejected[i] === true && f.n >= MIN_REPORTABLE_SCORED;
  });

  return base.map((b) => ({ ...b, features: perFamilyFeatures.get(b.family) as FeatureResult[] }));
}
