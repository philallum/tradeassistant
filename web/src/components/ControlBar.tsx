/**
 * Zone 1 control bar for the single-window dashboard.
 *
 * Composes the {@link DateSelector} and {@link RefreshControl} under the document's single
 * `<h1>`. There is deliberately NO pair selector here: the All_Pairs_Strip below is the only
 * pair navigator, so the same choice is never offered twice. The bar is sticky
 * (`position: sticky; top: 0`) so the controls stay reachable while the window scrolls.
 *
 * This is a thin, controlled view: the shell owns the dates, freshness marker, in-flight
 * flag and refresh callback and passes them down. Nothing is fetched or recomputed here.
 */

import { theme } from "../theme/darkTheme";
import { DateSelector } from "./DateSelector";
import { RefreshControl } from "./RefreshControl";

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
