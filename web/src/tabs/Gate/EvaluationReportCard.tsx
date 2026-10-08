/**
 * EvaluationReportCard — the human-read measurement visual for one evaluation report (R1.2).
 *
 * Renders a persisted {@link EvaluationReportRow} verbatim (R1.2, 20.1): the config, the
 * out-of-sample window, the matched sample size and predictions count, and the model vs
 * baseline directional accuracy with the delta between them. It emits NO PASS/CUT verdict
 * (R1.3) — the card presents metrics for human interpretation, never an automated
 * alive/dead decision (R2.4).
 */

import type { EvaluationReportRow } from "../../api/types";
import { theme } from "../../theme/darkTheme";
import { formatAccuracy, formatDeltaPp } from "./format";

export interface EvaluationReportCardProps {
  /** The persisted evaluation-report row to render verbatim. */
  readonly row: EvaluationReportRow;
}

/** One labeled figure cell (label above a verbatim value). */
function Figure({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{label}</span>
      <span style={{ fontSize: 14, color: theme.colors.textPrimary, fontFamily: theme.font.mono }}>
        {value}
      </span>
    </div>
  );
}

export function EvaluationReportCard({ row }: EvaluationReportCardProps): JSX.Element {
  return (
    <article
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.md, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12, color: theme.colors.textMuted }}>Config</span>
          <span style={{ fontSize: 13, color: theme.colors.textSecondary, fontFamily: theme.font.mono }}>
            {row.config_id}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: theme.colors.textMuted }}>Sample size</span>
          <span style={{ fontSize: 13, color: theme.colors.textSecondary, fontFamily: theme.font.mono }}>
            {row.sample_size}
          </span>
        </div>
      </div>

      {/* Model-vs-baseline directional accuracy + the delta between them (R1.2). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.spacing.md }}>
        <Figure label="Model accuracy" value={formatAccuracy(row.model_accuracy)} />
        <Figure label="Baseline accuracy" value={formatAccuracy(row.baseline_accuracy)} />
        <Figure label="Delta vs baseline" value={formatDeltaPp(row.delta_vs_baseline)} />
        <Figure label="Predictions" value={String(row.predictions_count)} />
      </div>

      {/* Verbatim out-of-sample window context. */}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: `${theme.spacing.xs}px ${theme.spacing.md}px`,
          margin: 0,
          fontSize: 12,
          color: theme.colors.textSecondary,
        }}
      >
        <dt style={{ color: theme.colors.textMuted }}>Test window</dt>
        <dd style={{ margin: 0 }}>
          {row.split_test_start} → {row.split_test_end}
        </dd>
      </dl>
    </article>
  );
}
