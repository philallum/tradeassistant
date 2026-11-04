/**
 * The 2 x 3 grid of strategy cards for the selected pair (three columns on wide viewports,
 * one column on narrow ones). Always renders six cards in a fixed order so the layout never
 * shifts between pairs. A footnote states the window the recent records cover.
 */
import type { JSX } from "react";

import type { StrategyCardVM } from "../pure/shapeStrategyCards";
import { theme } from "../theme/darkTheme";
import { StrategyCard } from "./StrategyCard";
import { useMediaQuery, WIDE_VIEWPORT_QUERY } from "./useMediaQuery";

export interface StrategyCardGridProps {
  readonly pair: string;
  readonly cards: readonly StrategyCardVM[];
  /** Trading-day window the recent records cover (0 when no record was built). */
  readonly lookbackDays: number;
}

export function StrategyCardGrid({ pair, cards, lookbackDays }: StrategyCardGridProps): JSX.Element {
  const wide = useMediaQuery(WIDE_VIEWPORT_QUERY);
  return (
    <section
      aria-label={`${pair} strategy readings`}
      data-testid="strategy-card-grid"
      style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm, minWidth: 0 }}
    >
      <ul
        style={{
          display: "grid",
          gridTemplateColumns: wide ? "repeat(3, minmax(0, 1fr))" : "minmax(0, 1fr)",
          gap: theme.spacing.md,
          margin: 0,
          padding: 0,
        }}
      >
        {cards.map((card) => (
          <StrategyCard key={card.strategyId} card={card} />
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: 12, color: theme.colors.textMuted }}>
        {lookbackDays > 0
          ? `Recent calls cover the last ${lookbackDays} trading days. A strategy is "right" when its up or down call matched the next session's close-versus-open move. Flat readings are not counted.`
          : "Recent track records are not available yet."}
      </p>
    </section>
  );
}
