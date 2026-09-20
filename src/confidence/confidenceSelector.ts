// Confidence & Horizon Selector — Component 5 (Requirement 10).
//
// Implements Tasks 5.1 and 5.2 as one cohesive deterministic-core module:
//   - earnedConfidence(): fixed-prior shrinkage of the neighborhood resolution
//     rate toward the neutral prior 0.5. (Req 10.1, 10.2, 10.3, 10.7)
//   - classify(): ATR_14-scaled FLAT dead-band direction classification.
//     (Req 1.4, 10.4, 10.5)
//   - selectHorizon(): horizon with the strongest historical resolution.
//     (Req 10.6)
//
// Pure functions, no hidden mutable state, NO LLM input (Requirement 2.1).

import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import {
  type Confidence,
  type ConfidenceSelector,
  type Horizon,
  FIXED_PRIOR_WEIGHT,
  FLAT_DEAD_BAND_FACTOR,
  NEUTRAL_PRIOR,
} from "./types.js";

const HORIZONS: readonly Horizon[] = [1, 2, 3] as const;

/** Clamp a raw number into [0,1] and brand it as a Confidence. */
function toConfidence(value: number): Confidence {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return clamped as Confidence;
}

/**
 * Raw historical resolution rate `C_raw` of a neighborhood at a horizon.
 *
 * A neighborhood "resolves" toward its dominant directional outcome. The raw
 * resolution rate is the fraction of the horizon's analogues whose
 * Direction_Class equals the most frequent directional outcome (UP or DOWN)
 * observed at that horizon. FLAT outcomes count against resolution (they are
 * non-directional), so a neighborhood that mostly goes FLAT has a low C_raw.
 *
 * Returns `NEUTRAL_PRIOR` (0.5) when the horizon has no analogues, so that an
 * empty neighborhood yields exactly the neutral prior after shrinkage.
 */
export function rawResolutionRate(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): number {
  const atHorizon = neighborhood.filter((a) => a.horizon === horizon);
  const n = atHorizon.length;
  if (n === 0) return NEUTRAL_PRIOR;

  let up = 0;
  let down = 0;
  for (const a of atHorizon) {
    if (a.direction === "UP") up++;
    else if (a.direction === "DOWN") down++;
  }

  const dominant = Math.max(up, down);
  // If there are no directional outcomes at all (all FLAT), C_raw is 0:
  // the neighborhood never resolves in a direction.
  return dominant / n;
}

/**
 * The number of analogues at a given horizon (the sample size `n`).
 */
export function analogueCount(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): number {
  return neighborhood.reduce((acc, a) => (a.horizon === horizon ? acc + 1 : acc), 0);
}

/**
 * Earned_Confidence at a horizon via fixed-prior shrinkage.
 *
 * C_shrunk = (n / (n + k)) * C_raw + (k / (n + k)) * 0.5, with k = 10.
 *
 * - `n` is the analogue count at the horizon.
 * - `C_raw` is the raw historical resolution rate at the horizon.
 * - The result is constrained to [0,1] (Requirement 10.2) and branded.
 *
 * Because `k` is fixed, a sub-30-analogue neighborhood is pulled hard toward
 * 0.5 and cannot cross the Confidence_Threshold on sample size alone
 * (Requirement 10.3) — no special-case override is needed; the math enforces
 * it. See SAMPLE_SIZE_FLOOR in ./types for the exposed floor semantics.
 *
 * (Requirements 10.1, 10.2, 10.3, 10.7)
 */
export function earnedConfidence(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): Confidence {
  const n = analogueCount(neighborhood, horizon);
  const cRaw = rawResolutionRate(neighborhood, horizon);
  const k = FIXED_PRIOR_WEIGHT;

  const cShrunk =
    (n / (n + k)) * cRaw + (k / (n + k)) * NEUTRAL_PRIOR;

  return toConfidence(cShrunk);
}

/**
 * Classify a net forward move as exactly one Direction_Class using the
 * ATR_14-scaled FLAT dead-band.
 *
 * The FLAT_Dead_Band half-width is `|atr14| * FLAT_DEAD_BAND_FACTOR`
 * (Requirement 10.4) — it scales linearly with ATR_14 and is never a fixed pip
 * constant. A move classifies FLAT if and only if its magnitude lies within the
 * band; otherwise it is UP or DOWN by the sign of the move (Requirements 1.4,
 * 10.5). Classification is total: exactly one class is always returned.
 *
 * Unit contract: `netMovePips` and `atr14` MUST be expressed in the same unit
 * (both in pips, or both in price). `atr14` is treated by magnitude so a
 * defensively-signed value still scales the band correctly.
 */
export function classify(netMovePips: number, atr14: number): DirectionClass {
  const band = Math.abs(atr14) * FLAT_DEAD_BAND_FACTOR;
  const magnitude = Math.abs(netMovePips);

  // FLAT iff within the band (inclusive boundary). (Req 10.5)
  if (magnitude <= band) return "FLAT";
  return netMovePips >= 0 ? "UP" : "DOWN";
}

/**
 * Select the horizon (1, 2, or 3) with the strongest historical resolution
 * rate for the matched neighborhood. (Requirement 10.6)
 *
 * Ties are broken deterministically toward the shorter horizon so identical
 * inputs always produce identical outputs (Requirement 3.1). The returned
 * horizon's resolution rate is guaranteed >= that of every other horizon.
 */
export function selectHorizon(neighborhood: readonly AnalogueRecord[]): Horizon {
  let best: Horizon = 1;
  let bestRate = rawResolutionRate(neighborhood, 1);

  for (const h of HORIZONS) {
    const rate = rawResolutionRate(neighborhood, h);
    if (rate > bestRate) {
      bestRate = rate;
      best = h;
    }
  }

  return best;
}

/**
 * Concrete ConfidenceSelector binding the pure functions above.
 */
export const confidenceSelector: ConfidenceSelector = {
  earnedConfidence,
  classify,
  selectHorizon,
};
