/**
 * A single surfaced firing card (Req 9.1, 9.2).
 *
 * Renders one {@link CardVM} — the pure `shapeDashboardView` shaper's projection of a
 * surfaced `firing_setups` row — showing the pair, Direction_Class, Horizon,
 * Earned_Confidence, and the Stop_Loss / Take_Profit pip values (Req 9.1). Every value is
 * drawn VERBATIM from the card view model (which itself copied the row verbatim); this
 * component recomputes nothing (Req 9.10, 20.1). A null Stop_Loss / Take_Profit boundary is
 * rendered as the explicit not-actionable marker from `format.ts`, never a fabricated
 * number (Req 9.2).
 *
 * Direction_Class is conveyed by TEXT (the "Up"/"Down"/"Flat" label) and a SHAPE glyph
 * (▲/▼/■), not by color alone — color is a reinforcement only (Req 18.3, Req 18 spirit).
 * Each card is an accessible list item carrying a self-describing `aria-label` so the whole
 * card reads as one unit to assistive tech.
 */

import type { CardVM } from "../../pure/shapeDashboard";
import type { Direction } from "../../api/endpoints";
import { formatConfidence, formatDirection, formatPips } from "../../pure/format";
import { theme } from "../../theme/darkTheme";

export interface FiringCardProps {
  /** The surfaced card view model to render (fields already verbatim from the row). */
  readonly card: CardVM;
}

/**
 * A non-color shape glyph for a Direction_Class, so the direction is distinguishable
 * without relying on color (Req 18.3): up triangle, down triangle, square for flat.
 */
function directionGlyph(direction: Direction): string {
  switch (direction) {
    case "UP":
      return "\u25B2"; // ▲
    case "DOWN":
      return "\u25BC"; // ▼
    case "FLAT":
      return "\u25A0"; // ■
  }
}

/** One labelled field row inside the card (a term/value pair for the detail grid). */
function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt
        style={{
          fontSize: 12,
          color: theme.colors.textSecondary,
          margin: 0,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          fontSize: 15,
          color: theme.colors.textPrimary,
          margin: 0,
          fontFamily: theme.font.mono,
        }}
      >
        {value}
      </dd>
    </>
  );
}

export function FiringCard({ card }: FiringCardProps): JSX.Element {
  const directionLabel = formatDirection(card.direction);
  const directionColor = theme.direction[card.direction];
  const confidence = formatConfidence(card.earnedConfidence);
  const stopLoss = formatPips(card.stopLossPips);
  const takeProfit = formatPips(card.takeProfitPips);

  // A single self-describing label so a screen reader announces the card as one unit.
  const ariaLabel =
    `${card.pair} firing setup. Direction ${directionLabel}. ` +
    `Horizon ${card.horizon} day${card.horizon === 1 ? "" : "s"}. ` +
    `Earned confidence ${confidence}. ` +
    `Stop loss ${stopLoss === "\u2014" ? "not actionable" : stopLoss}. ` +
    `Take profit ${takeProfit === "\u2014" ? "not actionable" : takeProfit}. ` +
    `Strategy ${card.strategyId}.`;

  return (
    <li
      aria-label={ariaLabel}
      style={{
        listStyle: "none",
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderLeft: `4px solid ${directionColor}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.sm,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing.sm,
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 700, color: theme.colors.textPrimary }}>
          {card.pair}
        </span>
        {/* Direction: shape glyph + text label; color only reinforces (Req 18.3). */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.spacing.xs,
            fontSize: 14,
            fontWeight: 600,
            color: directionColor,
          }}
        >
          <span aria-hidden="true">{directionGlyph(card.direction)}</span>
          <span>{directionLabel}</span>
        </span>
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: theme.spacing.md,
          rowGap: theme.spacing.xs,
          margin: 0,
          alignItems: "baseline",
        }}
      >
        <Field label="Horizon" value={`${card.horizon}d`} />
        <Field label="Confidence" value={confidence} />
        <Field label="Stop loss" value={stopLoss} />
        <Field label="Take profit" value={takeProfit} />
        <Field label="Strategy" value={card.strategyId} />
      </dl>
    </li>
  );
}
