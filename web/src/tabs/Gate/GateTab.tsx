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
 * The tab shows no stop-loss, take-profit or net-expectancy figure: after-cost results are
 * not displayed in the UI (they are recorded in RESEARCH-LOG.md by the evaluation run).
 *
 * ARIA: the panel is a `role="region"` landmark (there is no tab bar), is named by its own heading via
 * `aria-labelledby="gate-heading"` (the tab bar is gone), and renders a single `<h2>` under the app's single `<h1>`.
 *
 * The report loader is injected so the tab renders and is testable without a live network;
 * it defaults to reading the shared snapshot.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiResult } from "../../api/snapshot";
import { getSnapshot } from "../../api/snapshotCache";
import type { EvaluationReportRow } from "../../api/types";
import { theme } from "../../theme/darkTheme";
import { EvaluationReportCard } from "./EvaluationReportCard";
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

export interface GateTabProps {
  /** Evaluation-reports loader; defaults to reading the shared snapshot. */
  readonly loadEvaluationReports?: EvaluationReportsLoader;
}

/** Discriminated load state so the view renders loading / error / empty / ready distinctly. */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly report: EvaluationReportRow };

export function GateTab({
  loadEvaluationReports = defaultReportsLoader,
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
      const reports = await loadEvaluationReports();
      const report = selectLatestReport(reports.rows);
      if (!mounted.current) return;
      setState(report === null ? { kind: "empty" } : { kind: "ready", report });
    } catch {
      // Non-secret failure surface only — no raw payload / stack trace.
      if (mounted.current) setState({ kind: "error" });
    }
  }, [loadEvaluationReports]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      role="region"
      id="gate-panel"
      aria-labelledby="gate-heading"
      tabIndex={0}
      style={{
        padding: theme.spacing.lg,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.lg,
        color: theme.colors.textSecondary,
      }}
    >
      <h2 id="gate-heading" style={{ color: theme.colors.textPrimary, marginTop: 0 }}>
        Evaluation
      </h2>

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
        <section aria-label="Model versus baseline evaluation report" style={sectionStyle}>
          <h3 style={subheadingStyle}>Directional accuracy against the naive baseline</h3>
          <EvaluationReportCard row={state.report} />
          <p style={{ margin: 0, fontSize: 12, color: theme.colors.textMuted }}>
            This is a measure of how often the direction was right, not a trading result. A lead of
            under three points over the baseline is within noise.
          </p>
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
