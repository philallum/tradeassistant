/**
 * Refresh control (Req 17.1).
 *
 * Renders an explicit refresh button that forces a fresh end-to-end fetch of the currently
 * shown data (Req 17.1).
 *
 * This component is a thin, controlled view: the actual fetching is owned by the shell,
 * which passes down an `isRefreshing` flag and an `onRefresh` callback. The callback is
 * wired by the shell to re-issue the current fetches with the api client's cache-bust
 * transform (`{ bustCache: true }`), which appends `_r=<nonce>` and sends
 * `Cache-Control: no-cache` so the proxy's cached response is bypassed (Req 17.2). This
 * component recomputes nothing and holds no fetch logic of its own.
 */

import { theme } from "../theme/darkTheme";

export interface RefreshControlProps {
  /** True while a refresh (or initial load) is in flight — disables the button (Req 17.4). */
  readonly isRefreshing: boolean;
  /** Invoked when the viewer activates refresh; the shell re-fetches with bustCache. */
  readonly onRefresh: () => void;
}

export function RefreshControl({ isRefreshing, onRefresh }: RefreshControlProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-label="Refresh data"
      aria-busy={isRefreshing}
      style={{
        appearance: "none",
        cursor: isRefreshing ? "default" : "pointer",
        background: theme.colors.surfaceRaised,
        color: theme.colors.textPrimary,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.sm,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        minHeight: 44, // tap-target sizing (Req 18.5)
        fontSize: 14,
        fontWeight: 600,
        opacity: isRefreshing ? 0.6 : 1,
      }}
    >
      {isRefreshing ? "Refreshing…" : "Refresh"}
    </button>
  );
}
