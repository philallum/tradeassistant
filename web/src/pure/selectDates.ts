/**
 * Pure Decision_Date selection logic (property-testable — Req 19.3).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock
 * (`Date.now()`), and imports NOTHING from the deterministic core (`src/`). Every function
 * is a deterministic function of its arguments alone. That purity invariant (Req 19) is
 * what lets these selectors be exercised exhaustively by `fast-check` without a browser or
 * network (see Properties 1 and 2 in the design).
 *
 * Decision_Dates are ISO calendar-date strings (e.g. `"2026-09-16"`). ISO dates in this
 * fixed `YYYY-MM-DD` form sort chronologically under plain lexicographic string comparison,
 * so "the latest date" is simply the string maximum — no `Date` parsing required.
 */

/**
 * Return the latest (maximum) Decision_Date present in `dates`.
 *
 * Returns the maximum date when the set is non-empty, and `null` when it is empty. The
 * result is independent of the input order and of duplicate entries — it depends only on
 * the SET of dates present (Req 6.1, 19.3; Property 1).
 */
export function selectLatestDecisionDate(dates: readonly string[]): string | null {
  let latest: string | null = null;
  for (const date of dates) {
    if (latest === null || date > latest) {
      latest = date;
    }
  }
  return latest;
}

/**
 * Choose which Decision_Date to browse, given the full set of available `dates` and an
 * optionally-`requested` date.
 *
 * - Returns `requested` when it is present in `dates`.
 * - Otherwise falls back to the latest present date (via {@link selectLatestDecisionDate}).
 * - Returns `null` only for an empty set.
 *
 * The result is NEVER a date absent from `dates`: a requested date that is not in the set
 * is treated as "not available" and resolves to the latest-present fallback (Req 7.1;
 * Property 2).
 */
export function selectBrowseDate(
  dates: readonly string[],
  requested: string | null,
): string | null {
  if (requested !== null && dates.includes(requested)) {
    return requested;
  }
  return selectLatestDecisionDate(dates);
}
