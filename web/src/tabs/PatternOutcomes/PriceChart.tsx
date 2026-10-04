/**
 * Price (OHLC) chart (Req 9.9) + its text/table equivalent (Req 18.4).
 *
 * Renders the {@link CandleSeries} from the pure `shapePriceSeries` shaper as a dark-themed
 * Recharts candlestick-style chart (Req 15.3). Each candle plots the VERBATIM open / high /
 * low / close for one date — nothing is recomputed (Req 9.10, 20.1). Recharts has no native
 * candlestick, so each candle is drawn as a custom shape over a composed chart: a thin
 * high→low wick and an open→close body, coloured up (close ≥ open) or down (close < open)
 * from the theme's `priceUp`/`priceDown` tokens. The companion {@link A11yDataTable} lists
 * the full OHLC values as text (Req 18.4), and up/down is also conveyed by the a11y table,
 * not color alone (Req 18.3).
 */

import type { JSX } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CandlePoint, CandleSeries } from "../../pure/shapeCharts";
import { theme } from "../../theme/darkTheme";
import { A11yDataTable } from "./A11yDataTable";
import {
  CHART_HEIGHT,
  axisLineColor,
  axisTick,
  gridStroke,
  tooltipStyles,
} from "./chartTheme";

export interface PriceChartProps {
  /** The verbatim OHLC series + a11y table from the pure shaper. */
  readonly series: CandleSeries;
}

/**
 * Datum carried through Recharts for one candle. `range` is the [low, high] pair the
 * invisible positioning Bar uses so the custom shape receives a y/height spanning the full
 * high→low wick; the raw OHLC values ride along for the custom renderer and the tooltip.
 */
interface CandleDatum {
  readonly date: string;
  readonly range: readonly [number, number];
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * Custom candle renderer. Recharts passes the pixel box (`x`, `y`, `width`, `height`) it
 * computed for the [low, high] range bar plus our datum; we map the verbatim O/H/L/C onto
 * that box with a linear low→high scale and draw the wick + body.
 */
function Candle(props: {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly payload?: CandleDatum;
}): JSX.Element | null {
  const { x, y, width, height, payload } = props;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    payload === undefined
  ) {
    return null;
  }

  const { open, high, low, close } = payload;
  const span = high - low;
  const up = close >= open;
  const color = up ? theme.chart.priceUp : theme.chart.priceDown;

  // Pixel y for a price: `y` is the top (= high), `y + height` is the bottom (= low).
  const priceToY = (price: number): number =>
    span === 0 ? y + height / 2 : y + ((high - price) / span) * height;

  const centerX = x + width / 2;
  const bodyTop = priceToY(Math.max(open, close));
  const bodyBottom = priceToY(Math.min(open, close));
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const bodyWidth = Math.max(2, width * 0.6);

  return (
    <g>
      {/* High→low wick */}
      <line
        x1={centerX}
        x2={centerX}
        y1={priceToY(high)}
        y2={priceToY(low)}
        stroke={color}
        strokeWidth={1}
      />
      {/* Open→close body */}
      <rect
        x={centerX - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        fill={color}
      />
    </g>
  );
}

/** Tooltip body showing the verbatim OHLC for the hovered candle. */
function renderTooltip(point: CandlePoint): JSX.Element {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{point.date}</div>
      <div>Open: {point.open}</div>
      <div>High: {point.high}</div>
      <div>Low: {point.low}</div>
      <div>Close: {point.close}</div>
    </div>
  );
}

export function PriceChart({ series }: PriceChartProps): JSX.Element {
  if (series.points.length === 0) {
    return (
      <p style={{ color: theme.colors.textMuted, margin: 0 }}>
        No price history for this pair.
      </p>
    );
  }

  const data: CandleDatum[] = series.points.map((point) => ({
    date: point.date,
    range: [point.low, point.high],
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
  }));

  const lows = series.points.map((p) => p.low);
  const highs = series.points.map((p) => p.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = max === min ? Math.abs(max) * 0.01 || 1 : (max - min) * 0.05;

  return (
    <figure style={{ margin: 0 }}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={axisTick} stroke={axisLineColor} />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={axisTick}
            stroke={axisLineColor}
            width={56}
            allowDecimals
          />
          <Tooltip
            {...tooltipStyles}
            content={({ active, payload }) => {
              const first = active && payload ? payload[0] : undefined;
              return first !== undefined
                ? renderTooltip(first.payload as CandleDatum)
                : null;
            }}
          />
          {/* Invisible positioning bar: its [low, high] range gives the custom shape the
              pixel box spanning the wick; the Candle shape draws the real candle. */}
          <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} fill="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <figcaption>
        <A11yDataTable
          table={series.table}
          caption="Open, high, low, and close prices by date."
        />
      </figcaption>
    </figure>
  );
}
