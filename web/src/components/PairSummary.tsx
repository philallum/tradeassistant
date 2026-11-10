/**
 * The pair summary above the strategy cards: the conviction tier with its vote tally, the
 * pattern engine's own call, and the expected candle size. The candle size is about HOW BIG
 * the move may be, never which way.
 *
 * Presentation only: values are copied from the shaped view models. Honest presentation: the
 * system is un-validated, so no direction colour is used; the tier is a word plus a glyph.
 */
import type { JSX } from "react";

import type { ConvictionVM } from "../pure/shapeConviction";
import { tierGlyph } from "../pure/shapeConviction";
import type { PairSummaryVM } from "../pure/shapePairSummary";
import type { SilenceVM } from "../pure/shapeSilence";
import { RISK_NOTE } from "../pure/riskNote";
import { theme } from "../theme/darkTheme";

export interface PairSummaryProps {
  readonly pair: string;
  /** `null` when the pair has no confluence row. */
  readonly conviction: ConvictionVM | null;
  readonly summary: PairSummaryVM;
  /** Why the pair is silent today, or null/omitted when it fired. */
  readonly silence?: SilenceVM | null;
}

export function PairSummary({ pair, conviction, summary, silence = null }: PairSummaryProps): JSX.Element {
  const { pattern, candleSize } = summary;
  return (
    <section
      aria-label={`${pair} summary`}
      data-testid="pair-summary"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: theme.spacing.sm }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{pair}</h2>
        {conviction !== null ? (
          <span
            data-testid="pair-conviction"
            data-tier={conviction.tier}
            style={{ fontSize: 18, fontWeight: 700 }}
          >
            <span aria-hidden="true">{tierGlyph(conviction)} </span>
            {conviction.label}
          </span>
        ) : (
          <span data-testid="pair-conviction" data-tier="none" style={{ color: theme.colors.textMuted }}>
            No signal
          </span>
        )}
      </div>

      {conviction !== null ? (
        <p style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>
          <span data-testid="pair-tally" style={{ fontFamily: theme.font.mono }}>
            {conviction.tallyText}
          </span>
          {" \u2014 "}
          {conviction.explanation}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>
          There is no strategy data for this pair on this date.
        </p>
      )}

      <p data-testid="pair-pattern" style={{ margin: 0, fontSize: 14, color: theme.colors.textPrimary }}>
        {pattern.text}
      </p>
      {pattern.basisText !== null ? (
        <p data-testid="pair-basis" style={{ margin: 0, fontSize: 13, color: theme.colors.textSecondary }}>
          {pattern.basisText}
        </p>
      ) : null}
      {silence !== null ? (
        <p
          data-testid="pair-silence"
          data-reason={silence.reason}
          style={{ margin: 0, fontSize: 13, color: theme.colors.textSecondary }}
        >
          Staying silent is a result, not a fault. {silence.text}
        </p>
      ) : null}

      <div
        data-testid="candle-size"
        data-available={candleSize.available ? "true" : "false"}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingTop: theme.spacing.sm,
          borderTop: `1px solid ${theme.colors.border}`,
        }}
      >
        <span style={{ fontSize: 12, color: theme.colors.textMuted }}>Expected candle size (not direction)</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{candleSize.headline}</span>
        <span style={{ fontSize: 14, color: theme.colors.textSecondary }}>{candleSize.rangeText}</span>
        <span
          style={{
            fontSize: 13,
            color: candleSize.smallSample ? theme.colors.textMuted : theme.colors.textSecondary,
          }}
        >
          {candleSize.recordText}
          {candleSize.smallSample && candleSize.available ? " (small sample)" : ""}
        </span>
      </div>

      <p data-testid="risk-note" style={{ margin: 0, fontSize: 12, color: theme.colors.textMuted }}>
        {RISK_NOTE}
      </p>
    </section>
  );
}
