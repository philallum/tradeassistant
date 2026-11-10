/**
 * The Dashboard_UI app shell (task 9.1).
 *
 * Composes the sticky {@link ControlBar} (Decision_Date selector + refresh button, aligned
 * on one row), and the single-window dashboard content, into one mobile-first layout
 * with no bottom tab bar (Req 1.1, 1.5, 1.6). When the `#/evaluation` hash route is open, it
 * renders the retained {@link GateTab} detail view with a back link instead (Req 8.3). It owns
 * the small amount of shell-level fetch state the header needs:
 *
 *   - the list of available Decision_Dates (from `GET /decision-dates`), which populates
 *     the Historical_Browse selector, and
 *   - an in-flight flag for the refresh control.
 *
 * Refresh re-issues the shell fetch through the api client's cache-bust transform
 * (`{ bustCache: true }`), which appends `_r=<nonce>` and sends `Cache-Control: no-cache`
 * so the proxy's cached response is bypassed (Req 17.1, 17.2). Per-tab data fetching is NOT
 * done here — each tab (tasks 9.2–9.5) fetches its own rows; the shell only wires the
 * refresh signal + the effective Decision_Date down and surfaces freshness up. This
 * component recomputes nothing.
 *
 * Shell-level loading / empty / error states (task 9.6): the `/decision-dates` fetch backs
 * the Historical_Browse selector AND decides whether there is anything to show at all, so
 * the shell renders the top-level states from it:
 *   - in-flight  → a mobile-friendly loading state, never a blank screen (Req 2.3, 14.3, 17.4)
 *   - empty set  → "No runs have been persisted yet." (Req 14.1)
 *   - fetch error → a non-secret message with retry — never a stack trace / raw payload /
 *                   blank screen; refresh recovers from it (Req 14.2, 17.5)
 *   - otherwise  → the `SingleWindowShell` (or the `#/evaluation` detail view), which owns
 *                  its own loading/empty/error states
 *
 * The data client is injected (`fetchDecisionDates`) so the shell renders and is testable
 * without a live network; it defaults to the real api client.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { EMPTY_SNAPSHOT, SnapshotError, type ApiResult } from "../api/snapshot";
import { getSnapshot } from "../api/snapshotCache";
import type { DecisionDateRow } from "../api/types";
import { selectBrowseDate } from "../pure/selectDates";
import { useSelection } from "../state/selection";
import { GateTab, TrackRecordHistory } from "../tabs/Gate";
import { theme } from "../theme/darkTheme";
import { ControlBar } from "./ControlBar";
import { EmptyState } from "./EmptyState";
import { BackLink, EvaluationDetailLink } from "./EvaluationDetailLinks";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { SingleWindowShell } from "./SingleWindowShell";
import { useEvaluationDetail } from "./useEvaluationDetail";

/** Loader for the available Decision_Dates. Injected for testability; defaults to the snapshot. */
export type DecisionDatesLoader = (options?: {
  readonly bustCache?: boolean;
  readonly signal?: AbortSignal;
  /** The shared refresh generation (the shell's refreshNonce), so all reads share one fetch. */
  readonly generation?: number;
}) => Promise<ApiResult<DecisionDateRow>>;

/**
 * Default loader: read the Decision_Dates from the shared `dashboard.json` snapshot. A
 * missing snapshot (404 — the Job has not written one yet) resolves to an EMPTY snapshot so
 * the shell shows the explicit empty/unavailable state (R5.5) rather than a transport error.
 */
