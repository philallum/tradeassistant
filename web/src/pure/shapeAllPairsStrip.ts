/**
 * Builds the All_Pairs_Strip view model — the dashboard's ONLY pair navigator — from the
 * confluence slice.
 *
 * Always yields exactly five entries in `PAIRS` order. Each entry carries the pair's
 * conviction tier ("Aligned up", "Lean down", "Split", "No view") and its vote tally, taken
 * from {@link shapeConviction}; a pair with no confluence row yields an explicit no-data
 * entry. Nothing is recomputed or fabricated, and the bare "Neutral" label is retired.
 */

import { PAIRS, type Confluence, type Pair } from "../api/types";
import { NO_SIGNAL_TEXT } from "./noSignalCopy";
import { shapeConviction, tierGlyph, type ConvictionTier } from "./shapeConviction";

export interface StripEntryVM {
  readonly pair: Pair;
  readonly hasData: boolean;
  /** "Aligned up" | "Lean down" | "Split" | "No view", or "" when there is no data. */
  readonly label: string;
  readonly tier: ConvictionTier | "none";
  /** Non-colour cue for the tier. */
  readonly glyph: string;
  /** "1 up · 1 down · 3 flat", or the shared no-signal text when there is no data. */
  readonly tallyText: string;
}

export interface AllPairsStripVM {
  readonly entries: readonly StripEntryVM[];
}

export function shapeAllPairsStrip(slice: Confluence): AllPairsStripVM {
  const entries = PAIRS.map((pair): StripEntryVM => {
    const row = slice.pairs.find((p) => p.pair === pair);
    if (row === undefined) {
      return { pair, hasData: false, label: "", tier: "none", glyph: "\u2205", tallyText: NO_SIGNAL_TEXT };
    }
    const vm = shapeConviction(row, slice.weights);
    return {
      pair,
      hasData: true,
      label: vm.label,
      tier: vm.tier,
      glyph: tierGlyph(vm),
      tallyText: vm.tallyText,
    };
  });
  return { entries };
}
