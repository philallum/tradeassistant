/**
 * Zone 1 control bar for the single-window dashboard.
 *
 * Composes the {@link DateSelector} and {@link RefreshControl} under the document's single
 * `<h1>`, aligned on one horizontal row (the date selector on the left, the refresh button
 * on the right). There is deliberately NO pair selector here: the All_Pairs_Strip below is
 * the only pair navigator, so the same choice is never offered twice. The bar is sticky
 * (`position: sticky; top: 0`) so the controls stay reachable while the window scrolls.
 *
 * This is a thin, controlled view: the shell owns the dates, in-flight flag and refresh
 * callback and passes them down. Nothing is fetched or recomputed here.
 */

import { theme } from "../theme/darkTheme";
import { DateSelector } from "./DateSelector";
import { RefreshControl } from "./RefreshControl";

export interface ControlBarProps {
  /** Available Decision_Dates for the date selector (may be empty). */
  readonly dates: readonly string[];
  /** True while a refresh (or initial load) is in flight. */
  readonly isRefreshing: boolean;
  /** Invoked when the viewer activates refresh. */
  readonly onRefresh: () => void;
}

export function ControlBar({ dates, isRefreshing, onRefresh }: ControlBarProps): JSX.Element {
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
          // Align the date selector and the refresh button on their control row. The date
          // selector carries a label above its <select>, so aligning to the end keeps both
          // controls' boxes level along the bottom.
          alignItems: "flex-end",
          gap: theme.spacing.md,
        }}
      >
        <DateSelector dates={dates} />
        <div style={{ marginLeft: "auto" }}>
          <RefreshControl isRefreshing={isRefreshing} onRefresh={onRefresh} />
        </div>
      </div>
    </header>
  );
}
