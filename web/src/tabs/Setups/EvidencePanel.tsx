/**
 * Historical evidence block (R10.4): analogues and their outcomes, rendered BEFORE and more
 * prominently than any AI commentary. Values come verbatim from the pure {@link EvidenceVM}.
 */
import type { EvidenceVM } from "../../pure/shapeEvidence";
import { theme } from "../../theme/darkTheme";

export function EvidencePanel({ items }: { items: readonly EvidenceVM[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="setups-evidence-heading"
      data-testid="evidence-panel"
      style={{ marginBottom: theme.spacing.lg }}
    >
      <h3
        id="setups-evidence-heading"
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: theme.colors.textPrimary,
          margin: `0 0 ${theme.spacing.sm}px 0`,
        }}
      >
        Historical evidence
      </h3>
      <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: theme.spacing.sm }}>
        {items.map((e) => (
          <li
            key={e.pair}
            style={{
              listStyle: "none",
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              fontSize: 14,
              color: theme.colors.textPrimary,
            }}
          >
            <strong>{e.pair}</strong>
            {" — "}
            {e.analogueCount} matured analogue{e.analogueCount === 1 ? "" : "s"} ({e.horizon}d horizon)
            {e.analogueCount > 0 && e.classifiable ? (
              <div style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
                Reached target only: {e.targetOnly} · stop only: {e.stopOnly} · both (order
                unresolved): {e.ambiguous} · neither: {e.neither}
              </div>
            ) : null}
            {e.analogueCount > 0 && !e.classifiable ? (
              <div style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
                No stop/target on this setup, so outcomes are not classified.
              </div>
            ) : null}
            {e.ledger !== null ? (
              <div style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
                Simulated trades: {e.ledger.tradeCount} · win rate{" "}
                {Math.round(e.ledger.winRate * 100)}% · ambiguous{" "}
                {Math.round(e.ledger.ambiguousShare * 100)}% · expired{" "}
                {Math.round(e.ledger.expiredShare * 100)}%
              </div>
            ) : (
              <div style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
                Simulated trade outcomes not yet measured.
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
