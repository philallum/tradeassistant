/**
 * Looks up the single {@link RowVM} for one {@link Pair} within a
 * {@link ConfluenceViewModel}.
 *
 * This is a plain lookup: it does not reshape, recompute or reformat the
 * row. The returned value is the unchanged source `RowVM` reference, or
 * `null` when the view model has no row for the requested pair.
 *
 * _Requirements: 5.8_
 */

import type { ConfluenceViewModel, RowVM } from "./shapeConfluence";
import type { Pair } from "../api/types";

export function selectPairConfluenceRow(
  viewModel: ConfluenceViewModel,
  pair: Pair,
): RowVM | null {
  const row = viewModel.rows.find((candidate) => candidate.pair === pair);
  return row ?? null;
}
