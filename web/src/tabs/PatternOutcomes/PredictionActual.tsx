/**
 * Prediction-versus-actual panel (Req 10.1, 10.2, 10.3) — the most-recent matured outcome.
 *
 * Renders the {@link PredictionActualVM} from the pure `shapePredictionActual` shaper, which
 * has already selected the most-recent MATURED `realized_outcomes` row (Req 10.3) and copied
 * every field VERBATIM (Req 10.4, 20.1). This component only formats and lays out those
 * values side by side (predicted vs actual, Req 10.1):
 *
 *   - When the shaper reports `pending` (the selected row's `matured` flag is false), the
 *     actual column shows an explicit "pending" marker and NO realized direction/excursion
 *     is fabricated (Req 10.2).
 *   - When `hasData` is false (no `realized_outcomes` row at all) a non-secret "no data"
 *     line is shown rather than a blank panel.
 *
 * It is rendered as an accessible comparison table so the values are available as text
 * (Req 18.4) and direction is conveyed as text, not color alone (Req 18.3).
 */

import type { JSX } from "react";

import { formatConfidence, formatDirection, formatPips } from "../../pure/format";
import type { PredictionActualVM } from "../../pure/shapePredictionActual";
import { theme } from "../../theme/darkTheme";

export interface PredictionActualProps {
  /** The verbatim prediction-vs-actual view model from the pure shaper. */
  readonly vm: PredictionActualVM;
}

/** Explicit pending marker for an unmatured outcome (Req 10.2) — never a fabricated value. */
const PENDING = "Pending — not yet matured";

const cell: React.CSSProperties = {
  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  borderBottom: `1px solid ${theme.colors.border}`,
  textAlign: "left",
};

const headCell: React.CSSProperties = {
  ...cell,
  color: theme.colors.textPrimary,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export function PredictionActual({ vm }: PredictionActualProps): JSX.Element {
  if (!vm.hasData || vm.predicted === null) {
    return (
      <p style={{ color: theme.colors.textMuted, margin: 0 }}>
        No prediction-versus-actual data for this pair.
      </p>
    );
  }

  const { predicted, actual, pending, decisionDate, horizon } = vm;

  return (
    <div>
      <p style={{ margin: `0 0 ${theme.spacing.sm}px`, color: theme.colors.textSecondary }}>
        Most recent matured outcome
        {decisionDate !== null ? ` — ${decisionDate}` : ""}
        {horizon !== null ? ` (horizon ${horizon})` : ""}
      </p>
      <div style={{ overflowX: "auto" }}>
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
              color: theme.colors.textMuted,
              fontSize: 12,
              paddingBottom: theme.spacing.xs,
            }}
          >
            Predicted outcome versus actual realized outcome.
          </caption>
          <thead>
            <tr>
              <th scope="col" style={headCell}>
                Field
              </th>
              <th scope="col" style={headCell}>
                Predicted
              </th>
              <th scope="col" style={headCell}>
                Actual
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" style={headCell}>
                Direction
              </th>
              <td style={cell}>{formatDirection(predicted.direction)}</td>
              <td style={cell}>
                {pending || actual === null
                  ? PENDING
                  : formatDirection(actual.direction)}
              </td>
            </tr>
            <tr>
              <th scope="row" style={headCell}>
                Earned confidence
              </th>
              <td style={cell}>{formatConfidence(predicted.earnedConfidence)}</td>
              <td style={cell}>—</td>
            </tr>
            <tr>
              <th scope="row" style={headCell}>
                Favorable (MFE)
              </th>
              <td style={cell}>—</td>
              <td style={cell}>
                {pending || actual === null ? PENDING : `${actual.mfePips} pips`}
              </td>
            </tr>
            <tr>
              <th scope="row" style={headCell}>
                Adverse (MAE)
              </th>
              <td style={cell}>—</td>
              <td style={cell}>
                {pending || actual === null ? PENDING : `${actual.maePips} pips`}
              </td>
            </tr>
            <tr>
              <th scope="row" style={headCell}>
                Stop loss
              </th>
              <td style={cell}>{formatPips(predicted.stopLossPips)}</td>
              <td style={cell}>—</td>
            </tr>
            <tr>
              <th scope="row" style={headCell}>
                Take profit
              </th>
              <td style={cell}>{formatPips(predicted.takeProfitPips)}</td>
              <td style={cell}>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
