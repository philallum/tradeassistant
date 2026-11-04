/**
 * SingleWindowShell — the load state machine and ready-state composition for the
 * single-window dashboard (mobile-dashboard-single-window; Req 2.6, 10.x, 11.x).
 *
 * UNWIRED: `AppShell` still mounts the tab router. This component is built to replace the
 * routed body once the rest of the spec lands.
 *
 * State machine (mirrors `SetupsTab`'s `LoadState`): `loading | error | ready`.
 *   - `loading`: first load only. `LoadingState` renders synchronously on first render, so it
 *     is visible within 100 ms (Req 11.1).
 *   - `error`: a non-secret message plus a retry that re-runs the load for the CURRENT
 *     selection and is disabled while a retry is in flight (Req 11.4, 11.6).
 *   - `ready`: composes the already-built presentational components from the shapers.
 *
 * The whole load is raced against a 10 s timer via `withTimeout`, so a stall is a failure
 * (Req 11.5). The timer owns NO `AbortSignal`: `getSnapshot` shares one in-flight promise,
 * and aborting it would cancel the fetch for every other consumer. The only signal passed to
 * the loaders is this component's own unmount/dependency `AbortController`, as in `SetupsTab`.
 *
 * Selection: `resolveWindowSelection` maps the store's `ALL_PAIRS` sentinel / invalid values
 * to defaults (EURUSD / latest) without touching `state/selection.ts`. The raw URL params for
 * the best-effort Req 10.4 message are read once from `window.location.search` on mount
 * (the selection provider rewrites the URL afterwards).
 *
 * Extension points: tasks 4.4 (full composition), 4.5 (last-good-card retention) and 5.1
 * (null verdict banner) extend `ReadyView` and the load effect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { withTimeout } from "../api/withTimeout";
import { EMPTY_CONFLUENCE } from "../api/snapshot";
import { getSnapshot } from "../api/snapshotCache";
import type { Confluence, DailyCommentary, EvaluationReportRow, FiringSetupRow } from "../api/types";
import { resolveWindowSelection } from "../pure/resolveWindowSelection";
import { selectPairConfluenceRow } from "../pure/selectPairConfluenceRow";
import { shapeAllPairsStrip } from "../pure/shapeAllPairsStrip";
import { shapeBacktestEdge } from "../pure/shapeBacktestEdge";
import { shapeConfluence } from "../pure/shapeConfluence";
import { shapeDailyNote } from "../pure/shapeDailyNote";
import { shapeDashboardView } from "../pure/shapeDashboard";
import { shapeEvidence } from "../pure/shapeEvidence";
import { shapeSetupTrades } from "../pure/shapeSetupTrades";
import { useSelection } from "../state/selection";
import { selectLatestReport } from "../tabs/Gate/selectReport";
import type { EvaluationReportsLoader } from "../tabs/Gate/GateTab";
import type {
  ConfluenceLoader,
  DailyCommentaryLoader,
  FiringSetupsLoader,
  SetupsEvidence,
  SetupsEvidenceLoader,
} from "../tabs/Setups/SetupsTab";
import { theme } from "../theme/darkTheme";
import { AllPairsStrip } from "./AllPairsStrip";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { MasterCard } from "./MasterCard";

/** A stall longer than this is treated as a failed load (Req 11.5). */
export const LOAD_TIMEOUT_MS = 10_000;

const FALLBACK_ERROR = "The dashboard data could not be loaded.";

