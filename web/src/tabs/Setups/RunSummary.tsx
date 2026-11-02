/**
 * Run-completion summary for the Setups tab's SILENT (no-fire) state (schema v2).
 *
 * The dashboard is silent by design when nothing is actionable, but a bare "No setups fired"
 * notice could not be told apart from a broken or missing run. This component renders an
 * AFFIRMATIVE run-completion summary from the snapshot's `pairEvaluations` slice (shaped by
 * the pure `shapeRunSummary`): a headline confirming the run completed and evaluated every
 * pair, plus a per-pair readout of each pair's deterministic direction, earned confidence
 * (and how far it sat from the firing threshold), and displayed choppiness. Every value is
 * drawn VERBATIM from the view model; this component recomputes nothing (Req 9.10, 20.1).
 *
 * Direction is conveyed by TEXT + a SHAPE glyph (▲/▼/■), not color alone (Req 18.3). The
 * readout is a real table with scope headers so assistive tech can navigate it.
 */

import type { Direction } from "../../api/types";
import { formatConfidence, formatDirection } from "../../pure/format";
import type { RunSummaryViewModel } from "../../pure/shapeRunSummary";
import { theme } from "../../theme/darkTheme";

export interface RunSummaryProps {
  /** The run-completion view model (already shaped + verbatim from the snapshot). */
  readonly summary: RunSummaryViewModel;
}

/** Non-color shape glyph for a Direction_Class (Req 18.3): ▲ up, ▼ down, ■ flat. */
function directionGlyph(direction: Direction): string {
  switch (direction) {
    case "UP":
      return "\u25B2";
    case "DOWN":
      return "\u25BC";
    case "FLAT":
      return "\u25A0";
  }
}

/** Format the signed gap-to-threshold as a whole-percentage-point string (e.g. "-11 pp"). */
function formatGap(gap: number): string {
  const pp = Math.round(gap * 100);
  const sign = pp > 0 ? "+" : ""; // negatives already carry "-"
  return `${sign}${pp} pp`;
}

const cellStyle: React.CSSProperties = {
  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  textAlign: "left",
  fontSize: 14,
  borderBottom: `1px solid ${theme.colors.border}`,
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 12,
  fontWeight: 600,
  color: theme.colors.textSecondary,
};

export function RunSummary({ summary }: RunSummaryProps): JSX.Element {
  const dateLabel = summary.decisionDate ?? "the latest run";
  const thresholdPct = formatConfidence(summary.threshold);

  // Affirmative, non-alarming headline: the run DID complete; nothing cleared the bar.
  const headline =
    `Run completed for ${dateLabel}. Evaluated ${summary.evaluatedCount} ` +
    `pair${summary.evaluatedCount === 1 ? "" : "s"}; ` +
    `${summary.firedCount} met the ${thresholdPct} confidence threshold.`;

  return (
    <section aria-labelledby="run-summary-heading" style={{ marginBottom: theme.spacing.lg }}>
      <h3
        id="run-summary-heading"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: theme.colors.textPrimary,
          margin: `0 0 ${theme.spacing.sm}px 0`,
        }}
      >
        Daily run status
      </h3>

      {/* Live region so a screen reader announces the completion state on load/refresh. */}
      <p
        role="status"
        aria-live="polite"
        style={{
          margin: `0 0 ${theme.spacing.md}px 0`,
          fontSize: 15,
          color: theme.colors.textSecondary,
        }}
      >
        {headline}
      </p>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.md,
          overflow: "hidden",
        }}
      >
        <caption
          style={{
            captionSide: "top",
            textAlign: "left",
            fontSize: 12,
            color: theme.colors.textSecondary,
            padding: `0 0 ${theme.spacing.xs}px 0`,
          }}
        >
          Per-pair evaluation — direction and earned confidence vs the {thresholdPct}{" "}
          threshold. Display-only.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={headStyle}>Pair</th>
            <th scope="col" style={headStyle}>Direction</th>
            <th scope="col" style={headStyle}>Confidence</th>
            <th scope="col" style={headStyle}>vs threshold</th>
          </tr>
        </thead>
        <tbody>
          {summary.pairs.map((p) => {
            const directionColor = theme.direction[p.direction];
            return (
              <tr key={p.pair}>
                <th
                  scope="row"
                  style={{ ...cellStyle, fontWeight: 700, color: theme.colors.textPrimary }}
                >
                  {p.pair}
                </th>
                <td style={{ ...cellStyle, color: directionColor, fontFamily: theme.font.mono }}>
                  <span aria-hidden="true">{directionGlyph(p.direction)}</span>{" "}
                  {formatDirection(p.direction)}
                </td>
                <td style={{ ...cellStyle, fontFamily: theme.font.mono, color: theme.colors.textPrimary }}>
                  {formatConfidence(p.earnedConfidence)}
                </td>
                <td style={{ ...cellStyle, fontFamily: theme.font.mono, color: theme.colors.textSecondary }}>
                  {formatGap(p.gapToThreshold)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
