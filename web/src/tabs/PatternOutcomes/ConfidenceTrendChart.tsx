/**
 * Earned_Confidence trend chart (Req 9.5) + its text/table equivalent (Req 18.4).
 *
 * Renders the {@link TrendSeries} produced by the pure `shapeConfidenceTrend` shaper as a
 * dark-themed Recharts line chart (Req 15.3), plotting each Decision_Date's
 * `earnedConfidence` VERBATIM — this component recomputes nothing (Req 9.10, 20.1). The
 * companion {@link A11yDataTable} renders the shaper's a11y table model so the same values
 * are available without interpreting the chart (Req 18.4).
 */

import type { JSX } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TrendSeries } from "../../pure/shapeCharts";
import { theme } from "../../theme/darkTheme";
import { A11yDataTable } from "./A11yDataTable";
import {
  CHART_HEIGHT,
  axisLineColor,
  axisTick,
  gridStroke,
  tooltipStyles,
} from "./chartTheme";

export interface ConfidenceTrendChartProps {
  /** The verbatim trend series + a11y table from the pure shaper. */
  readonly series: TrendSeries;
}

/** Format the fractional confidence axis/tooltip value as a whole percent for display. */
function percentLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ConfidenceTrendChart({ series }: ConfidenceTrendChartProps): JSX.Element {
  if (series.points.length === 0) {
    return (
      <p style={{ color: theme.colors.textMuted, margin: 0 }}>
        No confidence history for this pair.
      </p>
    );
  }

  // Recharts consumes a plain array; values are copied straight from the verbatim points.
  const data = series.points.map((point) => ({
    date: point.decisionDate,
    confidence: point.earnedConfidence,
  }));

  return (
    <figure style={{ margin: 0 }}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={axisTick} stroke={axisLineColor} />
          <YAxis
            domain={[0, 1]}
            tickFormatter={percentLabel}
            tick={axisTick}
            stroke={axisLineColor}
            width={44}
          />
          <Tooltip
            {...tooltipStyles}
            formatter={(value: number) => [percentLabel(value), "Earned confidence"]}
          />
          <Line
            type="monotone"
            dataKey="confidence"
            name="Earned confidence"
            stroke={theme.chart.confidence}
            strokeWidth={2}
            dot={{ r: 3, fill: theme.chart.confidence }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <figcaption>
        <A11yDataTable
          table={series.table}
          caption={`Earned confidence by decision date for ${series.pair}.`}
        />
      </figcaption>
    </figure>
  );
}
