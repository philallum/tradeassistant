/**
 * Backtest_Edge_Pill (Req 8.4, 8.5, 8.6). Renders one {@link BacktestEdgePillVM} produced by
 * `shapeBacktestEdge`.
 *
 * When `available`, shows the shaper's `edgeText` verbatim. Otherwise shows the explicit
 * no-signal marker from `pure/noSignalCopy.ts`. It never renders a stale or default number.
 */
import type { JSX } from "react";

import type { BacktestEdgePillVM } from "../pure/shapeBacktestEdge";
import { NO_SIGNAL_TEXT } from "../pure/noSignalCopy";
import { theme } from "../theme/darkTheme";

export const BACKTEST_EDGE_LABEL = "Backtest edge";

export interface BacktestEdgePillProps {
  readonly vm: BacktestEdgePillVM;
}

export function BacktestEdgePill({ vm }: BacktestEdgePillProps): JSX.Element {
  const text = vm.available ? vm.edgeText : NO_SIGNAL_TEXT;
  return (
    <div
      data-testid="backtest-edge-pill"
      data-available={vm.available ? "true" : "false"}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: theme.spacing.xs,
        alignSelf: "flex-start",
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: `0 ${theme.spacing.sm}px`,
        fontSize: 15,
      }}
    >
      <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>
        {BACKTEST_EDGE_LABEL}
      </span>
      <span
        data-testid="backtest-edge-value"
        style={{
          fontFamily: theme.font.mono,
          color: vm.available ? theme.colors.textPrimary : theme.colors.textSecondary,
        }}
      >
        {text}
      </span>
    </div>
  );
}
