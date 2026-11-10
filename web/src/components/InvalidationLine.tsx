/**
 * One labelled line under the pair summary: the distance beyond which the pattern thesis is
 * treated as invalidated. Presentation only; text comes verbatim from the shaped view model.
 * The "unvalidated" tag and the explanatory note are visible text (not tooltip-only), and the
 * same note is also set as the tooltip. No direction colour is used.
 */
import type { JSX } from "react";

import type { InvalidationVM } from "../pure/shapeInvalidation";
import { theme } from "../theme/darkTheme";

export interface InvalidationLineProps {
  readonly vm: InvalidationVM | null;
}

export function InvalidationLine({ vm }: InvalidationLineProps): JSX.Element | null {
  if (vm === null) return null;
  return (
    <section
      aria-label="Invalidation distance"
      data-testid="invalidation-line"
      title={vm.note}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        fontSize: 14,
        color: theme.colors.textPrimary,
      }}
    >
      <span>
        {vm.text}{" "}
        <span
          data-testid="invalidation-tag"
          style={{
            fontSize: 12,
            padding: "1px 6px",
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.sm,
            color: theme.colors.textSecondary,
          }}
        >
          {vm.tag}
        </span>
      </span>
      <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{vm.note}</span>
    </section>
  );
}
