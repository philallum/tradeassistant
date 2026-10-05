/**
 * MFE/MAE excursion-profile chart (Req 9.6) + its text/table equivalent (Req 18.4).
 *
 * Renders the {@link ExcursionSeries} produced by the pure `shapeExcursionProfile` shaper
 * as a dark-themed grouped bar chart (Req 15.3): favorable movement (`mfePips`) and adverse
 * movement (`maePips`) per Decision_Date, both VERBATIM from `analogue_outcomes` — nothing
 * is recomputed (Req 10.4, 20.1). The companion {@link A11yDataTable} exposes the same
 * values as text (Req 18.4). Favorable/adverse are distinguished by legend label and bar
 * position, not color alone (Req 18.3).
 */

import type { JSX } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ExcursionSeries } from "../../pure/shapeCharts";
import { theme } from "../../theme/darkTheme";
import { A11yDataTable } from "./A11yDataTable";
import {
  CHART_HEIGHT,
  axisLineColor,
  axisTick,
  gridStroke,
  legendStyle,
  tooltipStyles,
} from "./chartTheme";

export interface ExcursionProfileChartProps {
  /** The verbatim excursion series + a11y table from the pure shaper. */
  readonly series: ExcursionSeries;
}

export function ExcursionProfileChart({
  series,
}: ExcursionProfileChartProps): JSX.Element {
  if (series.points.length === 0) {
    return (
      <p style={{ color: theme.colors.textMuted, margin: 0 }}>
        No excursion outcomes for this pair.
      </p>
    );
  }

  const data = series.points.map((point) => ({
    date: point.decisionDate,
    mfe: point.mfePips,
    mae: point.maePips,
  }));

  return (
    <figure style={{ margin: 0 }}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={axisTick} stroke={axisLineColor} />
          <YAxis tick={axisTick} stroke={axisLineColor} width={44} />
          <Tooltip
            {...tooltipStyles}
            formatter={(value: number, name: string) => [`${value} pips`, name]}
          />
          <Legend wrapperStyle={legendStyle} />
          <Bar
            dataKey="mfe"
            name="Favorable (MFE)"
            fill={theme.chart.favorable}
            isAnimationActive={false}
          />
          <Bar
            dataKey="mae"
            name="Adverse (MAE)"
            fill={theme.chart.adverse}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      <figcaption>
        <A11yDataTable
          table={series.table}
          caption="Favorable (MFE) and adverse (MAE) excursion in pips by decision date."
        />
      </figcaption>
    </figure>
  );
}
