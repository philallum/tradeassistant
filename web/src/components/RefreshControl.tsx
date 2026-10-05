/**
 * Refresh control + data-freshness "last updated" indicator (Req 17.1, 17.3).
 *
 * Renders an explicit refresh button that forces a fresh end-to-end fetch of the currently
 * shown data (Req 17.1) and a visible "last updated" timestamp for that data (Req 17.3).
 *
 * This component is a thin, controlled view: the actual fetching is owned by the shell,
 * which passes down `lastUpdated` (the value the api client surfaced from the proxy), an
 * `isRefreshing` flag, and an `onRefresh` callback. The callback is wired by the shell to
 * re-issue the current fetches with the api client's cache-bust transform
 * (`{ bustCache: true }`), which appends `_r=<nonce>` and sends `Cache-Control: no-cache`
 * so the proxy's cached response is bypassed (Req 17.2). This component recomputes nothing
 * and holds no fetch logic of its own.
 */

import { theme } from "../theme/darkTheme";

export interface RefreshControlProps {
  /**
   * The proxy's freshness marker for the currently shown data (ISO string), or `null` when
   * nothing has loaded yet. Displayed verbatim-ish as the "last updated" timestamp.
   */
  readonly lastUpdated: string | null;
  /** True while a refresh (or initial load) is in flight — disables the button (Req 17.4). */
  readonly isRefreshing: boolean;
  /** Invoked when the viewer activates refresh; the shell re-fetches with bustCache. */
  readonly onRefresh: () => void;
}

/**
 * Present an ISO timestamp as a compact, locale-formatted "last updated" label. When the
 * value is not a parseable date it is shown verbatim; when absent, an explicit "never"
 * marker is shown. This is display formatting of an already-persisted value — it derives
 * no new data (Req 20.1).
 */
function formatLastUpdated(iso: string | null): string {
  if (iso === null) {
    return "not yet loaded";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString();
}

export function RefreshControl({
  lastUpdated,
  isRefreshing,
  onRefresh,
}: RefreshControlProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.sm,
        flexWrap: "wrap",
      }}
    >
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
      <span
        aria-live="polite"
        style={{ fontSize: 12, color: theme.colors.textSecondary }}
      >
        Last updated: <time>{formatLastUpdated(lastUpdated)}</time>
      </span>
    </div>
  );
}
