/**
 * Decision_Date selector (Historical_Browse control, Req 7.1, 8.6, 16.4).
 *
 * Lets the viewer browse a past Decision_Date while defaulting to the Latest_Decision_Date
 * when no explicit date is chosen. The current choice lives in the shared
 * {@link useSelection} store (`date`, `null` ⇒ "use latest"), so it persists across tab
 * navigation and deep-links via the URL query (Req 8.6, 16.4, 1.6).
 *
 * The component is a controlled dropdown over the `dates` the shell fetched from
 * `/decision-dates`; it recomputes nothing. The effective selection is resolved by the
 * pure `selectBrowseDate` so a stored date absent from the set falls back to the latest
 * present date rather than selecting a missing option (Req 7.1). The resolved latest is
 * labeled so the viewer can see when they are on the newest run.
 */

import { useSelection } from "../state/selection";
import {
  selectBrowseDate,
  selectLatestDecisionDate,
} from "../pure/selectDates";
import { theme } from "../theme/darkTheme";

export interface DateSelectorProps {
  /** Available Decision_Dates from `/decision-dates` (any order; may be empty). */
  readonly dates: readonly string[];
}

export function DateSelector({ dates }: DateSelectorProps): JSX.Element {
  const { date, setDate } = useSelection();

  const latest = selectLatestDecisionDate(dates);
  // The effective browsed date: the stored choice when present, else the latest fallback.
  const effective = selectBrowseDate(dates, date);

  // Dedupe + sort descending so the newest run is first in the dropdown.
  const sorted = Array.from(new Set(dates)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xs }}>
      <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>Decision date</span>
      <select
        aria-label="Decision date (historical browse)"
        value={effective ?? ""}
        disabled={sorted.length === 0}
        onChange={(e) => {
          const next = e.target.value;
          // Choosing the latest clears the explicit selection so the view tracks the
          // newest run as new dates arrive (Req 6.1); otherwise store the explicit date.
          setDate(next === "" || next === latest ? null : next);
        }}
        style={{
          background: theme.colors.surfaceRaised,
          color: theme.colors.textPrimary,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          minHeight: 44, // tap-target sizing (Req 18.5)
          fontSize: 15,
        }}
      >
        {sorted.length === 0 ? (
          <option value="">No dates</option>
        ) : (
          sorted.map((d) => (
            <option key={d} value={d}>
              {d === latest ? `${d} (latest)` : d}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
