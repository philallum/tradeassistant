/**
 * Pure single-window selection resolver (Req 2.6, 10.3, 10.4).
 *
 * The single-window view shows exactly one pair on one Decision_Date, so the shared
 * selection store's cross-pair "ALL" sentinel (or any unsupported pair) maps to `EURUSD`,
 * and a date absent from the available set maps to the Latest_Decision_Date using the
 * existing `selectBrowseDate` semantics. A valid field is always retained.
 *
 * The `rejected*` flags are derived from the RAW URL params the shell reads itself
 * (best-effort Req 10.4), so `state/selection.ts` is left untouched: a raw param that was
 * present but did not resolve to a supported pair / an available date is "rejected".
 *
 * This module is PURE: a deterministic function of its arguments, no DOM, no network.
 */

import { isPair, type Pair } from "../api/types";
import { selectBrowseDate } from "./selectDates";

/** The default pair for the single-window view. */
export const DEFAULT_WINDOW_PAIR: Pair = "EURUSD";

export interface WindowSelection {
  /** Always a supported pair. */
  readonly pair: Pair;
  /** The retained date, the Latest_Decision_Date fallback, or `null` for an empty set. */
  readonly date: string | null;
  /** True when a raw `pair` URL param was present but not a supported pair. */
  readonly rejectedPair: boolean;
  /** True when a raw `date` URL param was present but not in the available set. */
  readonly rejectedDate: boolean;
}

/**
 * Resolve the effective single-window selection.
 *
 * @param pair            the store's pair value (a supported pair or the "ALL" sentinel)
 * @param date            the store's date value, or `null` for "latest"
 * @param availableDates  the available Decision_Dates
 * @param rawPairParam    the raw `pair` URL query value, or `null` when absent
 * @param rawDateParam    the raw `date` URL query value, or `null` when absent
 */
export function resolveWindowSelection(
  pair: string,
  date: string | null,
  availableDates: readonly string[],
  rawPairParam: string | null,
  rawDateParam: string | null,
): WindowSelection {
  const resolvedPair: Pair = isPair(pair) ? pair : DEFAULT_WINDOW_PAIR;
  const resolvedDate = selectBrowseDate(availableDates, date);

  const rejectedPair = rawPairParam !== null && !isPair(rawPairParam);
  const rejectedDate =
    rawDateParam !== null && !availableDates.includes(rawDateParam);

  return {
    pair: resolvedPair,
    date: resolvedDate,
    rejectedPair,
    rejectedDate,
  };
}
