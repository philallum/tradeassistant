/**
 * GateTab — the Evaluation Category_Tab.
 *
 * Under the de-scope the former PASS/CUT gate decision is reframed as a human-read
 * EVALUATION REPORT (R1): the tab surfaces the Measurement_Engine's model-vs-baseline
 * directional accuracy over an out-of-sample split, carrying NO verdict (R1.3) and no
 * automated alive/dead annotation (R2.4). It is CROSS-CONFIG, not pair-scoped, so it ignores
 * the Pair_Selector and reads only the snapshot's `evaluationReports` slice.
 *
 * This component is the only impure piece of the tab: it reads the shared `dashboard.json`
 * snapshot and holds view state. It RECOMPUTES NOTHING — every figure is read verbatim from
 * a persisted report row (R1.2, 20.1); the pure helpers in `./format` and `./selectReport`
 * only format and SELECT, never derive.
 *
 * ARIA: the panel keeps `role="tabpanel"`, is associated with its tab button via
 * `aria-labelledby="tab-gate"`, and renders a single `<h2>` under the app's single `<h1>`.
 *
 * The report loader is injected so the tab renders and is testable without a live network;
 * it defaults to reading the shared snapshot.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiResult } from "../../api/snapshot";
import { getSnapshot } from "../../api/snapshotCache";
import type { Calibration, EvaluationReportRow, TradeLedgerSummary } from "../../api/types";
import { shapeEvaluationNet, type EvaluationNetShape } from "../../pure/shapeEvaluationNet";
import { theme } from "../../theme/darkTheme";
import { EvaluationReportCard } from "./EvaluationReportCard";
import { NetEvaluationSection } from "./NetEvaluationSection";
import { selectLatestReport } from "./selectReport";

/** Loader for the evaluation reports. Injected for testability; defaults to the snapshot. */
export type EvaluationReportsLoader = (options?: {
  readonly signal?: AbortSignal;
}) => Promise<ApiResult<EvaluationReportRow>>;

const defaultReportsLoader: EvaluationReportsLoader = async (options) => {
  const snapshot = await getSnapshot(0, {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
  return {
    rows: snapshot.evaluationReports,
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

/** The v4 net-of-cost slices (empty on a v3 snapshot). */
export interface NetEvaluationSlices {
  readonly tradeLedgerSummary: TradeLedgerSummary;
  readonly calibration: Calibration;
}

/** Loader for the net-of-cost slices. Injected for testability; defaults to the snapshot. */
export type NetEvaluationLoader = (options?: {
  readonly signal?: AbortSignal;
}) => Promise<NetEvaluationSlices>;

const defaultNetLoader: NetEvaluationLoader = async (options) => {
  const snapshot = await getSnapshot(0, {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
  return { tradeLedgerSummary: snapshot.tradeLedgerSummary, calibration: snapshot.calibration };
};

export interface GateTabProps {
  /** Evaluation-reports loader; defaults to reading the shared snapshot. */
  readonly loadEvaluationReports?: EvaluationReportsLoader;
  /** Net-of-cost slices loader; defaults to reading the shared snapshot. */
  readonly loadNetEvaluation?: NetEvaluationLoader;
}

/** Discriminated load state so the view renders loading / error / empty / ready distinctly. */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "ready";
      readonly report: EvaluationReportRow | null;
      readonly net: EvaluationNetShape;
    };

export function GateTab({
  loadEvaluationReports = defaultReportsLoader,
  loadNetEvaluation = defaultNetLoader,
}: GateTabProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [reports, slices] = await Promise.all([loadEvaluationReports(), loadNetEvaluation()]);
      const report = selectLatestReport(reports.rows);
      const net = shapeEvaluationNet(slices);
      if (!mounted.current) return;
      setState(
        report === null && net.kind === "empty"
          ? { kind: "empty" }
          : { kind: "ready", report, net },
      );
    } catch {
      // Non-secret failure surface only — no raw payload / stack trace.
      if (mounted.current) setState({ kind: "error" });
    }
  }, [loadEvaluationReports, loadNetEvaluation]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      role="tabpanel"
      id="tabpanel-gate"
      aria-labelledby="tab-gate"
      tabIndex={0}
      style={{
        padding: theme.spacing.lg,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.lg,
        color: theme.colors.textSecondary,
      }}
    >
      <h2 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>Evaluation</h2>

      {state.kind === "loading" && (
        <p role="status" aria-live="polite" style={{ margin: 0 }}>
          Loading evaluation report…
        </p>
      )}

      {state.kind === "error" && (
        <p role="alert" style={{ margin: 0, color: theme.colors.textPrimary }}>
          The evaluation data could not be loaded. Please try refreshing.
        </p>
      )}

      {state.kind === "empty" && (
        <p style={{ margin: 0 }}>No evaluation reports have been recorded yet.</p>
      )}

      {state.kind === "ready" && (
        <section aria-label="Net-of-cost out-of-sample results" style={sectionStyle}>
          <h3 style={subheadingStyle}>Out-of-sample results after costs</h3>
          <NetEvaluationSection shape={state.net} />
        </section>
      )}
      {state.kind === "ready" && state.report !== null && (
        <section aria-label="Model versus baseline evaluation report" style={sectionStyle}>
          <h3 style={subheadingStyle}>Directional accuracy (secondary, un-validated as a trade result)</h3>
          <EvaluationReportCard row={state.report} />
        </section>
      )}
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing.md,
};

const subheadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: theme.colors.textSecondary,
  fontWeight: 600,
};
