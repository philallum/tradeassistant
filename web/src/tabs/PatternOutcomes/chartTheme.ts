/**
 * Shared Recharts theming helpers for the Pattern & Outcomes charts (Req 15.3).
 *
 * The single dark theme (`web/src/theme/darkTheme.ts`) exports the chart palette and frame
 * colors; this module turns those tokens into the small, repeated Recharts prop bundles the
 * four charts share (axis styling, grid, tooltip chrome) so every chart stays legible
 * against the dark canvas and no chart hardcodes a color. It reads only the frozen theme
 * token table — it performs no fetch, holds no state, and recomputes no data value.
 */

import { theme } from "../../theme/darkTheme";

/** Common tick/label styling for both axes, driven by the dark theme (Req 15.3). */
export const axisTick = {
  fill: theme.chart.axis,
  fontSize: 11,
} as const;

/** Axis line / tick-line color. */
export const axisLineColor = theme.chart.axis;

/** Cartesian grid stroke color. */
export const gridStroke = theme.chart.grid;

/** Tooltip container + label/item styling so tooltips read on the dark background. */
export const tooltipStyles = {
  contentStyle: {
    background: theme.chart.tooltipBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.sm,
    color: theme.chart.tooltipText,
  },
  labelStyle: { color: theme.chart.tooltipText },
  itemStyle: { color: theme.chart.tooltipText },
} as const;

/** Legend text styling. */
export const legendStyle = { color: theme.colors.textSecondary, fontSize: 12 } as const;

/** Standard responsive-container height for a tab chart on mobile. */
export const CHART_HEIGHT = 240;
