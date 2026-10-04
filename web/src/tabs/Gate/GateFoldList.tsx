/**
 * GateFoldList — the walk-forward fold visual for one verdict's `gate_fold_verdicts` rows
 * (Req 9.8).
 *
 * Renders each persisted {@link GateFoldVerdictRow} verbatim (Req 9.10, 20.1): the fold
 * index, sample size, each fold's per-fold `verdict`, and — rendered EXPLICITLY — its
 * `skipped` status. A skipped fold has no gate pass/fail outcome, so its gate flags and
 * verdict are shown as the explicit not-evaluated marker rather than a guessed value
 * (Req 9.8).
 *
 * The data is a small, bounded table (≤ 50 folds per the proxy cap), so it is presented as
 * an accessible `<table>`: this doubles as the text/table equivalent of the fold visual and
 * reads cleanly on a screen reader. Per-fold verdict is conveyed by text + shape glyph (not
 * color alone, Req 18.3), and skipped status by an explicit "Skipped"/"Ran" text label.
 */

import type { GateFoldVerdictRow } from "../../api/endpoints";
import { theme } from "../../theme/darkTheme";
import { formatFoldVerdict, formatPassFlag, verdictGlyph } from "./format";

export interface GateFoldListProps {
  /** The persisted fold rows for the selected verdict, rendered verbatim. */
  readonly rows: readonly GateFoldVerdictRow[];
}

const cellStyle: React.CSSProperties = {
  padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
  borderBottom: `1px solid ${theme.colors.border}`,
  fontSize: 13,
  textAlign: "left",
  color: theme.colors.textPrimary,
  whiteSpace: "nowrap",
};

const headCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: theme.colors.textSecondary,
  fontWeight: 600,
};

/** The per-fold verdict rendered as text + shape glyph (color-independent, Req 18.3). */
function FoldVerdictCell({ row }: { readonly row: GateFoldVerdictRow }): JSX.Element {
  const label = formatFoldVerdict(row.verdict);
  if (row.verdict === null) {
    return <span style={{ color: theme.colors.textMuted }}>{label}</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: theme.spacing.xs }}>
      <span aria-hidden="true">{verdictGlyph(row.verdict)}</span>
      <span>{label}</span>
    </span>
  );
}

export function GateFoldList({ rows }: GateFoldListProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p style={{ color: theme.colors.textSecondary, margin: 0 }}>
        No walk-forward folds recorded for this verdict.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
        }}
      >
        <caption
          style={{
            captionSide: "top",
            textAlign: "left",
            padding: `0 0 ${theme.spacing.sm}px 0`,
            fontSize: 12,
            color: theme.colors.textSecondary,
          }}
        >
          Walk-forward folds — per-fold verdict and skipped status
        </caption>
        <thead>
          <tr>
            <th scope="col" style={headCellStyle}>
              Fold
            </th>
            <th scope="col" style={headCellStyle}>
              Status
            </th>
            <th scope="col" style={headCellStyle}>
              Sample size
            </th>
            <th scope="col" style={headCellStyle}>
              Gate 1
            </th>
            <th scope="col" style={headCellStyle}>
              Gate 2
            </th>
            <th scope="col" style={headCellStyle}>
              Verdict
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.fold_index}>
              <th scope="row" style={{ ...cellStyle, fontFamily: theme.font.mono }}>
                {row.fold_index}
              </th>
              <td style={cellStyle}>{row.skipped ? "Skipped" : "Ran"}</td>
              <td style={{ ...cellStyle, fontFamily: theme.font.mono }}>{row.sample_size}</td>
              <td style={cellStyle}>{formatPassFlag(row.gate1_passed)}</td>
              <td style={cellStyle}>{formatPassFlag(row.gate2_passed)}</td>
              <td style={cellStyle}>
                <FoldVerdictCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
