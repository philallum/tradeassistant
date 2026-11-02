/**
 * The Setups Category_Tab (task 9.2).
 *
 * Renders the daily picture of which pairs fired and which were suppressed for the selected
 * Decision_Date: a FiringCard list + a Suppression list, produced by the PURE
 * `shapeDashboardView` shaper (Req 8.3, 9.1–9.4, 13.1–13.3). It is cross-pair when the
 * Pair_Selector is on "All pairs" and pair-filtered otherwise, while suppressions ALWAYS
 * stay cross-pair so a currency-concentration suppression and its `competing_pairs` remain
 * visible regardless of the active pair (Req 8.5). This component recomputes nothing — every
 * rendered value is drawn verbatim from a persisted row via the pure shaper (Req 9.10,
 * 20.1).
 *
 * Data flow (all impure fetching is confined to this component, never the pure shaper):
 *   1. Resolve the effective Decision_Date from the shared selection store: the browsed
 *      date when present and available, else the Latest_Decision_Date (pure `selectBrowseDate`
 *      over the available `/decision-dates`, Req 7.1).
 *   2. Fetch this tab's own rows via `GET /api/firing-setups?decisionDate=D` through the api
 *      client. The `pair` query param is deliberately NOT sent so the response carries all
 *      five pairs' rows — the shaper then scopes cards to the selected pair while keeping
 *      suppressions cross-pair (Req 8.5). Fetching all five rows is bounded by the proxy's
 *      ≤5-row cap for this endpoint.
 *   3. Shape rows → `SetupsViewModel`, classify into a Setups view state (pure
 *      `resolveSetupsViewState`), and render the matching region: loading, a non-secret
 *      error, "no data for this date", "no data for this pair on this date", the silent
 *      "no setups fired" day (with suppressions still shown), or the content lists.
 *
 * The tabpanel ARIA wiring matches the shell's placeholder pattern (role="tabpanel",
 * id=`tabpanel-setups`, aria-labelledby=`tab-setups`) and the per-tab heading is an `<h2>`
 * under the app's single `<h1>` (Req 18.1).
 *
 * Loaders are injected (`loadDecisionDates`, `loadFiringSetups`) so the tab renders and is
 * testable without a live network; they default to the real same-origin api client. The
 * `refreshNonce` prop lets the shell (task 9.6 wiring) trigger a cache-busting re-fetch; a
 * bumped nonce re-runs the fetch with `{ bustCache: true }`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiResult } from "../../api/snapshot";
import { getSnapshot } from "../../api/snapshotCache";
import type {
  AnalogueOutcomeRow,
  DailyCommentary,
  DecisionDateRow,
  FiringSetupRow,
  PairEvaluationRow,
  ProvenanceRow,
  TradeLedgerSummary,
  ValidationStatusRow,
} from "../../api/types";
import { shapeEvidence } from "../../pure/shapeEvidence";
import { EvidencePanel } from "./EvidencePanel";
import { shapeSetupTrades } from "../../pure/shapeSetupTrades";
import { shapeDailyNote } from "../../pure/shapeDailyNote";
import { selectBrowseDate } from "../../pure/selectDates";
import { shapeDashboardView } from "../../pure/shapeDashboard";
import { shapeRunSummary } from "../../pure/shapeRunSummary";
import { ALL_PAIRS, useSelection } from "../../state/selection";
import { theme } from "../../theme/darkTheme";
import { DailyNote } from "./DailyNote";
import { SetupTradeCard } from "./SetupTradeCard";
import { RunSummary } from "./RunSummary";
import { resolveSetupsViewState } from "./setupsViewState";
import { SuppressionList } from "./SuppressionList";

/** Per-load options shared by the Setups loaders. */
interface SetupsLoadOptions {
  readonly bustCache?: boolean;
  readonly signal?: AbortSignal;
  /** The shared refresh generation (the shell's refreshNonce), so all reads share one fetch. */
  readonly generation?: number;
}

/** Loader for the available Decision_Dates. Injected for testability. */
export type DecisionDatesLoader = (
  options?: SetupsLoadOptions,
) => Promise<ApiResult<DecisionDateRow>>;

