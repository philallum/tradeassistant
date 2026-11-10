/**
 * EventFlagBanner — a scheduled high-impact event on the Decision_Date.
 *
 * Presentation only: text comes verbatim from `shapeEventFlag`. A caution, not a signal; it never
 * hides or alters a call. Not dismissable on purpose: it is one short line about today.
 */
import type { JSX } from "react";

import type { EventFlagVM } from "../pure/shapeEventFlag";
import { theme } from "../theme/darkTheme";

export interface EventFlagBannerProps {
  readonly vm: EventFlagVM | null;
}

export function EventFlagBanner({ vm }: EventFlagBannerProps): JSX.Element | null {
  if (vm === null) return null;
  return (
    <div
      role="note"
      data-testid="event-flag-banner"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        border: `1px solid ${theme.semantic.warning}`,
        borderRadius: theme.radius.md,
        background: theme.colors.surface,
        color: theme.colors.textPrimary,
        fontSize: 14,
      }}
    >
      <strong>
        <span aria-hidden="true">⚠ </span>
        {vm.headline}
      </strong>
      <span style={{ fontSize: 13, color: theme.colors.textSecondary }}>{vm.detail}</span>
    </div>
  );
}
