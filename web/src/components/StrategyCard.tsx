/**
 * One strategy card: the strategy's name, its direction and strength, what that reading means
 * in plain English, and how often the strategy has recently been right. Technical rationale
 * sits behind a native disclosure so the card stays clean.
 *
 * Presentation only: every value is copied from {@link StrategyCardVM}; nothing is recomputed.
 * Honest presentation: no direction colour is used (the system is un-validated). Direction is
 * a word plus a glyph. A card on one side of a Split gets a heavier border AND the text label
 * "Conflicting"; a display-only card gets a dashed border AND the text tag "Display-only".
 */
import type { JSX } from "react";

import type { StrategyCardVM } from "../pure/shapeStrategyCards";
import { theme } from "../theme/darkTheme";

export interface StrategyCardProps {
  readonly card: StrategyCardVM;
}

export function StrategyCard({ card }: StrategyCardProps): JSX.Element {
  const muted = !card.available || card.direction === "FLAT";
  return (
    <li
      aria-label={card.accessibleName}
      data-testid={`strategy-card-${card.strategyId}`}
      data-available={card.available ? "true" : "false"}
      data-display-only={card.displayOnly ? "true" : undefined}
      data-conflicting={card.conflicting ? "true" : undefined}
      style={{
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.xs,
        minWidth: 0,
        padding: theme.spacing.md,
        background: theme.colors.surface,
        border: `${card.conflicting ? 2 : 1}px ${card.displayOnly ? "dashed" : "solid"} ${
          card.conflicting ? theme.colors.textMuted : theme.colors.border
        }`,
        borderRadius: theme.radius.md,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>{card.title}</h3>
        <span style={{ display: "flex", gap: theme.spacing.xs, fontSize: 11, color: theme.colors.textMuted }}>
          {card.displayOnly ? <span>Display-only</span> : null}
          {card.conflicting ? <span>Conflicting</span> : null}
        </span>
      </div>

      <div
        data-testid={`strategy-card-${card.strategyId}-direction`}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: theme.spacing.sm,
          fontSize: 18,
          fontWeight: 700,
          color: muted ? theme.colors.textMuted : theme.colors.textPrimary,
        }}
      >
        <span aria-hidden="true">{card.glyph}</span>
        <span>{card.directionLabel}</span>
        {card.strengthText !== "" ? (
          <span style={{ fontSize: 12, fontWeight: 400, fontFamily: theme.font.mono, color: theme.colors.textSecondary }}>
            {card.strengthText}
          </span>
        ) : null}
      </div>

      <p style={{ margin: 0, fontSize: 14, color: theme.colors.textPrimary }}>{card.meaning}</p>

      <p
        data-testid={`strategy-card-${card.strategyId}-record`}
        data-record-kind={card.record.kind}
        style={{
          margin: 0,
          fontSize: 13,
          color: card.record.smallSample ? theme.colors.textMuted : theme.colors.textSecondary,
        }}
      >
        {card.record.text}
      </p>

      <details style={{ fontSize: 12, color: theme.colors.textMuted }}>
        <summary style={{ cursor: "pointer", minHeight: 24 }}>Technical detail</summary>
        <p style={{ margin: `${theme.spacing.xs}px 0 0 0`, fontFamily: theme.font.mono }}>{card.detail}</p>
      </details>
    </li>
  );
}
