// Parameter_Set + Frozen_Baseline capture — trader-edge-validation Stage D
// (task 8; design R11). "Freeze before you measure": the CURRENT live tunable
// choices are captured verbatim into a version-stamped Frozen_Baseline so a
// walk-forward / comparator result is provably independent of any later tuning
// (R7.2, R11.1, R11.2).
//
// Capture is strictly READ-ONLY wrt the live decision path (R11.3): it reads the
// exported `DEFAULT_*` constants from the deterministic core and copies their
// values; it mutates nothing and feeds nothing back into firing / scoring /
// confidence. Pure, deterministic, LLM-free.

import {
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_WINDOW_SIZE,
} from "../pipeline/types.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../dashboard/types.js";
import { FIXED_PRIOR_WEIGHT, SAMPLE_SIZE_FLOOR } from "../confidence/types.js";
import {
  DEFAULT_STOP_LOSS_PERCENTILE,
  DEFAULT_TAKE_PROFIT_PERCENTILE,
} from "../risk-boundaries/types.js";

/**
 * The multi-scale pattern slices the encoder uses (10/20/40 trading days). These
 * are structural constants baked into `src/encoder/patternEncoder.ts` (not a
 * config value); they are recorded here so a Frozen_Baseline is a COMPLETE,
 * self-describing record of every fittable choice (R7.3).
 */
export const PATTERN_SCALES: readonly number[] = [10, 20, 40] as const;

/**
 * How the horizon is chosen. The live pipeline selects the horizon with the
 * strongest historical resolution rate (`selectHorizon`), so the live baseline
 * is `"best_resolution"`. `"fixed"` is the alternative a walk-forward may freeze
 * to prove horizon selection is not inflating OOS results (R7.4).
 */
export type HorizonSelection = "best_resolution" | "fixed";

/**
 * The full set of tunable choices that define a run (R7.3). Every field is a
 * copy of a live constant (or a structural fact of the encoder); nothing here is
 * a NEW tunable parameter (R12.2) — this type only RECORDS what already exists so
 * a result can be tied to the exact assumptions that produced it.
 */
export interface ParameterSet {
  /** Encoder multi-scale slices in trading days (structural: [10,20,40]). */
  readonly patternScales: readonly number[];
  /** Retrieval Similarity_Radius cutoff (`DEFAULT_RETRIEVAL_CONFIG.epsilon`). */
  readonly similarityEpsilon: number;
  /** Retrieval neighborhood size `k` (`DEFAULT_RETRIEVAL_CONFIG.k`). */
  readonly retrievalK: number;
  /** Trailing candle window fed to the encoder / ATR_14 (`windowSize`). */
  readonly windowSize: number;
  /** The 30-analogue actionability / sample-size floor. */
  readonly analogueFloor: number;
  /**
   * Whether a Weekly_Trend_Sign filter is applied. The live pipeline applies no
   * such filter (the baseline comparator uses the trend; the system does not
   * gate on it), so the captured value is `false`.
   */
  readonly weeklyTrendFilter: boolean;
  /** Fixed-prior shrinkage weight `k` (= 10). */
  readonly shrinkageWeight: number;
  /** Confidence_Threshold a pair must clear to fire (= 0.55). */
  readonly confidenceThreshold: number;
  /** The horizon-selection rule — a fittable choice frozen into the set (R7.4). */
  readonly horizonSelection: HorizonSelection;
  /** Percentile of neighborhood MAE used for Stop_Loss (= 75). */
  readonly stopLossPercentile: number;
  /** Percentile of neighborhood MFE used for Take_Profit (= 50). */
  readonly takeProfitPercentile: number;
}

/**
 * A version-stamped capture of a Parameter_Set at a point in time (R11.1). The
 * `id` is the version stamp a result records so it is traceable to the exact
 * frozen assumptions; `capturedAt` is the ISO timestamp of capture.
 */
export interface FrozenBaseline {
  readonly id: string;
  readonly capturedAt: string;
  readonly params: ParameterSet;
}

/** The version stamp for the parameter set captured from the current live core. */
export const LIVE_PARAMETER_SET_VERSION = "params-v1" as const;

/**
 * Capture the CURRENT live Parameter_Set verbatim (R11.1, R11.2). Reads only the
 * exported `DEFAULT_*` constants and copies their values into a plain
 * `ParameterSet`; it changes NO live constant and touches no decision path
 * (R11.3). Deterministic given its inputs; the only non-determinism is the
 * injectable clock for `capturedAt`.
 *
 * @param options.id    Version stamp for the baseline (default
 *                      `params-v1`); callers capturing a tuned variant pass a
 *                      distinct id so results stay traceable (R11.1).
 * @param options.now   Injectable clock for `capturedAt` (default `Date.now`),
 *                      so tests are deterministic and no wall-clock leaks in.
 */
export function captureFrozenBaseline(options?: {
  readonly id?: string;
  readonly now?: () => Date;
}): FrozenBaseline {
  const id = options?.id ?? LIVE_PARAMETER_SET_VERSION;
  const now = options?.now ?? (() => new Date());

  return {
    id,
    capturedAt: now().toISOString(),
    params: captureLiveParameterSet(),
  };
}

/**
 * Read the live tunable constants into a {@link ParameterSet}. Separated from
 * {@link captureFrozenBaseline} so the capture can be asserted field-for-field
 * against the live defaults WITHOUT the version-stamp / clock wrapper (task 8.1).
 */
export function captureLiveParameterSet(): ParameterSet {
  return {
    patternScales: [...PATTERN_SCALES],
    similarityEpsilon: DEFAULT_PIPELINE_CONFIG.retrieval.epsilon,
    retrievalK: DEFAULT_PIPELINE_CONFIG.retrieval.k,
    windowSize: DEFAULT_PIPELINE_WINDOW_SIZE,
    analogueFloor: SAMPLE_SIZE_FLOOR,
    weeklyTrendFilter: false,
    shrinkageWeight: FIXED_PRIOR_WEIGHT,
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    horizonSelection: "best_resolution",
    stopLossPercentile: DEFAULT_STOP_LOSS_PERCENTILE,
    takeProfitPercentile: DEFAULT_TAKE_PROFIT_PERCENTILE,
  };
}
