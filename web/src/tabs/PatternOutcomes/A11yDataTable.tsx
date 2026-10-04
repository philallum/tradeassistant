/**
 * Renders a pure-shaper {@link A11yTable} as a real HTML `<table>` — the text/table
 * equivalent that accompanies every chart in the Pattern & Outcomes tab (Req 18.4).
 *
 * Each chart shaper in `web/src/pure/shapeCharts.ts` returns, alongside its plotted series,
 * an `A11yTable` model holding the EXACT same verbatim values as the chart (Req 9.10,
 * 10.4, 20.1 — the SPA recomputes nothing). This component renders that model so the
 * charted values are available to assistive-technology users and anyone who cannot
 * interpret the visualization, with no re-derivation of its own: cells are rendered
 * verbatim, only stringified for display.
 *
 * This is impure render code (JSX), so it lives under `tabs/`, never under `pure/`.
 */

import type { JSX } from "react";

import type { A11yTable } from "../../pure/shapeCharts";
import { theme } from "../../theme/darkTheme";

export interface A11yDataTableProps {
  /** The verbatim table model emitted by a chart shaper (Req 18.4). */
  readonly table: A11yTable;
  /** Accessible caption describing what the table (and its chart) represents. */
  readonly caption: string;
  /**
   * When true the table is positioned off-screen but remains in the accessibility tree —
   * used when the chart is the primary visual and the table is its screen-reader
   * equivalent. When false (default) the table is visible to everyone.
   */
  readonly visuallyHidden?: boolean;
}

/** Off-screen-but-readable style: kept in the a11y tree, removed from the visual flow. */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Render a single verbatim cell value as display text without recomputing it. */
function renderCell(value: string | number | boolean | null): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

export function A11yDataTable({
  table,
  caption,
  visuallyHidden = false,
}: A11yDataTableProps): JSX.Element {
  const wrapperStyle: React.CSSProperties = visuallyHidden
    ? SR_ONLY
    : {
        overflowX: "auto",
        marginTop: theme.spacing.sm,
      };

  return (
    <div style={wrapperStyle}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: 13,
          color: theme.colors.textSecondary,
        }}
      >
        <caption
          style={{
            textAlign: "left",
            captionSide: "top",
            color: theme.colors.textMuted,
            fontSize: 12,
            paddingBottom: theme.spacing.xs,
          }}
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th
                key={column}
                scope="col"
                style={{
                  textAlign: "left",
                  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                  borderBottom: `1px solid ${theme.colors.border}`,
                  color: theme.colors.textPrimary,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(1, table.columns.length)}
                style={{
                  padding: `${theme.spacing.sm}px`,
                  color: theme.colors.textMuted,
                  fontStyle: "italic",
                }}
              >
                No rows.
              </td>
            </tr>
          ) : (
            table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{
                      padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                      borderBottom: `1px solid ${theme.colors.border}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderCell(cell)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