const defaultLoader: DecisionDatesLoader = async (options) => {
  let snapshot;
  try {
    snapshot = await getSnapshot(options?.generation ?? 0, {
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof SnapshotError && cause.status === 404) {
      snapshot = EMPTY_SNAPSHOT;
    } else {
      throw cause;
    }
  }
  return {
    rows: snapshot.decisionDates.map((decision_date) => ({ decision_date })),
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

export interface AppShellProps {
  /** Decision_Dates loader; defaults to the real `/decision-dates` fetch. */
  readonly loadDecisionDates?: DecisionDatesLoader;
}

/** The shell's own `/decision-dates` fetch lifecycle (task 9.6 top-level states). */
type DatesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly dates: readonly string[] };

export function AppShell({ loadDecisionDates = defaultLoader }: AppShellProps): JSX.Element {
  const evaluationOpen = useEvaluationDetail();
  // The browsed Decision_Date selection (null = "use the latest"). Owned by the shared
  // selection store so it survives tab switches; the shell reads it to resolve the
  // effective date it hands to the per-pair single-date tabs.
  const { date: browsedDate } = useSelection();

  const [datesState, setDatesState] = useState<DatesState>({ kind: "loading" });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  // Bumped on each refresh so the routed tabs re-fetch with a cache-busting request
  // (Req 17.1, 17.2); the shell's own `/decision-dates` fetch busts cache on the same bump.
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  // Guards against setting state after unmount when a fetch resolves late.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (bustCache: boolean, generation: number) => {
      setIsRefreshing(true);
      // Only show the full-screen loading state on the very first load; a refresh keeps the
      // current content visible and signals in-flight via the (disabled) refresh control
      // (Req 17.4), so the viewer never flashes to a blank screen on refresh.
      setDatesState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
      try {
        const result = await loadDecisionDates(
          bustCache ? { bustCache: true, generation } : { generation },
        );
        if (!mounted.current) return;
        setDatesState({ kind: "ready", dates: result.rows.map((r) => r.decision_date) });
      } catch (cause) {
        if (!mounted.current) return;
        // Non-secret message only (Req 14.2, 17.5): the api client already sanitizes its
        // errors to fixed, credential-free strings — never a stack trace or raw payload.
        const message =
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "The dashboard data could not be loaded.";
        setDatesState({ kind: "error", message });
      } finally {
        if (mounted.current) setIsRefreshing(false);
      }
    },
    [loadDecisionDates],
  );

  // Initial shell load (generation 0, cache-allowed fetch).
  useEffect(() => {
    void load(false, 0);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshNonce((n) => {
      const next = n + 1;
      // Use the NEW generation so the shared snapshot cache re-fetches exactly once and all
      // tabs (which re-run on the same bumped refreshNonce) share that fresh snapshot.
      void load(true, next);
      return next;
    });
  }, [load]);

  // The dates available to the selector, and the effective Decision_Date handed to the
  // per-pair single-date tabs: the browsed date when present in the set, else the latest,
  // else null (pure `selectBrowseDate`, Req 7.1). Empty/loading/error resolve to no dates.
  const dates = datesState.kind === "ready" ? datesState.dates : [];
  const effectiveDate = selectBrowseDate(dates, browsedDate);

  return (
    <div
      data-refresh-nonce={refreshNonce}
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: theme.colors.background,
        color: theme.colors.textPrimary,
        fontFamily: theme.font.body,
        // Mobile-first: the whole shell is a single column; no horizontal scroll of
        // primary content (Req 1.3).
        overflowX: "hidden",
      }}
    >
      <ControlBar dates={dates} isRefreshing={isRefreshing} onRefresh={onRefresh} />

      {/*
        Routed tab content with the shell-level loading / empty / error states layered in
        front (task 9.6). The dates fetch gates the whole app: while it is in flight we show
        a loading state (never blank, Req 2.3/14.3); on failure a non-secret, retryable error
        (Req 14.2/17.5); on an empty set the "no runs persisted yet" message (Req 14.1); and
        once dates exist the active tab, which owns its own per-tab/per-pair states.
      */}
      <main style={{ flex: "1 1 auto", minWidth: 0 }}>
        {datesState.kind === "loading" ? (
          <LoadingState label="Loading dashboard…" />
        ) : datesState.kind === "error" ? (
          <ErrorState message={datesState.message} onRetry={onRefresh} />
        ) : datesState.dates.length === 0 ? (
          <EmptyState message="No runs have been persisted yet." />
        ) : (
          <>
            {evaluationOpen ? (
              <>
                <nav aria-label="Evaluation detail" style={{ padding: theme.spacing.md }}>
                  <BackLink />
                </nav>
                {/* GateTab has no refreshNonce prop; remount on refresh to re-fetch. */}
                <GateTab key={refreshNonce} />
                <TrackRecordHistory key={`history-${refreshNonce}`} />
              </>
            ) : (
              <>
                <SingleWindowShell refreshNonce={refreshNonce} decisionDate={effectiveDate} />
                <div style={{ padding: theme.spacing.md }}>
                  <EvaluationDetailLink />
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
