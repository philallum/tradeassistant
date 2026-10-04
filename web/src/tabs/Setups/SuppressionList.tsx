/**
 * The Suppression list for the Setups tab (Req 8.5, 9.3, 9.4).
 *
 * Renders one entry per {@link SuppressionVM} produced by the pure `shapeDashboardView`
 * shaper. Suppressions are ALWAYS cross-pair — the shaper never filters them by the active
 * pair (Req 8.5) — so this list shows every suppressed pair for the Decision_Date
 * regardless of the Pair_Selector. Each entry displays the suppressed pair and the
 * `suppression_reason` verbatim (Req 9.4); when the reason is `currency_concentration` it
 * additionally renders the competing same-currency pairs from `competing_pairs` so that
 * relationship stays visible (Req 8.5, 9.3). This component recomputes nothing (Req 20.1).
 *
 * "Suppressed" status is conveyed by TEXT (the explicit "Suppressed" label + the reason
 * phrase) and a non-color SHAPE glyph (⦸), never by color alone (Req 18.3). The reason
 * literal is mapped to a short human phrase for display; the mapping is total over the five
 * persisted reasons and introduces no new reasons.
 */

import type { SuppressionVM } from "../../pure/shapeDashboard";
import { theme } from "../../theme/darkTheme";

/** The five persisted suppression reasons (the non-null `suppression_reason` domain). */
type Reason = SuppressionVM["reason"];

export interface SuppressionListProps {
  /** The cross-pair suppression entries to render (any order; may be empty). */
  readonly suppressions: readonly SuppressionVM[];
}

/**
 * Human-readable phrase for each suppression reason. Total over the five persisted literals
 * (`news`, `currency_concentration`, `below_floor`, `not_fired`, `too_choppy`); it only
 * relabels the stored value for display and fabricates nothing (Req 9.4, 20.1).
 */
function reasonPhrase(reason: Reason): string {
  switch (reason) {
    case "news":
      return "News embargo";
    case "currency_concentration":
      return "Currency concentration";
    case "below_floor":
      return "Below confidence floor";
    case "not_fired":
      return "Did not fire";
    case "too_choppy":
      return "Too choppy";
  }
}

/** One suppression entry: pair + reason, plus competing pairs for currency concentration. */
function SuppressionItem({ suppression }: { suppression: SuppressionVM }): JSX.Element {
  const phrase = reasonPhrase(suppression.reason);
  const competing =
    suppression.reason === "currency_concentration" &&
    suppression.competingPairs !== null &&
    suppression.competingPairs.length > 0
      ? suppression.competingPairs
      : null;

  const ariaLabel =
    `${suppression.pair} suppressed. Reason: ${phrase}.` +
    (competing !== null ? ` Competing pairs: ${competing.join(", ")}.` : "");

  return (
    <li
      aria-label={ariaLabel}
      style={{
        listStyle: "none",
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderLeft: `4px solid ${theme.semantic.neutral}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.xs,
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
        <span style={{ fontSize: 16, fontWeight: 700, color: theme.colors.textPrimary }}>
          {suppression.pair}
        </span>
        {/* Suppressed status: shape glyph + explicit text, not color alone (Req 18.3). */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.spacing.xs,
            fontSize: 13,
            fontWeight: 600,
            color: theme.colors.textSecondary,
          }}
        >
          <span aria-hidden="true">{"\u29B8"}</span>
          <span>Suppressed</span>
        </span>
      </div>

      <span style={{ fontSize: 14, color: theme.colors.textPrimary }}>{phrase}</span>

      {competing !== null && (
        <div style={{ fontSize: 13, color: theme.colors.textSecondary }}>
          <span>Competing pairs: </span>
          <span style={{ fontFamily: theme.font.mono, color: theme.colors.textPrimary }}>
            {competing.join(", ")}
          </span>
        </div>
      )}
    </li>
  );
}

export function SuppressionList({ suppressions }: SuppressionListProps): JSX.Element | null {
  if (suppressions.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="setups-suppressions-heading">
      <h3
        id="setups-suppressions-heading"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: theme.colors.textSecondary,
          margin: `0 0 ${theme.spacing.sm}px 0`,
        }}
      >
        Suppressions
      </h3>
      <ul
        style={{
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.sm,
        }}
      >
        {suppressions.map((s) => (
          <SuppressionItem key={`${s.pair}:${s.reason}`} suppression={s} />
        ))}
      </ul>
    </section>
  );
}
