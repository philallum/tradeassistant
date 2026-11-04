/**
 * Footer "System record": how often the pattern engine was right over the latest
 * out-of-sample evaluation, next to the naive baseline. Replaces the old single
 * "Backtest edge" pill. Presentation only; text comes verbatim from the shaped view model.
 */
import type { JSX } from "react";

import type { SystemRecordVM } from "../pure/shapeSystemRecord";
import { theme } from "../theme/darkTheme";

export interface SystemRecordFooterProps {
  readonly record: SystemRecordVM;
}

export function SystemRecordFooter({ record }: SystemRecordFooterProps): JSX.Element {
  return (
    <footer
      data-testid="system-record"
      data-available={record.available ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        fontSize: 13,
        color: theme.colors.textSecondary,
        borderTop: `1px solid ${theme.colors.border}`,
      }}
    >
      <span>{record.text}</span>
      {record.caution !== null ? (
        <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{record.caution}</span>
      ) : null}
    </footer>
  );
}
