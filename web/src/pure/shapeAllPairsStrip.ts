/**
 * Builds the All_Pairs_Strip view model from an existing {@link ConfluenceViewModel}.
 *
 * Always yields exactly five entries in `PAIRS` order. Values are taken verbatim from the
 * matching `RowVM`; a pair with no row yields an explicit no-data entry. Nothing is
 * recomputed or fabricated.
 *
 * _Requirements: 4.1, 4.2, 4.6, 4.8_
 */

import { PAIRS, type Pair } from "../api/types";
import { NO_SIGNAL_TEXT } from "./noSignalCopy";
import { selectPairConfluenceRow } from "./selectPairConfluenceRow";
import type { ConfluenceViewModel, RowVM } from "./shapeConfluence";

export interface StripEntryVM {
  readonly pair: Pair;
  readonly hasData: boolean;
  readonly statusLabel: string;
  readonly marker: RowVM["marker"] | "none";
  readonly scoreText: string;
}

export interface AllPairsStripVM {
  readonly entries: readonly StripEntryVM[];
}

export function shapeAllPairsStrip(confluence: ConfluenceViewModel): AllPairsStripVM {
  const entries = PAIRS.map((pair): StripEntryVM => {
    const row = selectPairConfluenceRow(confluence, pair);
    if (row === null) {
      return { pair, hasData: false, statusLabel: "", marker: "none", scoreText: NO_SIGNAL_TEXT };
    }
    return {
      pair,
      hasData: true,
      statusLabel: row.statusLabel,
      marker: row.marker,
      scoreText: row.scoreText,
    };
  });
  return { entries };
}
