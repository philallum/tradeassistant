/**
 * GateTab — the Gate Category_Tab (tasks 9.4).
 *
 * Shows the model-vs-baseline gate decision for the system (Req 9.7) and the walk-forward
 * fold breakdown behind it (Req 9.8). The Gate tab is CROSS-CONFIG, not pair-scoped (design
 * Category_Tab mapping), so it ignores the Pair_Selector and sources only the two gate
 * views:
 *
 *   - `GET /gate-verdicts` (view `v_gate_verdicts`) → the headline PASS/CUT verdict with its
 *     gate-1 / gate-2 model-vs-baseline figures. The most recent verdict is surfaced.
 *   - `GET /gate-fold-verdicts?verdictId=<id>` (view `v_gate_fold_verdicts`) → the per-fold
 *     verdict + skipped status for that selected verdict.
 *
 * This component is the only impure piece of the tab: it fetches through the same-origin api
 * client and holds view state. It RECOMPUTES NOTHING — every rendered figure, flag, and
 * verdict is read verbatim from a persisted row (Req 9.10, 20.1); the pure helpers in
 * `./format` and `./selectVerdict` only format and SELECT, never derive.
 *
 * ARIA: the panel carries `role="tabpanel"`, is associated with its tab button via
 * `aria-labelledby="tab-gate"`, and renders a single `<h2>` under the app's single `<h1>`
 * (Req 18.1), matching the `TabPanelPlaceholder` pattern it replaces.
 *
 * The data loaders are injected so the tab renders and is testable without a live network;
 * they default to the real api client.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchEndpoint, type ApiOptions, type ApiResult } from "../../api/client";
import type { GateFoldVerdictRow, GateVerdictRow } from "../../api/endpoints";
import { theme } from "../../theme/darkTheme";
import { GateFoldList } from "./GateFoldList";
import { GateVerdictCard } from "./GateVerdictCard";
import { selectLatestVerdict } from "./selectVerdict";

/** Loader for `/gate-verdicts`. Injected for testability; defaults to the api client. */
export type GateVerdictsLoader = (
  options?: ApiOptions,
) => Promise<ApiResult<GateVerdictRow>>;

/** Loader for `/gate-fold-verdicts`. Injected for testability; defaults to the api client. */
export type GateFoldVerdictsLoader = (
  verdictId: string,
  options?: ApiOptions,
) => Promise<ApiResult<GateFoldVerdictRow>>;

const defaultVerdictsLoader: GateVerdictsLoader = (options) =>
  fetchEndpoint("/gate-verdicts", {}, options);

const defaultFoldsLoader: GateFoldVerdictsLoader = (verdictId, options) =>
  fetchEndpoint("/gate-fold-verdicts", { verdictId }, options);

export interface GateTabProps {
  /** Gate verdicts loader; defaults to the real `/gate-verdicts` fetch. */
  readonly loadGateVerdicts?: GateVerdictsLoader;
  /** Gate fold verdicts loader; defaults to the real `/gate-fold-verdicts` fetch. */
  readonly loadGateFoldVerdicts?: GateFoldVerdictsLoader;
}

/** Discriminated load state so the view renders loading / error / empty / ready distinctly. */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "ready";
      readonly verdict: GateVerdictRow;
      readonly folds: readonly GateFoldVerdictRow[];
    };

export function GateTab({
  loadGateVerdicts = defaultVerdictsLoader,
  loadGateFoldVerdicts = defaultFoldsLoader,
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
      const verdicts = await loadGateVerdicts();
      const verdict = selectLatestVerdict(verdicts.rows);
      if (verdict === null) {
        if (mounted.current) setState({ kind: "empty" });
        return;
      }
      // Fetch the folds for exactly the surfaced verdict (Req 9.8).
      const folds = await loadGateFoldVerdicts(verdict.id);
      if (!mounted.current) return;
      setState({ kind: "ready", verdict, folds: folds.rows });
    } catch {
      // Non-secret failure surface only — no raw payload / stack trace (Req 14.2).
      if (mounted.current) setState({ kind: "error" });
    }
  }, [loadGateVerdicts, loadGateFoldVerdicts]);

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
      <h2 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>Gate</h2>

      {state.kind === "loading" && (
        <p role="status" aria-live="polite" style={{ margin: 0 }}>
          Loading gate verdicts…
        </p>
      )}

      {state.kind === "error" && (
        <p role="alert" style={{ margin: 0, color: theme.colors.textPrimary }}>
          The gate data could not be loaded. Please try refreshing.
        </p>
      )}

      {state.kind === "empty" && (
        <p style={{ margin: 0 }}>No gate verdicts have been persisted yet.</p>
      )}

      {state.kind === "ready" && (
        <>
          <section aria-label="Model versus baseline gate verdict" style={sectionStyle}>
            <h3 style={subheadingStyle}>Model vs baseline</h3>
            <GateVerdictCard row={state.verdict} />
          </section>

          <section aria-label="Walk-forward folds" style={sectionStyle}>
            <h3 style={subheadingStyle}>Walk-forward folds</h3>
            <GateFoldList rows={state.folds} />
          </section>
        </>
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
