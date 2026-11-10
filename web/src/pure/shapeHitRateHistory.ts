/**
 * Pure shaper for the read-only "record of fired setups" history.
 *
 * Reads the snapshot's `realizedOutcomes` journal (predicted vs. realized direction, filled
 * only once the horizon has matured) and reports how often the predicted direction was right:
 * overall, per pair, and per Earned_Confidence band (0.05 wide, matching the backend
 * calibration bands), plus a newest-first ledger.
 *
 * Rules:
 *   - Only MATURED rows with a non-FLAT prediction and a realized direction are decided.
 *     Unmatured rows are counted as `pending`, never as wins or losses.
 *   - "Right" means the realized direction equals the predicted one. A realized FLAT counts as
 *     not right, the same way the confidence figure treats FLAT.
 *   - Duplicate (pair, decision_date) rows are collapsed to one.
 *   - Every figure carries its sample size `n`; a bucket under {@link MIN_RELIABLE_N} is
 *     flagged `smallSample`.
 *
 * This is a historical hit rate, NOT a probability or a forecast. Pure: no fetch, DOM, or
 * clock; it recomputes nothing the backend decided and never mutates its input.
 */
import type { Direction, RealizedOutcomeRow } from "../api/types";

/** Below this many decided setups a rate is flagged as a small sample. */
export const MIN_RELIABLE_N = 30;

/** Most recent decided setups shown in the ledger. */
export const LEDGER_LIMIT = 20;

/** Earned_Confidence band width (matches `src/performance/calibration.ts`). */
export const BAND_WIDTH = 0.05;

export const HISTORY_LABEL = "Historical record of fired setups. Not a probability.";

export interface HitRateBucket {
  readonly label: string;
  /** Decided setups. */
  readonly n: number;
  readonly correct: number;
  /** "55.0%" or "–" when `n` is 0. */
  readonly rateText: string;
  readonly smallSample: boolean;
}

export interface LedgerEntry {
  readonly decisionDate: string;
  readonly pair: string;
  readonly predicted: Direction;
  readonly realized: Direction;
  readonly right: boolean;
}

export interface HitRateHistoryVM {
  /** False when there are no decided setups at all. */
  readonly available: boolean;
  readonly label: string;
  readonly overall: HitRateBucket;
  readonly byPair: readonly HitRateBucket[];
  readonly byBand: readonly HitRateBucket[];
  /** Newest first, at most {@link LEDGER_LIMIT}. */
  readonly recent: readonly LedgerEntry[];
  /** Fired setups whose horizon has not matured yet. */
  readonly pending: number;
  /** Caution when the overall sample is small, else null. */
  readonly caution: string | null;
}

interface Decided {
  readonly pair: string;
  readonly decisionDate: string;
  readonly confidence: number;
  readonly predicted: Direction;
  readonly realized: Direction;
  readonly right: boolean;
}

function bucket(label: string, rows: readonly Decided[]): HitRateBucket {
  const n = rows.length;
  const correct = rows.filter((r) => r.right).length;
  return {
    label,
    n,
    correct,
    rateText: n === 0 ? "–" : `${((correct / n) * 100).toFixed(1)}%`,
    smallSample: n < MIN_RELIABLE_N,
  };
}

function bandIndex(confidence: number): number {
  // The epsilon keeps values such as 0.55 (stored as 0.5499999…) in their intended band.
  return Math.floor(confidence / BAND_WIDTH + 1e-9);
}

function bandLabel(index: number): string {
  const lo = Math.round(index * BAND_WIDTH * 100);
  const hi = Math.round((index + 1) * BAND_WIDTH * 100);
  return `${lo}–${hi}%`;
}

export function shapeHitRateHistory(rows: readonly RealizedOutcomeRow[]): HitRateHistoryVM {
  const seen = new Set<string>();
  const decided: Decided[] = [];
  let pending = 0;

  for (const r of rows) {
    if (r.predicted_direction === "FLAT") continue;
    const key = `${r.pair}|${r.decision_date}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!r.matured || r.realized_direction === null) {
      pending += 1;
      continue;
    }
    decided.push({
      pair: r.pair,
      decisionDate: r.decision_date,
      confidence: r.earned_confidence,
      predicted: r.predicted_direction,
      realized: r.realized_direction,
      right: r.realized_direction === r.predicted_direction,
    });
  }

  const overall = bucket("All setups", decided);

  const pairs = [...new Set(decided.map((d) => d.pair))].sort();
  const byPair = pairs.map((p) =>
    bucket(
      p,
      decided.filter((d) => d.pair === p),
    ),
  );

  const bandIdx = [...new Set(decided.map((d) => bandIndex(d.confidence)))].sort((a, b) => a - b);
  const byBand = bandIdx.map((i) =>
    bucket(
      bandLabel(i),
      decided.filter((d) => bandIndex(d.confidence) === i),
    ),
  );

  const recent = [...decided]
    .sort((a, b) => b.decisionDate.localeCompare(a.decisionDate) || a.pair.localeCompare(b.pair))
    .slice(0, LEDGER_LIMIT)
    .map((d) => ({
      decisionDate: d.decisionDate,
      pair: d.pair,
      predicted: d.predicted,
      realized: d.realized,
      right: d.right,
    }));

  return {
    available: decided.length > 0,
    label: HISTORY_LABEL,
    overall,
    byPair,
    byBand,
    recent,
    pending,
    caution:
      decided.length > 0 && decided.length < MIN_RELIABLE_N
        ? `Only ${decided.length} decided setups so far; treat these rates as noise until there are at least ${MIN_RELIABLE_N}.`
        : null,
  };
}
