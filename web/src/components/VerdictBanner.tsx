/**
 * Zone 2 — Verdict Banner (Req 3). Renders one {@link SetupTradeVM} produced by
 * `shapeSetupTrades`. Every value is shown as the shaper produced it, run only through the
 * existing `format.ts` formatters; nothing is recomputed or rounded here (Req 3.8).
 *
 * Direction is a text label plus a shape glyph (Req 3.7). The single Validation_Status badge
 * is driven by `vm.anyUnvalidated` and uses the same 15px size as the numeric values so it
 * is never visually subordinate to them (Req 3.9). Values are plain text: no button or
 * order-placement affordance (Req 3.10).
 *
 * A `null` vm (pair did not fire) renders only the explicit no-signal marker from
 * `pure/noSignalCopy.ts`: no direction, confidence, trade parameters or fabricated number
 * (Req 3.6, 9.6).
 */
import type { SetupTradeVM } from "../pure/shapeSetupTrades";
import { PAIR_DID_NOT_FIRE_LABEL } from "../pure/noSignalCopy";
import { formatConfidence, formatDirection, formatPips, NOT_ACTIONABLE } from "../pure/format";
import { directionGlyph } from "../tabs/Setups/FiringCard";
import { theme } from "../theme/darkTheme";

export const VALIDATED_BADGE_TEXT = "Validated";
export const UNVALIDATED_BADGE_TEXT = "Un-validated";
const UNVALIDATED_MARKER = "un-validated";

/** Inline per-field un-validated marker (same pattern as SetupTradeCard's Marker). */
function Marker(): JSX.Element {
  return (
    <span
      data-testid="unvalidated-marker"
      style={{ marginLeft: theme.spacing.xs, fontSize: 11, color: theme.semantic.warning }}
    >
      ({UNVALIDATED_MARKER})
    </span>
  );
}

function Field({
  label,
  value,
  validated,
}: {
  label: string;
  value: string;
  validated?: boolean;
}): JSX.Element {
  return (
    <>
      <dt style={{ fontSize: 12, color: theme.colors.textSecondary, margin: 0 }}>{label}</dt>
      <dd
        data-testid={`verdict-${label.toLowerCase().replace(/\s+/g, "-")}`}
        style={{
          fontSize: 15,
          color: theme.colors.textPrimary,
          margin: 0,
          fontFamily: theme.font.mono,
        }}
      >
        {value}
        {validated === false ? <Marker /> : null}
      </dd>
    </>
  );
}

export interface VerdictBannerProps {
  /** `null` when the pair did not fire: only the explicit no-signal marker is rendered. */
  readonly vm: SetupTradeVM | null;
  /** Pair label for the no-signal state (a `null` vm carries no pair). */
  readonly pair?: string;
}

export function VerdictBanner({ vm, pair }: VerdictBannerProps): JSX.Element {
  if (vm === null) {
    return (
      <section
        aria-label={`${pair ?? "Pair"} verdict`}
        data-testid="verdict-no-signal"
        style={{
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          fontSize: 15,
          color: theme.colors.textSecondary,
        }}
      >
        {PAIR_DID_NOT_FIRE_LABEL}
      </section>
    );
  }
  const { forecast, trade } = vm;
  const directionLabel = formatDirection(forecast.direction);
  const directionColor = theme.direction[forecast.direction];

  return (
    <section
      aria-label={`${vm.pair} verdict`}
      style={{
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
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        <span
          data-testid="verdict-direction"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.spacing.xs,
            fontSize: 20,
            fontWeight: 700,
            color: directionColor,
          }}
        >
          <span aria-hidden="true" data-testid="verdict-direction-glyph">
            {directionGlyph(forecast.direction)}
          </span>
          <span>{directionLabel}</span>
        </span>
        {/* One Validation_Status badge; same font size as the numeric values (15px). */}
        <span
          data-testid="validation-badge"
          style={{
            fontSize: 15,
            fontWeight: 600,
            fontFamily: theme.font.mono,
            color: vm.anyUnvalidated ? theme.semantic.warning : theme.colors.textPrimary,
            border: `1px solid ${vm.anyUnvalidated ? theme.semantic.warning : theme.colors.border}`,
            borderRadius: theme.radius.md,
            padding: `0 ${theme.spacing.sm}px`,
          }}
        >
          {vm.anyUnvalidated ? UNVALIDATED_BADGE_TEXT : VALIDATED_BADGE_TEXT}
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
        <Field label="Confidence" value={formatConfidence(forecast.confidence.value)} />
        <Field label="Entry" value={trade.entryAssumption ?? NOT_ACTIONABLE} />
        <Field
          label="Stop loss"
          value={formatPips(trade.stopLossPips.value)}
          validated={trade.stopLossPips.validated}
        />
        <Field
          label="Take profit"
          value={formatPips(trade.takeProfitPips.value)}
          validated={trade.takeProfitPips.validated}
        />
        <Field label="Net expectancy" value={formatPips(trade.netExpectancyPips.value)} />
      </dl>
    </section>
  );
}