/** Loader for a Decision_Date's firing-setups rows (all five pairs). Injected for testability. */
export type FiringSetupsLoader = (
  decisionDate: string,
  options?: SetupsLoadOptions,
) => Promise<ApiResult<FiringSetupRow>>;

/** Loader for a Decision_Date's per-pair evaluation rows (the run-completion readout). */
export type PairEvaluationsLoader = (
  decisionDate: string,
  options?: SetupsLoadOptions,
) => Promise<ApiResult<PairEvaluationRow>>;

/** Loader for the pair-independent daily AI commentary (the LLM-path liveness note). */
export type DailyCommentaryLoader = (
  decisionDate: string,
  options?: SetupsLoadOptions,
) => Promise<DailyCommentary>;

/** Resolve the shared snapshot for a load, forwarding the generation + abort signal. */
function snapshotFor(options?: SetupsLoadOptions) {
  return getSnapshot(options?.generation ?? 0, {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
}

const defaultLoadDecisionDates: DecisionDatesLoader = async (options) => {
  const snapshot = await snapshotFor(options);
  return {
    rows: snapshot.decisionDates.map((decision_date) => ({ decision_date })),
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

const defaultLoadFiringSetups: FiringSetupsLoader = async (decisionDate, options) => {
  // All five pairs for the date: suppressions stay cross-pair (Req 8.5); the pure shaper
  // scopes the cards to the selected pair.
  const snapshot = await snapshotFor(options);
  return {
    rows: snapshot.firingSetups.filter((r) => r.decision_date === decisionDate),
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

const defaultLoadPairEvaluations: PairEvaluationsLoader = async (decisionDate, options) => {
  // Every evaluated pair for the date (fired or not) — drives the silent-day run-completion
  // readout. Scoped to the Decision_Date, consistent with the firing-setups loader.
  const snapshot = await snapshotFor(options);
  return {
    rows: snapshot.pairEvaluations.filter((r) => r.decision_date === decisionDate),
    lastUpdated: snapshot.generatedAt === "" ? null : snapshot.generatedAt,
  };
};

const defaultLoadDailyCommentary: DailyCommentaryLoader = async (decisionDate, options) => {
  // The snapshot's single pair-independent note. Return it only when it matches the browsed
  // Decision_Date (the snapshot carries today's note); otherwise an absent record so a
  // historical date never shows today's note.
  const snapshot = await snapshotFor(options);
  const c = snapshot.dailyCommentary;
  return c.decision_date === decisionDate
    ? c
    : { decision_date: "", note_text: "", generated: false };
};

/** The v4 evidence slices the re-organised Setups cards consume (default empty on v3). */
export interface SetupsEvidence {
  readonly analogueOutcomes: readonly AnalogueOutcomeRow[];
  readonly tradeLedgerSummary: TradeLedgerSummary;
  readonly provenance: readonly ProvenanceRow[];
  readonly validationStatus: readonly ValidationStatusRow[];
}

const NO_EVIDENCE: SetupsEvidence = {
  analogueOutcomes: [],
  tradeLedgerSummary: { window: null, strategies: [] },
  provenance: [],
  validationStatus: [],
};

/** Loader for the v4 evidence slices. Injected for testability. */
export type SetupsEvidenceLoader = (options?: SetupsLoadOptions) => Promise<SetupsEvidence>;

const defaultLoadEvidence: SetupsEvidenceLoader = async (options) => {
  const snapshot = await snapshotFor(options);
  return {
    analogueOutcomes: snapshot.analogueOutcomes,
    tradeLedgerSummary: snapshot.tradeLedgerSummary,
    provenance: snapshot.provenance,
    validationStatus: snapshot.validationStatus,
  };
};

export interface SetupsTabProps {
  /** v4 evidence loader (FORECAST/TRADE card inputs); defaults to the snapshot slices. */
  readonly loadEvidence?: SetupsEvidenceLoader;
  /** Decision_Dates loader; defaults to the real `/decision-dates` fetch. */
  readonly loadDecisionDates?: DecisionDatesLoader;
  /** Firing-setups loader; defaults to the real `/firing-setups` fetch. */
  readonly loadFiringSetups?: FiringSetupsLoader;
  /** Per-pair evaluations loader (run-completion readout); defaults to the snapshot slice. */
  readonly loadPairEvaluations?: PairEvaluationsLoader;
  /** Daily AI commentary loader (the LLM-path liveness note); defaults to the snapshot slice. */
  readonly loadDailyCommentary?: DailyCommentaryLoader;
  /** Bumped by the shell to force a cache-busting refresh (Req 17.1, 17.2). */
  readonly refreshNonce?: number;
}

/** The in-flight / settled fetch lifecycle for this tab's rows. */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly rows: readonly FiringSetupRow[];
      readonly pairEvaluations: readonly PairEvaluationRow[];
      readonly dailyCommentary: DailyCommentary;
      readonly evidence: SetupsEvidence;
      readonly decisionDate: string;
    };

/** Shared tabpanel wrapper so every state renders inside the correct ARIA panel + heading. */
function Panel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <section
      role="tabpanel"
      id="tabpanel-setups"
      aria-labelledby="tab-setups"
      tabIndex={0}
      style={{ padding: theme.spacing.lg, color: theme.colors.textSecondary }}
    >
      <h2 style={{ color: theme.colors.textPrimary, marginTop: 0, fontSize: 20 }}>Setups</h2>
      {children}
    </section>
  );
}

/** A centred, non-blocking status message (loading / empty / silent states). */
function StatusMessage({
  text,
  live,
}: {
  readonly text: string;
  readonly live?: boolean;
}): JSX.Element {
  return (
    <p
      {...(live === true ? { role: "status", "aria-live": "polite" as const } : {})}
      style={{
        margin: 0,
        padding: `${theme.spacing.lg}px 0`,
        color: theme.colors.textSecondary,
        fontSize: 15,
      }}
    >
      {text}
    </p>
  );
}

export function SetupsTab({
  loadDecisionDates = defaultLoadDecisionDates,
  loadFiringSetups = defaultLoadFiringSetups,
  loadPairEvaluations = defaultLoadPairEvaluations,
  loadDailyCommentary = defaultLoadDailyCommentary,
  loadEvidence = defaultLoadEvidence,
  refreshNonce = 0,
}: SetupsTabProps): JSX.Element {
  const { pair, date } = useSelection();

  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // Guards against setting state after unmount when a fetch resolves late.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (bustCache: boolean, signal: AbortSignal) => {
      const opts: SetupsLoadOptions = bustCache
        ? { bustCache: true, signal, generation: refreshNonce }
        : { signal, generation: refreshNonce };
      try {
        // Resolve the effective Decision_Date from the available set (Req 7.1). The browsed
        // date is used when it is actually present; otherwise we fall back to the latest.
        const dateResult = await loadDecisionDates(opts);
        if (signal.aborted || !mounted.current) return;
        const dates = dateResult.rows.map((r) => r.decision_date);
        const effectiveDate = selectBrowseDate(dates, date);

        if (effectiveDate === null) {
          // No runs persisted at all → "no data for this date" with empty rows + no note.
          setState({
            kind: "ready",
            rows: [],
            pairEvaluations: [],
            dailyCommentary: { decision_date: "", note_text: "", generated: false },
            evidence: NO_EVIDENCE,
            decisionDate: "",
          });
          return;
        }

        // All reads share the one cached snapshot (same generation), so this is a single
        // fetch. The per-pair readout drives the silent-day summary; the daily note is the
        // pair-independent AI commentary shown every trading day.
        const [rowsResult, evalResult, commentary, evidence] = await Promise.all([
          loadFiringSetups(effectiveDate, opts),
          loadPairEvaluations(effectiveDate, opts),
          loadDailyCommentary(effectiveDate, opts),
          loadEvidence(opts),
        ]);
        if (signal.aborted || !mounted.current) return;
        setState({
          kind: "ready",
          rows: rowsResult.rows,
          pairEvaluations: evalResult.rows,
          dailyCommentary: commentary,
          evidence,
          decisionDate: effectiveDate,
        });
      } catch (cause) {
        if (signal.aborted || !mounted.current) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        // Non-secret message only (Req 14.2): the api client already sanitizes its errors.
        const message =
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "The data could not be loaded.";
        setState({ kind: "error", message });
      }
    },
    [date, loadDecisionDates, loadFiringSetups, loadPairEvaluations, loadDailyCommentary, loadEvidence, refreshNonce],
  );

  // (Re)load whenever the browsed date or the refresh signal changes. A bumped
  // `refreshNonce` performs a cache-busting fetch (Req 17.1, 17.2). The pair selection is
  // NOT a dependency: the fetched rows span all five pairs and the shaper re-scopes cards
  // in render, so changing the pair never needs a network round-trip.
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void load(refreshNonce > 0, controller.signal);
    return () => controller.abort();
  }, [load, refreshNonce]);

  if (state.kind === "loading") {
    return (
      <Panel>
        <StatusMessage text="Loading setups…" live />
      </Panel>
    );
  }

  if (state.kind === "error") {
    return (
      <Panel>
        <p
          role="alert"
          style={{ margin: 0, padding: `${theme.spacing.lg}px 0`, color: theme.semantic.danger }}
        >
          {state.message}
        </p>
      </Panel>
    );
  }

  // Shape the fetched rows into the Setups view model and classify the display state. Both
  // steps are PURE and recompute nothing (Req 9.10, 20.1).
  const scope = pair === ALL_PAIRS ? ALL_PAIRS : pair;
  const model = shapeDashboardView(state.rows, scope);
  const viewState = resolveSetupsViewState(model, pair);
  // Group each firing pair into FORECAST + TRADE with un-validated markers (R10.1, R10.3).
  const setupTrades = shapeSetupTrades({
    cards: model.cards,
    decisionDate: state.decisionDate,
    ...state.evidence,
  });
  const evidence = shapeEvidence({
    cards: model.cards,
    analogueOutcomes: state.evidence.analogueOutcomes,
    tradeLedgerSummary: state.evidence.tradeLedgerSummary,
  });
  // The run-completion readout for the silent (no-fire) state (schema v2). Absent on an
  // older v1 snapshot, in which case the silent branch keeps the plain message.
  const runSummary = shapeRunSummary(state.pairEvaluations);
  // The pair-independent daily AI commentary (schema v3) — shown on EVERY trading day as an
  // LLM-path liveness signal, in both the silent and content states. `absent` on an older
  // snapshot (the component renders nothing then).
  const dailyNote = shapeDailyNote(state.dailyCommentary);

  if (viewState === "no-data-date") {
    return (
      <Panel>
        <StatusMessage text="No data for this date." />
      </Panel>
    );
  }

  if (viewState === "no-data-pair") {
    return (
      <Panel>
        <StatusMessage text={`No data for ${pair} on this date.`} />
      </Panel>
    );
  }

  // `silent` and `content` both render the suppression list; `silent` additionally shows an
  // explicit "no setups fired" message and no cards (Req 13.1, 13.2). The daily AI note is
  // rendered FIRST in both states so it appears every trading day (Req: liveness signal).
  return (
    <Panel>
      {viewState === "silent" ? (
        runSummary.present ? (
          <RunSummary summary={runSummary} />
        ) : (
          <StatusMessage text="No setups fired for this date." />
        )
      ) : (
        <section aria-labelledby="setups-cards-heading" style={{ marginBottom: theme.spacing.lg }}>
          <h3
            id="setups-cards-heading"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: theme.colors.textSecondary,
              margin: `0 0 ${theme.spacing.sm}px 0`,
            }}
          >
            {pair === ALL_PAIRS ? "Firing setups (all pairs)" : `Firing setups — ${pair}`}
          </h3>
          <ul
            style={{
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: theme.spacing.sm,
            }}
          >
            {setupTrades.map((vm) => (
              <SetupTradeCard key={`${vm.pair}:${vm.strategyId}`} vm={vm} />
            ))}
          </ul>
        </section>
      )}

      {/* Evidence FIRST and prominent (R10.4); AI commentary and suppressions follow. */}
      <EvidencePanel items={evidence} />

      <SuppressionList suppressions={model.suppressions} />

      {/* Advisory AI note: demoted below the evidence, non-scoring (R10.4). */}
      <DailyNote note={dailyNote} />
    </Panel>
  );
}
