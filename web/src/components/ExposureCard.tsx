/**
 * ExposureCard — the combined currency exposure of the day's firing setups.
 *
 * Presentation only: every string comes verbatim from `shapeExposure`. Information, not
 * advice: it names the net legs (for example "Long USD x3") and says plainly when several
 * setups are really one bet. It is rendered only when two or more setups fired.
 */
import type { JSX } from "react";

import type { ExposureVM } from "../pure/shapeExposure";
import { theme } from "../theme/darkTheme";

export interface ExposureCardProps {
  readonly vm: ExposureVM | null;
}

export function ExposureCard({ vm }: ExposureCardProps): JSX.Element | null {
  if (vm === null) return null;
  return (
    <section
      aria-label="Currency exposure"
      data-testid="exposure-card"
      data-concentrated={vm.concentrated ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: theme.spacing.md,
        background: theme.colors.surface,
        border: `1px solid ${vm.concentrated ? theme.semantic.warning : theme.colors.border}`,
        borderRadius: theme.radius.md,
        minWidth: 0,
      }}
    >
      <strong style={{ fontSize: 14 }}>
        {vm.concentrated ? <span aria-hidden="true">⚠ </span> : null}
        {vm.headline}
      </strong>
      <ul style={{ margin: 0, paddingLeft: theme.spacing.lg, fontSize: 13, color: theme.colors.textSecondary }}>
        {vm.legs.map((leg) => (
          <li key={leg.currency}>{leg.text}</li>
        ))}
      </ul>
      {vm.note !== null ? (
        <span data-testid="exposure-note" style={{ fontSize: 13, color: theme.colors.textPrimary }}>
          {vm.note}
        </span>
      ) : null}
    </section>
  );
}
