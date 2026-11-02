/**
 * NetEvaluationSection — leads the Evaluation tab with out-of-sample, after-cost results
 * (trader-edge-validation R10.2, R10.3). Renders the pure {@link EvaluationNetShape}
 * verbatim; recomputes nothing. Un-validated figures carry a TEXT marker (not color alone).
 * No single metric such as directional accuracy is a headline here.
 */
import type { EvaluationNetShape } from "../../pure/shapeEvaluationNet";
import { formatPips } from "../../pure/format";
import { theme } from "../../theme/darkTheme";

const MISSING = "\u2014";

function Figure({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{label}</span>
      <span style={{ fontSize: 15, color: theme.colors.textPrimary, fontFamily: theme.font.mono }}>
        {value}
      </span>
    </div>
  );
}

const yn = (v: boolean | null): string => (v === null ? "not measured" : v ? "yes" : "no");

export function NetEvaluationSection({ shape }: { readonly shape: EvaluationNetShape }): JSX.Element {
  if (shape.kind === "empty") {
    return (
      <p style={{ margin: 0 }}>
        No net-of-cost trade results have been published yet. Any figure shown elsewhere on
        this tab is un-validated.
      </p>
    );
  }
  const s = shape.system;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.md }}>
      <p
        data-testid="net-validation-note"
        style={{ margin: 0, fontSize: 12, color: theme.semantic.warning }}
      >
        {shape.validated
          ? "Out-of-sample, after costs."
          : "Un-validated: the sample is too small to draw conclusions."}
        {shape.ledger.window !== null ? ` Window ${shape.ledger.window.from} \u2192 ${shape.ledger.window.to}.` : ""}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.spacing.lg }}>
        <Figure label="Net expectancy (after costs)" value={formatPips(s.netExpectancyPips)} />
        <Figure label="Max drawdown" value={formatPips(s.maxDrawdownPips)} />
        <Figure
          label="Profit factor"
          value={s.profitFactor === null ? MISSING : String(s.profitFactor)}
        />
        <Figure label="Trades" value={String(s.tradeCount)} />
        <Figure label="Gross expectancy (before costs)" value={formatPips(s.grossExpectancyPips)} />
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: `${theme.spacing.xs}px ${theme.spacing.md}px`,
          margin: 0,
          fontSize: 12,
        }}
      >
        <dt style={{ color: theme.colors.textMuted }}>Sample size</dt>
        <dd style={{ margin: 0 }}>
          {shape.sample.tradeCount} trades (at least {shape.sample.minRequired} needed) {MISSING}{" "}
          {shape.sample.sufficient ? "large enough" : "not large enough"}
        </dd>
        <dt style={{ color: theme.colors.textMuted }}>Consistent across time</dt>
        <dd style={{ margin: 0 }}>not measured (no per-period breakdown in this snapshot)</dd>
        <dt style={{ color: theme.colors.textMuted }}>Calibration</dt>
        <dd style={{ margin: 0 }}>
          {shape.calibration.measured
            ? `monotonic: ${yn(shape.calibration.monotonic)}; well calibrated: ${yn(shape.calibration.wellCalibrated)}`
            : "not measured"}
        </dd>
      </dl>
      <div>
        <h4 style={{ margin: `0 0 ${theme.spacing.xs}px 0`, fontSize: 12, color: theme.colors.textSecondary }}>
          Baseline comparators (identical assumptions)
        </h4>
        {shape.comparators.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12 }}>No comparator results published.</p>
        ) : (
          <>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left" }}>Strategy</th>
                  <th scope="col" style={{ textAlign: "right" }}>Net expectancy</th>
                  <th scope="col" style={{ textAlign: "right" }}>Trades</th>
                  <th scope="col" style={{ textAlign: "right" }}>System minus it</th>
                </tr>
              </thead>
              <tbody>
                {shape.comparators.map((c) => (
                  <tr key={c.strategyId}>
                    <th scope="row" style={{ textAlign: "left", fontWeight: 400 }}>{c.strategyId}</th>
                    <td style={{ textAlign: "right" }}>{formatPips(c.summary.netExpectancyPips)}</td>
                    <td style={{ textAlign: "right" }}>{c.summary.tradeCount}</td>
                    <td style={{ textAlign: "right" }}>{formatPips(c.systemMinusComparatorPips)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shape.beatsAllComparators === false && (
              <p data-testid="not-beating-baseline" style={{ margin: `${theme.spacing.xs}px 0 0 0`, fontSize: 12 }}>
                The system does not beat every baseline comparator net of costs.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
