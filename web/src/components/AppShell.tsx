/**
 * The Dashboard_UI app shell (task 9.1).
 *
 * Composes the persistent header (Pair_Selector + Decision_Date selector + refresh and
 * "last updated"), the routed tab content, and the mobile-native bottom tab bar into one
 * mobile-first layout (Req 1.3, 8.1, 8.6, 16.1, 16.4, 17.1, 17.3). It owns the small amount
 * of shell-level fetch state the header needs:
 *
 *   - the list of available Decision_Dates (from `GET /decision-dates`), which populates
 *     the Historical_Browse selector, and
 *   - the proxy's `lastUpdated` freshness marker + an in-flight flag for the refresh
 *     control.
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
 *   - otherwise  → the routed tab, which owns its own per-tab/per-pair states (Req 7.4, 8.7)
 *
 * The data client is injected (`fetchDecisionDates`) so the shell renders and is testable
 * without a live network; it defaults to the real api client.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchEndpoint, type ApiResult } from "../api/client";
import type { DecisionDateRow } from "../api/endpoints";
import { selectBrowseDate } from "../pure/selectDates";
import { useSelection } from "../state/selection";
import { theme } from "../theme/darkTheme";
import { BottomTabBar } from "./BottomTabBar";
import { DateSelector } from "./DateSelector";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { PairSelector } from "./PairSelector";
import { RefreshControl } from "./RefreshControl";
import { TabRouter } from "./TabRouter";
import { useMediaQuery, WIDE_VIEWPORT_QUERY } from "./useMediaQuery";
import { useRoute } from "./useRoute";

/** Loader for the available Decision_Dates. Injected for testability; defaults to the api client. */
export type DecisionDatesLoader = (options?: {
  readonly bustCache?: boolean;
  readonly signal?: AbortSignal;
}) => Promise<ApiResult<DecisionDateRow>>;

/** Default loader: fetch `/decision-dates` through the real same-origin api client. */
const defaultLoader: DecisionDatesLoader = (options) =>
  fetchEndpoint("/decision-dates", {}, options);

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
  const { tab, setTab } = useRoute();
  const wide = useMediaQuery(WIDE_VIEWPORT_QUERY);
  // The browsed Decision_Date selection (null = "use the latest"). Owned by the shared
  // selection store so it survives tab switches; the shell reads it to resolve the
  // effective date it hands to the per-pair single-date tabs.
  const { date: browsedDate } = useSelection();

  const [datesState, setDatesState] = useState<DatesState>({ kind: "loading" });
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
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
    async (bustCache: boolean) => {
      setIsRefreshing(true);
      // Only show the full-screen loading state on the very first load; a refresh keeps the
      // current content visible and signals in-flight via the (disabled) refresh control
      // (Req 17.4), so the viewer never flashes to a blank screen on refresh.
      setDatesState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
      try {
        const result = await loadDecisionDates(bustCache ? { bustCache: true } : {});
        if (!mounted.current) return;
        setDatesState({ kind: "ready", dates: result.rows.map((r) => r.decision_date) });
        setLastUpdated(result.lastUpdated);
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

  // Initial shell load (normal, cache-allowed fetch).
  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
    void load(true); // cache-busting fetch (Req 17.1, 17.2); also recovers from an error
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
      <header
        style={{
          padding: theme.spacing.md,
          borderBottom: `1px solid ${theme.colors.border}`,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.md,
          background: theme.colors.surface,
        }}
      >
        {/* Single top-level heading for the document (Req 18.1). */}
        <h1 style={{ margin: 0, fontSize: 18 }}>Trading Assistant — Dashboard</h1>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: theme.spacing.md,
          }}
        >
          <PairSelector wide={wide} />
          <DateSelector dates={dates} />
          <div style={{ marginLeft: "auto" }}>
            <RefreshControl
              lastUpdated={lastUpdated}
              isRefreshing={isRefreshing}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </header>

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
          <TabRouter tab={tab} refreshNonce={refreshNonce} decisionDate={effectiveDate} />
        )}
      </main>

      <BottomTabBar active={tab} onSelect={setTab} />
    </div>
  );
}
