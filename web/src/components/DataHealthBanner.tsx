/**
 * Non-blocking "data feed delayed" banner. Presentation only: text comes verbatim from the
 * shaped view model. Dismissable for the current page session (state resets on reload, so a
 * persistent problem is shown again next visit). Never blocks or replaces the dashboard.
 */
import { useState } from "react";
import type { JSX } from "react";

import type { DataHealthVM } from "../pure/shapeDataHealth";
import { theme } from "../theme/darkTheme";

export interface DataHealthBannerProps {
  readonly health: DataHealthVM | null;
}

export function DataHealthBanner({ health }: DataHealthBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (health === null || dismissed) return null;

  return (
    <div
      role="status"
      data-testid="data-health-banner"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: theme.spacing.md,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        border: `1px solid ${theme.semantic.warning}`,
        borderRadius: theme.radius.md,
        background: theme.colors.surface,
        color: theme.colors.textPrimary,
        fontSize: 14,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <strong>
          <span aria-hidden="true">⚠ </span>
          {health.message}
        </strong>
        {health.detail !== null ? (
          <span style={{ fontSize: 13, color: theme.colors.textSecondary }}>{health.detail}</span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss data delay notice"
        style={{
          flexShrink: 0,
          minWidth: 44,
          minHeight: 44,
          background: "transparent",
          color: theme.colors.textSecondary,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
