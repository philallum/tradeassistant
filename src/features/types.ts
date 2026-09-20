// Candidate Feature Computation Types (Requirements 13.5, 13.6, 13.8, 4.1).
//
// Pure, self-contained typed definitions for the candidate features that the
// Feature Registry (Component 8) evaluates one at a time through the Kill_Gate.
//
// The canonical FeatureId vocabulary lives in the feature-registry module
// (single source of truth); this module supplies only the value types produced
// by the compute functions.

import type { CountryCode } from "../yields/types.js";

/**
 * The three qualitative regimes used to express a volume proxy as a *regime*
 * (relative classification) rather than a raw magnitude. (Requirement 13.5)
 */
export type VolumeRegime = "LOW" | "NORMAL" | "HIGH";

/**
 * Weekly-trend context: the direction of the medium-term trend, expressed as a
 * bounded, scale-invariant regime. (Requirement 13.5)
 */
export type WeeklyTrendContext = "UP" | "DOWN";

/**
 * A single yield observation used by the pure yield-spread computation.
 * Mirrors the persisted `yields` row but is self-contained so the feature
 * function needs no storage dependency.
 */
export interface YieldObservation {
  readonly country: CountryCode;
  readonly date: string;
  readonly yield10y: number;
}

/**
 * Structural reference levels considered by Structural_Liquidity_SR: the nearest
 * of Previous Day High/Low, Previous Week High/Low, and 20-Day High/Low.
 * (Requirement 13.6)
 */
export interface StructuralLevels {
  readonly prevDayHigh: number;
  readonly prevDayLow: number;
  readonly prevWeekHigh: number;
  readonly prevWeekLow: number;
  readonly high20d: number;
  readonly low20d: number;
}
