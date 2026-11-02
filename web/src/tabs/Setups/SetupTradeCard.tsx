/**
 * A re-organised firing card (R10.1, R10.3, R1.7): per pair, a FORECAST group and a TRADE
 * group, each explicitly labelled, with an explicit "un-validated" marker beside any value
 * not yet validated OOS. Values come verbatim from the pure {@link SetupTradeVM}; nothing is
 * recomputed here. The marker is TEXT (not color alone).
 */
import type { SetupTradeVM } from "../../pure/shapeSetupTrades";
import { formatConfidence, formatDirection, formatPips } from "../../pure/format";
import { theme } from "../../theme/darkTheme";

export const UNVALIDATED_MARKER = "un-validated";
const MISSING = "\u2014";

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

function Group({
  label,
  children,
}: {
  label: "FORECAST" | "TRADE";
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <h4
        style={{
          margin: `0 0 ${theme.spacing.xs}px 0`,
          fontSize: 12,
          letterSpacing: 1,
          color: theme.colors.textSecondary,
        }}
      >
        {label}
      </h4>
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
        {children}
      </dl>
    </div>
  );
}

export function SetupTradeCard({ vm }: { vm: SetupTradeVM }): JSX.Element {
  const { forecast, trade } = vm;
  const pips = (v: number | null): string => (v === null ? MISSING : formatPips(v));
  const agreement =
    forecast.historicalAgreement === null
      ? MISSING
      : `${Math.round(forecast.historicalAgreement * 100)}%`;
  const expectancy =
    trade.netExpectancyPips.value === null
      ? "not measured"
      : `${trade.netExpectancyPips.value.toFixed(1)} pips`;

  return (
    <li
      aria-label={`${vm.pair} setup. Forecast ${formatDirection(forecast.direction)}, ${forecast.horizon} day horizon.${
        vm.anyUnvalidated ? " Contains un-validated values." : ""
      }`}
      style={{
        listStyle: "none",
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderLeft: `4px solid ${theme.direction[forecast.direction]}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.sm,
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 700, color: theme.colors.textPrimary }}>
        {vm.pair}
      </span>
      <Group label="FORECAST">
        <Field label="Direction" value={formatDirection(forecast.direction)} />
        <Field label="Horizon" value={`${forecast.horizon}d`} />
        <Field
          label="Confidence"
          value={formatConfidence(forecast.confidence.value)}
          validated={forecast.confidence.validated}
        />
        <Field label="Analogues" value={String(forecast.analogueCount)} />
        <Field label="Historical agreement" value={agreement} />
      </Group>
      <Group label="TRADE">
        <Field label="Entry" value={trade.entryAssumption ?? MISSING} />
        <Field
          label="Stop loss"
          value={pips(trade.stopLossPips.value)}
          validated={trade.stopLossPips.validated}
        />
        <Field
          label="Take profit"
          value={pips(trade.takeProfitPips.value)}
          validated={trade.takeProfitPips.validated}
        />
        <Field label="Horizon expiry" value={trade.horizonExpiry ?? MISSING} />
        <Field
          label="Net expectancy"
          value={expectancy}
          validated={trade.netExpectancyPips.validated}
        />
      </Group>
    </li>
  );
}
