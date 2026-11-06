/**
 * Intraday 4H validation card (schema v8): a compact block rendered BESIDE the original daily
 * forecast on the Master_Card. It makes the temporal separation explicit — the heading names
 * the intraday observation time, and the current confidence is labelled an "unvalidated
 * adjustment" so it is never read as the original prediction or as a calibrated probability.
 *
 * Presentation only: every value comes verbatim from the shaped
 * {@link IntradayValidationViewModel}; nothing is recomputed. When validation is unavailable
 * (older snapshot, the intraday Job has not run, or the pair was stale/unreachable) it renders
 * an explicit "Intraday validation unavailable" marker rather than fabricating a result.
 */
import type { JSX } from "react";

import {
  VALIDATION_UNAVAILABLE_TEXT,
  type IntradayValidationViewModel,
} from "../pure/shapeIntradayValidation";
import { theme } from "../theme/darkTheme";

export interface IntradayValidationCardProps {
  readonly pair: string;
  readonly vm: IntradayValidationViewModel;
}

export function IntradayValidationCard({ pair, vm }: IntradayValidationCardProps): JSX.Element {
  return (
    <section
      aria-label={`${pair} intraday 4H validation`}
      data-testid="intraday-validation"
      data-status={vm.status}
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
        <h3 style={{ margin: 0, fontSize: 15 }}>Intraday 4H validation</h3>
        {vm.observedAt !== null ? (
          <span style={{ fontSize: 12, color: theme.colors.textMuted }}>
            Observed {formatObserved(vm.observedAt)}
          </span>
        ) : null}
      </div>

      {vm.status === "available" ? (
        <>
          <p style={{ margin: 0, fontSize: 14, color: theme.colors.textPrimary }}>
            <span style={{ color: theme.colors.textMuted }}>Status: </span>
            <span data-testid="intraday-state" data-state={vm.state ?? ""} style={{ fontWeight: 700 }}>
              {vm.stateLabel}
            </span>
          </p>
          <p style={{ margin: 0, fontSize: 14, color: theme.colors.textPrimary }}>
            <span style={{ color: theme.colors.textMuted }}>Current confidence: </span>
            <span data-testid="intraday-current" style={{ fontWeight: 600 }}>
              {vm.currentConfidenceText}
            </span>{" "}
            <span style={{ fontSize: 12, color: theme.colors.textMuted }}>({vm.adjustmentLabel})</span>
          </p>
          <p style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>
            <span style={{ color: theme.colors.textMuted }}>Change: </span>
            <span data-testid="intraday-change" style={{ fontFamily: theme.font.mono }}>
              {vm.changeText}
            </span>
          </p>
          {vm.reason !== null ? (
            <p style={{ margin: 0, fontSize: 13, color: theme.colors.textSecondary }}>{vm.reason}</p>
          ) : null}
        </>
      ) : (
        <p data-testid="intraday-unavailable" style={{ margin: 0, fontSize: 14, color: theme.colors.textMuted }}>
          {VALIDATION_UNAVAILABLE_TEXT}
        </p>
      )}
    </section>
  );
}

/** Render the observed ISO-8601 instant as a short `HH:mm` UTC label (display-only). */
function formatObserved(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}
