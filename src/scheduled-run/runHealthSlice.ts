// The v9 `runHealth` snapshot slice: why a pair is silent, and which pairs ran on stale data.
//
// DISPLAY-ONLY and read-only. It is derived from the evaluations the run already produced plus
// the candle-freshness stage's still-behind pairs, and it feeds nothing back into firing,
// confidence or the Kill_Gate (a guard test pins that firing output is byte-identical with and
// without it). Silence is information: each non-firing pair carries ONE named reason.
import { fires, type PairEvaluation } from "../dashboard/dashboard.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../dashboard/types.js";
import { SAMPLE_SIZE_FLOOR } from "../confidence/types.js";

/** Why a pair did not fire (null when it fired). Priority order is the declaration order. */
export type SilenceReason =
  | "DATA_BEHIND"
  | "THIN_NEIGHBOURHOOD"
  | "NO_DIRECTIONAL_VIEW"
  | "BELOW_THRESHOLD";

export interface SnapshotRunHealthRow {
  readonly pair: string;
  /** Analogue neighbourhood size n at the selected horizon; null when it was not recorded. */
  readonly analogue_count: number | null;
  /** True when the freshness stage left this pair's candles behind the target session. */
  readonly data_behind: boolean;
  /** The single reason the pair is silent, or null when it fired. */
  readonly silence_reason: SilenceReason | null;
}

export interface SnapshotRunHealthSlice {
  readonly rows: readonly SnapshotRunHealthRow[];
  /** Pairs still behind after the freshness stage (empty when healthy or unknown). */
  readonly degradedPairs: readonly string[];
  /** The firing line used to derive reasons, so the SPA can word "below X%". */
  readonly confidenceThreshold: number;
}

/** The empty/fail-safe default for the v9 slice (older snapshots, failed builds). */
export const EMPTY_RUN_HEALTH: SnapshotRunHealthSlice = {
  rows: [],
  degradedPairs: [],
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
};

/** Derive the one reason a pair is silent. Pure. */
export function silenceReason(
  evaluation: PairEvaluation,
  dataBehind: boolean,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): SilenceReason | null {
  if (fires(evaluation, confidenceThreshold) && !dataBehind) return null;
  if (dataBehind) return "DATA_BEHIND";
  if (evaluation.analogueCount !== undefined && evaluation.analogueCount < SAMPLE_SIZE_FLOOR) {
    return "THIN_NEIGHBOURHOOD";
  }
  if (evaluation.direction === "FLAT") return "NO_DIRECTIONAL_VIEW";
  return "BELOW_THRESHOLD";
}

/**
 * Build the slice from the run's evaluations and the pairs the freshness stage left behind.
 * A pair left behind by the freshness stage is WITHHELD upstream (`withheld`), so `fires` is false
 * and it is reported here as silent with reason DATA_BEHIND. (A pair that somehow fired while
 * marked behind keeps `silence_reason` null: it was not silent.)
 */
export function buildRunHealthSlice(
  evaluations: readonly PairEvaluation[],
  behindPairs: readonly string[] = [],
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): SnapshotRunHealthSlice {
  const behind = new Set(behindPairs);
  return {
    rows: evaluations.map((ev) => {
      const dataBehind = behind.has(ev.pair);
      const fired = fires(ev, confidenceThreshold);
      return {
        pair: ev.pair,
        analogue_count: ev.analogueCount ?? null,
        data_behind: dataBehind,
        silence_reason: fired ? null : silenceReason(ev, dataBehind, confidenceThreshold),
      };
    }),
    degradedPairs: [...behind].sort(),
    confidenceThreshold,
  };
}
