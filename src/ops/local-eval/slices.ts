// Pre-registered slice analysis (offline measurement).
//
// Slices ONLY the dimensions registered in `walk-forward/evidenceProtocol.ts`. Each cell reports
// the model against the weekly-trend baseline on the SAME days, with Wilson intervals, an
// overlap-discounted interval on the difference, and net expectancy after costs.
//
// Multiple-testing discipline (no formal FDR correction by design): the number of cells examined
// is returned with every result, and a cell is only a CANDIDATE pocket. Candidates are confirmed
// by {@link confirmPockets} on the untouched confirmation holdout - a separate, explicit call
// that must not be made until the candidate list is written down.
import { DEFAULT_EXECUTION_MODEL, totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import {
  PRE_REGISTERED_SLICE_DIMENSIONS,
  type PreRegisteredSliceDimension,
} from "../../walk-forward/evidenceProtocol.js";
import { Z_95, effectiveSampleSize, matchedDeltaInterval, summarizeRate, type Interval, type RateSummary } from "../../performance/evidenceStats.js";
import { realizedFor, type DayRecord, type TargetSession } from "./dayRecords.js";
import { subsetOf, type SubsetName } from "./scoring.js";

/** Cells with fewer scored days than this are reported but can never be candidate pockets. */
export const MIN_CELL_SCORED = 100;
/** Days treated as one effective observation (overlapping windows + five correlated pairs). */
export const SLICE_DISCOUNT_FACTOR = 5;

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function bucket(value: number, edges: readonly number[], labels: readonly string[]): string {
  for (let i = 0; i < edges.length; i += 1) if (value < (edges[i] as number)) return labels[i] as string;
  return labels[labels.length - 1] as string;
}

/** The cell label a record falls into for a dimension, or null when the value is unavailable. */
export function cellLabel(r: DayRecord, dimension: PreRegisteredSliceDimension): string | null {
  switch (dimension) {
    case "pair":
      return r.pair;
    case "direction":
      return r.direction;
    case "confidenceBand": {
      const lo = Math.floor(r.confidence * 20) / 20;
      return `${lo.toFixed(2)}-${(lo + 0.05).toFixed(2)}`;
    }
    case "neighbourhoodSize":
      return bucket(r.n, [30, 60, 100, 150], ["n<30", "n30-59", "n60-99", "n100-149", "n150+"]);
    case "meanCosineDistance":
      return r.meanCosineDistance === null
        ? null
        : bucket(r.meanCosineDistance, [0.05, 0.1, 0.15], ["dist<0.05", "dist0.05-0.10", "dist0.10-0.15", "dist0.15+"]);
    case "atrPercentileBucket":
      return r.atrPercentile === null
        ? null
        : bucket(r.atrPercentile, [0.25, 0.5, 0.75], ["atr-q1(low)", "atr-q2", "atr-q3", "atr-q4(high)"]);
    case "weekday":
      return WEEKDAY_NAMES[r.weekday] ?? null;
  }
}

export interface SliceCell {
  readonly dimension: PreRegisteredSliceDimension;
  readonly label: string;
  readonly days: number;
  readonly scored: number;
  readonly model: RateSummary;
  readonly baseline: RateSummary;
  readonly delta: number;
  readonly deltaCiDiscounted: Interval;
  readonly meanNetPips: number;
  readonly netPipsCi95: Interval;
  /** Enough scored days AND a positive delta: worth writing down as a candidate, nothing more. */
  readonly candidate: boolean;
}

export interface SliceReport {
  readonly subset: SubsetName;
  readonly session: TargetSession;
  readonly cells: readonly SliceCell[];
  /** Number of cells examined - quote this next to any pocket (multiple-testing context). */
  readonly slicesTested: number;
  readonly candidates: readonly SliceCell[];
}

function evaluateCell(
  dimension: PreRegisteredSliceDimension,
  label: string,
  days: readonly DayRecord[],
  session: TargetSession,
  model: ExecutionModel,
): SliceCell {
  let scored = 0;
  let modelHits = 0;
  let baselineHits = 0;
  const net: number[] = [];
  for (const r of days) {
    const real = realizedFor(r, session);
    if (real === null) continue;
    if (r.direction !== "FLAT") {
      const gross = r.direction === "UP" ? real.pips : -real.pips;
      net.push(gross - totalCostPips(model, r.pair));
    }
    if (real.sign === "FLAT") continue;
    scored += 1;
    if (r.direction === real.sign) modelHits += 1;
    if (r.weeklyTrendSign === real.sign) baselineHits += 1;
  }
  const m = summarizeRate(modelHits, scored);
  const b = summarizeRate(baselineHits, scored);
  const delta = m.rate - b.rate;
  const mean = net.length === 0 ? 0 : net.reduce((a, x) => a + x, 0) / net.length;
  const variance = net.length < 2 ? 0 : net.reduce((a, x) => a + (x - mean) ** 2, 0) / (net.length - 1);
  const se = net.length === 0 ? 0 : Math.sqrt(variance / net.length);
  return {
    dimension,
    label,
    days: days.length,
    scored,
    model: m,
    baseline: b,
    delta,
    deltaCiDiscounted: matchedDeltaInterval(delta, effectiveSampleSize(scored, SLICE_DISCOUNT_FACTOR)),
    meanNetPips: mean,
    netPipsCi95: { lo: mean - Z_95 * se, hi: mean + Z_95 * se },
    candidate: scored >= MIN_CELL_SCORED && delta > 0,
  };
}

/** Slice the records across every pre-registered dimension. */
export function sliceRecords(
  records: readonly DayRecord[],
  subset: SubsetName,
  session: TargetSession,
  executionModel: ExecutionModel = DEFAULT_EXECUTION_MODEL,
): SliceReport {
  const base = subsetOf(records, subset);
  const cells: SliceCell[] = [];
  for (const dimension of PRE_REGISTERED_SLICE_DIMENSIONS) {
    const groups = new Map<string, DayRecord[]>();
    for (const r of base) {
      const label = cellLabel(r, dimension);
      if (label === null) continue;
      const g = groups.get(label);
      if (g === undefined) groups.set(label, [r]);
      else g.push(r);
    }
    for (const label of [...groups.keys()].sort()) {
      cells.push(evaluateCell(dimension, label, groups.get(label) as DayRecord[], session, executionModel));
    }
  }
  return {
    subset,
    session,
    cells,
    slicesTested: cells.length,
    candidates: cells.filter((c) => c.candidate),
  };
}

export interface PocketConfirmation {
  readonly dimension: PreRegisteredSliceDimension;
  readonly label: string;
  readonly discoveryDelta: number;
  readonly holdoutScored: number;
  readonly holdoutDelta: number;
  readonly holdoutModel: RateSummary;
  /** Held out-of-sample: enough scored days AND a positive delta on the holdout. */
  readonly holds: boolean;
}

/**
 * Re-evaluate candidate cells on the confirmation holdout. This CONSUMES the holdout for the
 * listed hypotheses: call it only after the candidate list has been recorded.
 */
export function confirmPockets(
  candidates: readonly SliceCell[],
  holdoutRecords: readonly DayRecord[],
  subset: SubsetName,
  session: TargetSession,
  executionModel: ExecutionModel = DEFAULT_EXECUTION_MODEL,
): readonly PocketConfirmation[] {
  const base = subsetOf(holdoutRecords, subset);
  return candidates.map((c) => {
    const days = base.filter((r) => cellLabel(r, c.dimension) === c.label);
    const cell = evaluateCell(c.dimension, c.label, days, session, executionModel);
    return {
      dimension: c.dimension,
      label: c.label,
      discoveryDelta: c.delta,
      holdoutScored: cell.scored,
      holdoutDelta: cell.delta,
      holdoutModel: cell.model,
      holds: cell.scored >= MIN_CELL_SCORED && cell.delta > 0,
    };
  });
}
