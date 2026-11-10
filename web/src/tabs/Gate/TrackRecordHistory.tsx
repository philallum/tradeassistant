/**
 * TrackRecordHistory — read-only historical record of fired setups, shown on the Evaluation
 * detail view beneath the model-vs-baseline report.
 *
 * Reads the snapshot's `realizedOutcomes` journal and renders the output of
 * `shapeHitRateHistory` verbatim: overall / per-pair / per-confidence-band hit rates (each with
 * its sample size) and a newest-first ledger. It recomputes nothing and states plainly that it
 * is a historical record, not a probability. The loader is injected for testability and a
 * failed load shows a fixed, non-secret message.
 */
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { getSnapshot } from "../../api/snapshotCache";
import type { RealizedOutcomeRow } from "../../api/types";
import { shapeHitRateHistory, type HitRateBucket } from "../../pure/shapeHitRateHistory";
import { theme } from "../../theme/darkTheme";

export type RealizedOutcomesLoader = (options?: {
  readonly signal?: AbortSignal;
}) => Promise<readonly RealizedOutcomeRow[]>;

const defaultLoader: RealizedOutcomesLoader = async (options) => {
  const snapshot = await getSnapshot(0, {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
  return snapshot.realizedOutcomes;
};

export interface TrackRecordHistoryProps {
  readonly loadRealizedOutcomes?: RealizedOutcomesLoader;
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly rows: readonly RealizedOutcomeRow[] };

export function TrackRecordHistory({
  loadRealizedOutcomes = defaultLoader,
}: TrackRecordHistoryProps): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadRealizedOutcomes({ signal: controller.signal }).then(
      (rows) => {
        if (!controller.signal.aborted) setState({ kind: "ready", rows });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      },
    );
    return () => controller.abort();
  }, [loadRealizedOutcomes]);

  const vm = useMemo(
    () => (state.kind === "ready" ? shapeHitRateHistory(state.rows) : null),
    [state],
  );

  return (
    <section
      aria-labelledby="track-record-heading"
      data-testid="track-record-history"
      style={{
        padding: `0 ${theme.spacing.lg}px ${theme.spacing.lg}px`,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
        color: theme.colors.textSecondary,
      }}
    >
      <h3 id="track-record-heading" style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>
        Record of fired setups
      </h3>

      {state.kind === "loading" && (
        <p role="status" style={{ margin: 0 }}>
          Loading record…
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" style={{ margin: 0, color: theme.colors.textPrimary }}>
          The track record could not be loaded.
        </p>
      )}

      {vm !== null && (
        <>
          <p style={{ margin: 0, fontSize: 12, color: theme.colors.textMuted }}>{vm.label}</p>
          {!vm.available ? (
            <p style={{ margin: 0 }}>
              No fired setups have matured yet.
              {vm.pending > 0 ? ` ${vm.pending} still pending.` : ""}
            </p>
          ) : (
            <>
              <p style={{ margin: 0, color: theme.colors.textPrimary }}>
                Right {vm.overall.rateText} of {vm.overall.n} decided setups
                {vm.pending > 0 ? ` (${vm.pending} pending)` : ""}.
              </p>
              {vm.caution !== null && (
                <p style={{ margin: 0, fontSize: 12, color: theme.colors.textMuted }}>{vm.caution}</p>
              )}
              <BucketTable caption="By pair" firstHeader="Pair" buckets={vm.byPair} />
              <BucketTable caption="By confidence band" firstHeader="Earned confidence" buckets={vm.byBand} />
              <table style={tableStyle}>
                <caption style={captionStyle}>Most recent decided setups</caption>
                <thead>
                  <tr>
                    <th scope="col" style={cellStyle}>Date</th>
                    <th scope="col" style={cellStyle}>Pair</th>
                    <th scope="col" style={cellStyle}>Predicted</th>
                    <th scope="col" style={cellStyle}>Realized</th>
                    <th scope="col" style={cellStyle}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.recent.map((e) => (
                    <tr key={`${e.pair}-${e.decisionDate}`}>
                      <td style={cellStyle}>{e.decisionDate}</td>
                      <td style={cellStyle}>{e.pair}</td>
                      <td style={cellStyle}>{e.predicted}</td>
                      <td style={cellStyle}>{e.realized}</td>
                      <td style={cellStyle}>{e.right ? "Right" : "Wrong"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}

function BucketTable(props: {
  readonly caption: string;
  readonly firstHeader: string;
  readonly buckets: readonly HitRateBucket[];
}): JSX.Element {
  return (
    <table style={tableStyle}>
      <caption style={captionStyle}>{props.caption}</caption>
      <thead>
        <tr>
          <th scope="col" style={cellStyle}>{props.firstHeader}</th>
          <th scope="col" style={cellStyle}>Right</th>
          <th scope="col" style={cellStyle}>Setups</th>
        </tr>
      </thead>
      <tbody>
        {props.buckets.map((b) => (
          <tr key={b.label}>
            <th scope="row" style={{ ...cellStyle, fontWeight: 400 }}>{b.label}</th>
            <td style={cellStyle}>{b.rateText}</td>
            <td style={cellStyle}>
              {b.n}
              {b.smallSample ? " (small sample)" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: 13,
};

const captionStyle: React.CSSProperties = {
  textAlign: "left",
  padding: `${theme.spacing.xs}px 0`,
  color: theme.colors.textSecondary,
  fontWeight: 600,
};

const cellStyle: React.CSSProperties = {
  textAlign: "left",
  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  borderBottom: `1px solid ${theme.colors.border}`,
};