/** Resolve the shared snapshot for a load, forwarding the generation + abort signal. */
function snapshotFor(options?: { readonly generation?: number; readonly signal?: AbortSignal }) {
  return getSnapshot(options?.generation ?? 0, {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
}

const defaultLoadFiringSetups: FiringSetupsLoader = async (decisionDate, options) => {
  const snapshot = await snapshotFor(options);
  return {
    rows: snapshot.firingSetups.filter((r) => r.decision_date === decisionDate),
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

const defaultLoadConfluence: ConfluenceLoader = async (options) => {
  // Same graceful degradation as SetupsTab: a failed slice shapes to the explicit empty state.
  try {
    return (await snapshotFor(options)).confluence;
  } catch {
    return EMPTY_CONFLUENCE;
  }
};

const defaultLoadEvidence: SetupsEvidenceLoader = async (options) => {
  const snapshot = await snapshotFor(options);
  return {
    analogueOutcomes: snapshot.analogueOutcomes,
    tradeLedgerSummary: snapshot.tradeLedgerSummary,
    provenance: snapshot.provenance,
    validationStatus: snapshot.validationStatus,
  };
};

const defaultLoadDailyCommentary: DailyCommentaryLoader = async (decisionDate, options) => {
  const c = (await snapshotFor(options)).dailyCommentary;
  return c.decision_date === decisionDate
    ? c
    : { decision_date: "", note_text: "", generated: false };
};

const defaultLoadEvaluationReports: EvaluationReportsLoader = async (options) => {
  const snapshot = await getSnapshot(0, {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
  return {
    rows: snapshot.evaluationReports,
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

export interface SingleWindowShellProps {
  /** Bumped by the owner to force a cache-busting re-fetch (shared snapshot generation). */
  readonly refreshNonce: number;
  /** The effective Decision_Date (resolved by the owner), or null when none exist. */
  readonly decisionDate: string | null;
  readonly loadFiringSetups?: FiringSetupsLoader;
  readonly loadConfluence?: ConfluenceLoader;
  readonly loadEvidence?: SetupsEvidenceLoader;
  readonly loadDailyCommentary?: DailyCommentaryLoader;
  readonly loadEvaluationReports?: EvaluationReportsLoader;
}

/** The data the ready state is shaped from. */
interface LoadedData {
  readonly rows: readonly FiringSetupRow[];
  readonly confluence: Confluence;
  readonly evidence: SetupsEvidence;
  readonly dailyCommentary: DailyCommentary;
  readonly evaluationReports: readonly EvaluationReportRow[];
  readonly decisionDate: string;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly data: LoadedData };

/** Read the raw `pair` / `date` URL params once (best-effort Req 10.4). */
function readRawParams(): { readonly pair: string | null; readonly date: string | null } {
  if (typeof window === "undefined" || !window.location) return { pair: null, date: null };
  const params = new URLSearchParams(window.location.search);
  return { pair: params.get("pair"), date: params.get("date") };
}

export function SingleWindowShell({
  refreshNonce,
  decisionDate,
  loadFiringSetups = defaultLoadFiringSetups,
  loadConfluence = defaultLoadConfluence,
  loadEvidence = defaultLoadEvidence,
  loadDailyCommentary = defaultLoadDailyCommentary,
  loadEvaluationReports = defaultLoadEvaluationReports,
}: SingleWindowShellProps): JSX.Element {
  const { pair: storePair, date: storeDate, setPair } = useSelection();
  const [rawParams] = useState(readRawParams);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Bumped by the retry button to re-run the load for the current selection.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // Set once a load has succeeded; later loads keep the last good card (Req 2.7, 10.6-10.8).
  const everReady = useRef(false);
  // Non-blocking inline message for a failed/timed-out refresh after a ready state.
  const [refreshFailed, setRefreshFailed] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (date: string, signal: AbortSignal) => {
      const opts = { signal, generation: refreshNonce };
      try {
        const [rowsResult, confluence, evidence, dailyCommentary, reports] = await withTimeout(
          Promise.all([
            loadFiringSetups(date, opts),
            loadConfluence(opts),
            loadEvidence(opts),
            loadDailyCommentary(date, opts),
            loadEvaluationReports({ signal }),
          ]),
          LOAD_TIMEOUT_MS,
        );
        if (signal.aborted || !mounted.current) return;
        everReady.current = true;
        setRefreshFailed(false);
        setState({
          kind: "ready",
          data: {
            rows: rowsResult.rows,
            confluence,
            evidence,
            dailyCommentary,
            evaluationReports: reports.rows,
            decisionDate: date,
          },
        });
      } catch (cause) {
        if (signal.aborted || !mounted.current) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        // Non-secret message only: the api client and withTimeout throw fixed strings.
        const message =
          cause instanceof Error && cause.message.length > 0 ? cause.message : FALLBACK_ERROR;
        if (everReady.current) {
          // Keep the last good card mounted; only flag the failure inline.
          setRefreshFailed(true);
        } else {
          setState({ kind: "error", message });
        }
      } finally {
        if (!signal.aborted && mounted.current) setRetrying(false);
      }
    },
    [loadFiringSetups, loadConfluence, loadEvidence, loadDailyCommentary, loadEvaluationReports, refreshNonce],
  );

  useEffect(() => {
    if (decisionDate === null) return undefined;
    const controller = new AbortController();
    // Keep an error visible during a retry (button disabled) rather than flashing to loading.
    // After the first ready state never blank the view or drop back to loading.
    setState((prev) => (prev.kind === "error" || prev.kind === "ready" ? prev : { kind: "loading" }));
    void load(decisionDate, controller.signal);
    return () => controller.abort();
  }, [load, decisionDate, attempt]);

  const onRetry = useCallback(() => {
    setRetrying(true);
    setAttempt((n) => n + 1);
  }, []);

  const availableDates = useMemo(() => (decisionDate === null ? [] : [decisionDate]), [decisionDate]);
  const selection = resolveWindowSelection(
    storePair,
    storeDate,
    availableDates,
    rawParams.pair,
    rawParams.date,
  );

  if (decisionDate === null) {
    return <EmptyState message="No runs have been persisted yet." />;
  }

  if (state.kind === "loading") {
    return <LoadingState label="Loading dashboard…" />;
  }

  if (state.kind === "error") {
    return <ErrorRegion message={state.message} retrying={retrying} onRetry={onRetry} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.md, minWidth: 0 }}>
      {refreshFailed && (
        <p role="status" style={noticeStyle}>
          Refresh did not complete for {selection.pair}
          {selection.date !== null ? ` on ${selection.date}` : ` on ${state.data.decisionDate}`}; showing the
          last loaded data.
        </p>
      )}
      {(selection.rejectedPair || selection.rejectedDate) && (
        <p role="status" style={noticeStyle}>
          The requested selection was unavailable; showing {selection.pair}
          {selection.date !== null ? ` on ${selection.date}` : ""} instead.
        </p>
      )}
      <ReadyView data={state.data} pair={selection.pair} onSelectPair={setPair} />
    </div>
  );
}

/** ErrorState with a retry that is disabled while a retry is in flight (Req 11.6). */
function ErrorRegion(props: {
  readonly message: string;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}): JSX.Element {
  const { message, retrying, onRetry } = props;
  return (
    <div aria-busy={retrying}>
      <ErrorState message={message} onRetry={onRetry} retryDisabled={retrying} />
      {retrying && (
        <p role="status" style={noticeStyle}>
          Retrying…
        </p>
      )}
    </div>
  );
}

/** Ready-state composition from the existing shapers (extended by tasks 4.4, 4.5, 5.1). */
function ReadyView(props: {
  readonly data: LoadedData;
  readonly pair: import("../api/types").Pair;
  readonly onSelectPair: (pair: import("../api/types").Pair) => void;
}): JSX.Element {
  const { data, pair, onSelectPair } = props;

  // Every value below is a shaper output used verbatim; nothing is recomputed here.
  const composed = useMemo(() => {
    const confluenceVM = shapeConfluence(data.confluence); // once
    const model = shapeDashboardView(data.rows, pair);
    const setup =
      shapeSetupTrades({
        cards: model.cards,
        decisionDate: data.decisionDate,
        ...data.evidence,
      }).find((s) => s.pair === pair) ?? null;
    const evidence =
      shapeEvidence({
        cards: model.cards,
        analogueOutcomes: data.evidence.analogueOutcomes,
        tradeLedgerSummary: data.evidence.tradeLedgerSummary,
      }).find((e) => e.pair === pair) ?? null;
    return {
      confluenceVM,
      setup,
      evidence,
      strip: shapeAllPairsStrip(confluenceVM),
      row: selectPairConfluenceRow(confluenceVM, pair),
      note: shapeDailyNote(data.dailyCommentary),
      edge: shapeBacktestEdge(selectLatestReport(data.evaluationReports)),
    };
  }, [data, pair]);

  const { confluenceVM, setup, evidence, strip, row, note, edge } = composed;

  if (data.rows.length === 0 && confluenceVM.empty) {
    return <EmptyState message="No data for this date." />;
  }

  return (
    <>
      <AllPairsStrip strip={strip} selectedPair={pair} onSelectPair={onSelectPair} />
      <MasterCard
        setup={setup}
        pair={pair}
        edge={edge}
        row={row}
        columns={confluenceVM.columns}
        validated={confluenceVM.validated}
        note={note}
        evidence={evidence}
      />
    </>
  );
}

const noticeStyle: React.CSSProperties = {
  margin: 0,
  padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
  color: theme.colors.textSecondary,
  fontSize: 14,
};
