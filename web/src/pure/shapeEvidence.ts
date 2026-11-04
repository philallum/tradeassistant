/**
 * Pure shaper for the collapsed "historical evidence" drawer: the pair's own recent matured
 * outcomes at the pattern engine's horizon, as a plain base rate (how often it went up, how
 * often down). It is the coin-flip reference a trader should hold any reading against.
 *
 * Pure and presentation-only: no fetch, DOM, clock, or core import; simple tallies of the
 * snapshot's analogue-outcome rows. It shows no stop-loss, take-profit or expectancy figure.
 */
import type { AnalogueOutcomeRow, Horizon } from "../api/types";

export interface EvidenceVM {
  readonly pair: string;
  readonly horizon: Horizon;
  /** Matured outcomes counted for this pair at this horizon. */
  readonly sampleCount: number;
  /** Share (0..1) that went up / down; null when there are no matured outcomes. */
  readonly upShare: number | null;
  readonly downShare: number | null;
}

export interface EvidenceInput {
  readonly pair: string;
  readonly horizon: Horizon;
  readonly analogueOutcomes: readonly AnalogueOutcomeRow[];
}

export function shapeEvidence(input: EvidenceInput): EvidenceVM {
  const rows = input.analogueOutcomes.filter(
    (a) => a.asset === input.pair && a.horizon === input.horizon && a.matured,
  );
  const up = rows.filter((a) => a.direction === "UP").length;
  const down = rows.filter((a) => a.direction === "DOWN").length;
  return {
    pair: input.pair,
    horizon: input.horizon,
    sampleCount: rows.length,
    upShare: rows.length === 0 ? null : up / rows.length,
    downShare: rows.length === 0 ? null : down / rows.length,
  };
}
