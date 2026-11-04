/**
 * Zone 1 control bar for the single-window dashboard (Req 2.1, 2.2, 2.5, 12.1, 12.6).
 *
 * Composes the existing, unchanged {@link PairSelector}, {@link DateSelector} and
 * {@link RefreshControl} under the document's single `<h1>`. The header layout and h1 text
 * are carried over from `AppShell`. The bar is sticky (`position: sticky; top: 0`) so the
 * selectors stay reachable while the single window scrolls.
 *
 * This is a thin, controlled view: the shell owns the dates, freshness marker, in-flight
 * flag and refresh callback and passes them down. Nothing is fetched or recomputed here.
 */

import { theme } from "../theme/darkTheme";
import { DateSelector } from "./DateSelector";
import { PairSelector } from "./PairSelector";
import { RefreshControl } from "./RefreshControl";
import { useMediaQuery, WIDE_VIEWPORT_QUERY } from "./useMediaQuery";

export interface ControlBarProps {
  /** Available Decision_Dates for the date selector (may be empty). */
  readonly dates: readonly string[];
  /** The proxy's freshness marker (ISO string) or `null` when nothing has loaded. */
  readonly lastUpdated: string | null;
  /** True while a refresh (or initial load) is in flight. */
  readonly isRefreshing: boolean;
  /** Invoked when the viewer activates refresh. */
  readonly onRefresh: () => void;
}

export function ControlBar({
  dates,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: ControlBarProps): JSX.Element {
  const wide = useMediaQuery(WIDE_VIEWPORT_QUERY);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: theme.spacing.md,
        borderBottom: `1px solid ${theme.colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
        background: theme.colors.surface,
      }}
    >
      {/* Single top-level heading for the document (Req 12.1). */}
      <h1 style={{ margin: 0, fontSize: 18 }}>Trading Assistant — Dashboard</h1>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: theme.spacing.md,
        }}
      >
        <PairSelector wide={wide} />
        <DateSelector dates={dates} />
        <div style={{ marginLeft: "auto" }}>
          <RefreshControl
            lastUpdated={lastUpdated}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    </header>
  );
}
