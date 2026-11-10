// Pure scoring helpers over {@link DayRecord}s (offline measurement; no I/O).
//
// Everything is scored against the SIGN of the realised session's open-to-close move, which is
// the convention the live track records already use. Days whose realised sign is FLAT or
// unavailable are excluded from the denominator and counted separately.
import {
  effectiveSampleSize,
  matchedDeltaInterval,
  summarizeRate,
  type Interval,
  type RateSummary,
} from "../../performance/evidenceStats.js";
import { realizedFor, type DayRecord, type TargetSession } from "./dayRecords.js";

export type SubsetName = "directional" | "firing";

export interface AccuracyReport {
  readonly subset: SubsetName;
  readonly session: TargetSession;
  /** Days in the subset (model has a directional view, and the firing rule when "firing"). */
  readonly days: number;
  /** Days scored (realised sign UP or DOWN). */
  readonly scored: number;
  readonly model: RateSummary;
  readonly baseline: RateSummary;
  /** model - baseline accuracy as a fraction (0.01 == 1pp). */
  readonly delta: number;
  /** Conservative interval on the delta using the raw scored n. */
  readonly deltaCiRaw: Interval;
  /** Same interval with n discounted for overlap / cross-pair correlation. */
  readonly deltaCiDiscounted: Interval;
  readonly discountFactor: number;
  readonly byDirection: Readonly<Record<"UP" | "DOWN", RateSummary>>;
}

/** Records belonging to a subset. */
export function subsetOf(records: readonly DayRecord[], subset: SubsetName): readonly DayRecord[] {
  return records.filter((r) => r.direction !== "FLAT" && (subset === "directional" || r.fires));
}

/** Score the model and the weekly-trend baseline on the SAME matched days. */
export function scoreAccuracy(
  records: readonly DayRecord[],
  subset: SubsetName,
  session: TargetSession,
  discountFactor = 5,
): AccuracyReport {
  const days = subsetOf(records, subset);
  let scored = 0;
  let modelHits = 0;
  let baselineHits = 0;
  const dirHits = { UP: 0, DOWN: 0 };
  const dirN = { UP: 0, DOWN: 0 };
  for (const r of days) {
    const real = realizedFor(r, session);
    if (real === null || real.sign === "FLAT") continue;
    scored += 1;
    const modelRight = r.direction === real.sign;
    if (modelRight) modelHits += 1;
    if (r.weeklyTrendSign === real.sign) baselineHits += 1;
    if (r.direction === "UP" || r.direction === "DOWN") {
      dirN[r.direction] += 1;
      if (modelRight) dirHits[r.direction] += 1;
    }
  }
  const model = summarizeRate(modelHits, scored);
  const baseline = summarizeRate(baselineHits, scored);
  const delta = model.rate - baseline.rate;
  return {
    subset,
    session,
    days: days.length,
    scored,
    model,
    baseline,
    delta,
    deltaCiRaw: matchedDeltaInterval(delta, scored),
    deltaCiDiscounted: matchedDeltaInterval(delta, effectiveSampleSize(scored, discountFactor)),
    discountFactor,
    byDirection: {
      UP: summarizeRate(dirHits.UP, dirN.UP),
      DOWN: summarizeRate(dirHits.DOWN, dirN.DOWN),
    },
  };
}

/** Shares of the realised sign over a record set (a sanity check on the target itself). */
export function realizedBalance(
  records: readonly DayRecord[],
  session: TargetSession,
): { readonly UP: number; readonly DOWN: number; readonly FLAT: number; readonly n: number } {
  const c = { UP: 0, DOWN: 0, FLAT: 0 };
  let n = 0;
  for (const r of records) {
    const real = realizedFor(r, session);
    if (real === null) continue;
    c[real.sign] += 1;
    n += 1;
  }
  return n === 0 ? { UP: 0, DOWN: 0, FLAT: 0, n } : { UP: c.UP / n, DOWN: c.DOWN / n, FLAT: c.FLAT / n, n };
}
