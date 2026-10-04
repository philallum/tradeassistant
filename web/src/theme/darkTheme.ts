/**
 * The single dark theme for the Dashboard_UI (Req 15).
 *
 * This module exports ONE immutable set of dark-mode design tokens — surfaces, text,
 * borders, semantic status colors, Direction_Class colors, and a Recharts chart palette —
 * that BOTH the UI chrome and the Recharts charts consume so charted values stay legible
 * against the dark background (Req 15.1, 15.2, 15.3).
 *
 * Dark-only is a LOCKED decision:
 *   - There is NO light theme. No alternate token set is exported from this module.
 *   - There is NO theme toggle. Nothing here reads, stores, or exposes a theme selection.
 *   - There is NO `prefers-color-scheme` defaulting. This module performs no media-query
 *     read and no runtime environment inspection; it is a static token table. The dark
 *     theme is always applied (Req 15.2).
 *
 * The tokens are plain data (hex color strings and a handful of numeric scales). This
 * module imports nothing, touches no DOM, reads no clock, and makes no decision — the
 * CSS-variable wiring and Recharts prop plumbing live in the impure component layer that
 * reads these values.
 */

/** A hex color string (e.g. `"#0b0f17"`). Kept as a nominal alias for readability. */
export type ColorToken = string;

/**
 * Base surface, text, and border colors for all non-chart UI chrome.
 *
 * Layered darkest-to-lightest: `background` is the app canvas, `surface` is a raised panel
 * (cards, tab bar), `surfaceRaised` is a further-raised element (menus, popovers). Text
 * colors step down in emphasis; `border` separates layered surfaces.
 */
export interface SurfaceColors {
  /** App canvas — the darkest layer, behind every panel. */
  readonly background: ColorToken;
  /** Raised panel surface (firing cards, bottom tab bar, accordions). */
  readonly surface: ColorToken;
  /** Further-raised surface (dropdowns, popovers, selected states). */
  readonly surfaceRaised: ColorToken;
  /** Primary body text — highest contrast against `background`/`surface`. */
  readonly textPrimary: ColorToken;
  /** Secondary / supporting text (labels, captions). */
  readonly textSecondary: ColorToken;
  /** Muted text (disabled, de-emphasized, the not-actionable marker). */
  readonly textMuted: ColorToken;
  /** Hairline border separating layered surfaces and grid lines. */
  readonly border: ColorToken;
  /** Accent color for interactive affordances (active tab, focused control). */
  readonly accent: ColorToken;
  /** On-accent text/icon color placed over `accent` fills. */
  readonly onAccent: ColorToken;
}

/**
 * Semantic status colors, tuned for legibility on the dark `background`.
 *
 * These convey meaning (success/warning/danger/info/neutral). Per Req 18.3 the UI must
 * also convey Direction_Class and surfaced-vs-suppressed status through text or shape, so
 * these colors are a reinforcement, never the sole signal.
 */
export interface SemanticColors {
  /** Positive / pass / agreement. */
  readonly success: ColorToken;
  /** Caution / pending / neutral-comparison. */
  readonly warning: ColorToken;
  /** Negative / cut / divergence / error. */
  readonly danger: ColorToken;
  /** Informational emphasis. */
  readonly info: ColorToken;
  /** Neutral / unavailable / not-applicable. */
  readonly neutral: ColorToken;
}

/**
 * Direction_Class colors (UP / DOWN / FLAT), used for firing cards and direction markers.
 *
 * Color is a reinforcement only — the UI also renders the direction as text/shape so the
 * class is never conveyed by color alone (Req 18.3).
 */
export interface DirectionColors {
  readonly UP: ColorToken;
  readonly DOWN: ColorToken;
  readonly FLAT: ColorToken;
}

