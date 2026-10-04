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

import { fetchEndpoint, type ApiResult } from "../../api/client";
import type { DecisionDateRow, FiringSetupRow } from "../../api/endpoints";
import { selectBrowseDate } from "../../pure/selectDates";
import { shapeDashboardView } from "../../pure/shapeDashboard";
import { ALL_PAIRS, useSelection } from "../../state/selection";
import { theme } from "../../theme/darkTheme";
import { FiringCard } from "./FiringCard";
import { resolveSetupsViewState } from "./setupsViewState";
import { SuppressionList } from "./SuppressionList";

/** Loader for the available Decision_Dates. Injected for testability. */
export type DecisionDatesLoader = (options?: {
  readonly bustCache?: boolean;
  readonly signal?: AbortSignal;
}) => Promise<ApiResult<DecisionDateRow>>;

/** Loader for a Decision_Date's firing-setups rows (all five pairs). Injected for testability. */
export type FiringSetupsLoader = (
  decisionDate: string,
  options?: { readonly bustCache?: boolean; readonly signal?: AbortSignal },
) => Promise<ApiResult<FiringSetupRow>>;

const defaultLoadDecisionDates: DecisionDatesLoader = (options) =>
  fetchEndpoint("/decision-dates", {}, options);

const defaultLoadFiringSetups: FiringSetupsLoader = (decisionDate, options) =>
  // No `pair` param: fetch all five pairs so suppressions stay cross-pair (Req 8.5); the
  // pure shaper scopes the cards to the selected pair.
  fetchEndpoint("/firing-setups", { decisionDate }, options);

export interface SetupsTabProps {
  /** Decision_Dates loader; defaults to the real `/decision-dates` fetch. */
  readonly loadDecisionDates?: DecisionDatesLoader;
  /** Firing-setups loader; defaults to the real `/firing-setups` fetch. */
  readonly loadFiringSetups?: FiringSetupsLoader;
  /** Bumped by the shell to force a cache-busting refresh (Req 17.1, 17.2). */
  readonly refreshNonce?: number;
}

/** The in-flight / settled fetch lifecycle for this tab's rows. */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly rows: readonly FiringSetupRow[] };

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
      const opts = bustCache ? { bustCache: true, signal } : { signal };
      try {
        // Resolve the effective Decision_Date from the available set (Req 7.1). The browsed
        // date is used when it is actually present; otherwise we fall back to the latest.
        const dateResult = await loadDecisionDates(opts);
        if (signal.aborted || !mounted.current) return;
        const dates = dateResult.rows.map((r) => r.decision_date);
        const effectiveDate = selectBrowseDate(dates, date);

        if (effectiveDate === null) {
          // No runs persisted at all → "no data for this date" with an empty row set.
          setState({ kind: "ready", rows: [] });
          return;
        }

        const rowsResult = await loadFiringSetups(effectiveDate, opts);
        if (signal.aborted || !mounted.current) return;
        setState({ kind: "ready", rows: rowsResult.rows });
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
    [date, loadDecisionDates, loadFiringSetups],
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
  // explicit "no setups fired" message and no cards (Req 13.1, 13.2).
  return (
    <Panel>
      {viewState === "silent" ? (
        <StatusMessage text="No setups fired for this date." />
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
            {model.cards.map((card) => (
              <FiringCard key={`${card.pair}:${card.strategyId}`} card={card} />
            ))}
          </ul>
        </section>
      )}

      <SuppressionList suppressions={model.suppressions} />
    </Panel>
  );
}
