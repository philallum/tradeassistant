/**
 * GateVerdictCard — the model-vs-baseline PASS/CUT visual for one `gate_verdicts` row
 * (Req 9.7).
 *
 * Renders a single persisted {@link GateVerdictRow} verbatim (Req 9.10, 20.1): the overall
 * PASS/CUT `verdict`, and the gate-1 / gate-2 model-vs-baseline figures. Nothing is
 * recomputed — every number and flag is read straight off the row and formatted for display
 * by the pure helpers in `./format`.
 *
 * Accessibility: the verdict is conveyed by TEXT ("PASS"/"CUT") and a SHAPE glyph (✓/✕),
 * never by color alone (Req 18.3). The semantic color is a reinforcement only. The two gate
 * sections are laid out as labeled definition-style rows so a screen reader reads
 * model/baseline/outcome in order.
 */

import type { GateVerdictRow } from "../../api/endpoints";
import { theme } from "../../theme/darkTheme";
import {
  formatDeltaPp,
  formatFigure,
  formatPassFlag,
  formatVerdict,
  verdictGlyph,
} from "./format";

export interface GateVerdictCardProps {
  /** The persisted gate verdict row to render verbatim. */
  readonly row: GateVerdictRow;
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

/** A single gate panel: model vs baseline figures plus the gate's pass/fail outcome. */
function GatePanel({
  title,
  model,
  baseline,
  extraLabel,
  extraValue,
  passed,
}: {
  readonly title: string;
  readonly model: string;
  readonly baseline: string;
  readonly extraLabel: string;
  readonly extraValue: string;
  readonly passed: boolean | null;
}): JSX.Element {
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: 0,
        background: theme.colors.surfaceRaised,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.sm,
        padding: theme.spacing.md,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.sm,
      }}
    >
      <h4 style={{ margin: 0, fontSize: 13, color: theme.colors.textSecondary }}>{title}</h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.spacing.md }}>
        <Figure label="Model" value={model} />
        <Figure label="Baseline" value={baseline} />
        <Figure label={extraLabel} value={extraValue} />
      </div>
      <div style={{ fontSize: 13, color: theme.colors.textPrimary }}>
        Outcome: <strong>{formatPassFlag(passed)}</strong>
      </div>
    </div>
  );
}

export function GateVerdictCard({ row }: GateVerdictCardProps): JSX.Element {
  const isPass = row.verdict === "PASS";
  const verdictColor = isPass ? theme.semantic.success : theme.semantic.danger;

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
      {/* Verdict badge: text + shape glyph, color only reinforcing (Req 18.3). */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.md, flexWrap: "wrap" }}>
        <span
          // The glyph + label together name the verdict; the aria-label makes the shape's
          // meaning explicit to assistive tech without depending on color.
          role="img"
          aria-label={`Gate verdict: ${formatVerdict(row.verdict)}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
            borderRadius: theme.radius.sm,
            border: `1px solid ${verdictColor}`,
            color: verdictColor,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          <span aria-hidden="true">{verdictGlyph(row.verdict)}</span>
          <span>{formatVerdict(row.verdict)}</span>
        </span>
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

      {/* Model-vs-baseline figures for both gates (Req 9.7). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.spacing.md }}>
        <GatePanel
          title="Gate 1 — accuracy"
          model={formatFigure(row.gate1_model_acc)}
          baseline={formatFigure(row.gate1_baseline_acc)}
          extraLabel="Delta"
          extraValue={formatDeltaPp(row.gate1_delta_pp)}
          passed={row.gate1_passed}
        />
        <GatePanel
          title="Gate 2 — risk-adjusted"
          model={formatFigure(row.gate2_model_ra)}
          baseline={formatFigure(row.gate2_baseline_ra)}
          extraLabel="Margin"
          extraValue={formatFigure(row.gate2_margin)}
          passed={row.gate2_passed}
        />
      </div>

      {/* Verbatim context fields for the walk-forward window. */}
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
        <dt style={{ color: theme.colors.textMuted }}>Selected horizon</dt>
        <dd style={{ margin: 0 }}>
          {row.selected_horizon === null ? "—" : String(row.selected_horizon)}
        </dd>
        <dt style={{ color: theme.colors.textMuted }}>Test window</dt>
        <dd style={{ margin: 0 }}>
          {row.split_test_start} → {row.split_test_end}
        </dd>
      </dl>
    </article>
  );
}