/**
 * Dark-theme color set for Recharts charts (Req 15.3).
 *
 * `series` is an ordered categorical palette for arbitrary multi-series charts; consumers
 * assign colors by index. The named roles (`confidence`, `favorable`, `adverse`,
 * `priceUp`, `priceDown`) give the specific chart shapers stable, semantically meaningful
 * colors (confidence trend, MFE favorable / MAE adverse excursion, OHLC up/down candles).
 * `axis`, `grid`, `tooltipBackground`, and `tooltipText` theme the chart frame so values
 * stay legible against the dark canvas.
 */
export interface ChartColors {
  /** Ordered categorical palette; consumers pick by series index, wrapping if needed. */
  readonly series: readonly ColorToken[];
  /** Earned_Confidence trend line/area. */
  readonly confidence: ColorToken;
  /** Favorable movement (MFE / `mfe_pips`). */
  readonly favorable: ColorToken;
  /** Adverse movement (MAE / `mae_pips`). */
  readonly adverse: ColorToken;
  /** Up (bullish) price candle — close ≥ open. */
  readonly priceUp: ColorToken;
  /** Down (bearish) price candle — close < open. */
  readonly priceDown: ColorToken;
  /** Axis lines and tick labels. */
  readonly axis: ColorToken;
  /** Chart grid lines. */
  readonly grid: ColorToken;
  /** Tooltip panel background. */
  readonly tooltipBackground: ColorToken;
  /** Tooltip text. */
  readonly tooltipText: ColorToken;
}

/** The complete dark-theme token set consumed by the UI and the Recharts charts. */
export interface DarkTheme {
  /** Fixed theme name — there is exactly one theme and it is dark. */
  readonly name: "dark";
  readonly colors: SurfaceColors;
  readonly semantic: SemanticColors;
  readonly direction: DirectionColors;
  readonly chart: ChartColors;
  /** Spacing scale in pixels (4px base), for consistent layout rhythm. */
  readonly spacing: {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
  };
  /** Corner-radius scale in pixels. */
  readonly radius: {
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
  };
  /** Font-family stacks. */
  readonly font: {
    readonly body: string;
    readonly mono: string;
  };
}

/**
 * The single dark theme instance.
 *
 * Deeply frozen so the shared token table cannot be mutated at runtime by any consumer —
 * there is one theme and it is constant for the life of the app.
 */
export const darkTheme: DarkTheme = Object.freeze({
  name: "dark",
  colors: Object.freeze({
    background: "#0b0f17",
    surface: "#141a26",
    surfaceRaised: "#1d2534",
    textPrimary: "#e6edf7",
    textSecondary: "#aab6c7",
    textMuted: "#6b7686",
    border: "#2a3346",
    accent: "#4c8dff",
    onAccent: "#0b0f17",
  }),
  semantic: Object.freeze({
    success: "#3fb950",
    warning: "#d29922",
    danger: "#f85149",
    info: "#58a6ff",
    neutral: "#8b949e",
  }),
  direction: Object.freeze({
    UP: "#3fb950",
    DOWN: "#f85149",
    FLAT: "#8b949e",
  }),
  chart: Object.freeze({
    series: Object.freeze([
      "#4c8dff",
      "#3fb950",
      "#d29922",
      "#bc8cff",
      "#f85149",
      "#39c5cf",
    ]),
    confidence: "#4c8dff",
    favorable: "#3fb950",
    adverse: "#f85149",
    priceUp: "#3fb950",
    priceDown: "#f85149",
    axis: "#aab6c7",
    grid: "#2a3346",
    tooltipBackground: "#1d2534",
    tooltipText: "#e6edf7",
  }),
  spacing: Object.freeze({ xs: 4, sm: 8, md: 16, lg: 24, xl: 32 }),
  radius: Object.freeze({ sm: 4, md: 8, lg: 12 }),
  font: Object.freeze({
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace",
  }),
}) as DarkTheme;

/**
 * The one and only theme the app ever applies. There is no selection logic, no toggle, and
 * no `prefers-color-scheme` read — this always resolves to {@link darkTheme} (Req 15.2).
 */
export const theme: DarkTheme = darkTheme;
