/**
 * The Pattern & Outcomes Category_Tab (task 9.3).
 *
 * This is a PER-PAIR detail tab (Req 8.2): it shows one pair's Earned_Confidence trend
 * (Req 9.5), MFE/MAE excursion profile (Req 9.6), prediction-versus-actual comparison
 * (Req 10.1–10.3), and price (OHLC) chart (Req 9.9), each inside its own Accordion_Section
 * (Req 16.3) and each accompanied by a text/table equivalent (Req 18.4). Every rendered
 * value comes VERBATIM from a pure shaper over persisted rows — this tab recomputes nothing
 * (Req 9.10, 10.4, 20.1). All charts are themed to the single dark theme (Req 15.3).
 *
 * Scope and selection:
 *   - Because the content is per-pair, when the Pair_Selector is on "All pairs" the tab
 *     prompts the viewer to pick a specific pair rather than guessing one (per design).
 *   - The browsed Decision_Date bounds the excursion / realized / price reads; the
 *     confidence trend is the pair's history up to a bounded limit.
 *
 * Data fetching is impure (it calls the api client), so this component lives under `tabs/`,
 * never under `pure/`. The four per-pair reads are injectable (`loaders`) so the tab can be
 * rendered and tested without a live network; they default to the real `/api` client. On a
 * fetch failure a non-secret message is shown; while a read is in flight a loading state is
 * shown (Req 14.1–14.3).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { fetchEndpoint, type ApiResult } from "../../api/client";
import type {
  AnalogueOutcomeRow,
  CandleRow,
  FiringSetupRow,
  Pair,
  RealizedOutcomeRow,
} from "../../api/endpoints";
import {
  shapeConfidenceTrend,
  shapeExcursionProfile,
  shapePriceSeries,
} from "../../pure/shapeCharts";
import { shapePredictionActual } from "../../pure/shapePredictionActual";
import { ALL_PAIRS, useSelection } from "../../state/selection";
import { theme } from "../../theme/darkTheme";
import { A11yDataTable } from "./A11yDataTable";
import { Accordion } from "./Accordion";
import { ConfidenceTrendChart } from "./ConfidenceTrendChart";
import { ExcursionProfileChart } from "./ExcursionProfileChart";
import { PredictionActual } from "./PredictionActual";
import { PriceChart } from "./PriceChart";

/** Injectable per-pair loaders so the tab is renderable/testable without a live network. */
export interface PatternOutcomesLoaders {
  readonly loadConfidenceTrend: (
    pair: Pair,
    signal: AbortSignal,
  ) => Promise<ApiResult<FiringSetupRow>>;
  readonly loadExcursions: (
    pair: Pair,
    decisionDate: string | null,
    signal: AbortSignal,
  ) => Promise<ApiResult<AnalogueOutcomeRow>>;
  readonly loadRealized: (
    pair: Pair,
    decisionDate: string | null,
    signal: AbortSignal,
  ) => Promise<ApiResult<RealizedOutcomeRow>>;
  readonly loadCandles: (
    pair: Pair,
    signal: AbortSignal,
  ) => Promise<ApiResult<CandleRow>>;
}

/** Default loaders: the real same-origin `/api` reads through the api client. */
const defaultLoaders: PatternOutcomesLoaders = {
  loadConfidenceTrend: (pair, signal) =>
    fetchEndpoint("/confidence-trend", { pair }, { signal }),
  loadExcursions: (pair, decisionDate, signal) =>
    fetchEndpoint(
      "/analogue-outcomes",
      decisionDate !== null ? { pair, decisionDate } : { pair },
      { signal },
    ),
  loadRealized: (pair, decisionDate, signal) =>
    fetchEndpoint(
      "/realized-outcomes",
      decisionDate !== null ? { pair, decisionDate } : { pair },
      { signal },
    ),
  loadCandles: (pair, signal) => fetchEndpoint("/candles", { pair }, { signal }),
};

/** The rows the four per-pair reads return, held together once all four resolve. */
interface PatternData {
  readonly firing: readonly FiringSetupRow[];
  readonly excursions: readonly AnalogueOutcomeRow[];
  readonly realized: readonly RealizedOutcomeRow[];
  readonly candles: readonly CandleRow[];
}

type LoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: PatternData };

export interface PatternOutcomesTabProps {
  /** Per-pair data loaders; default to the real `/api` client. */
  readonly loaders?: PatternOutcomesLoaders;
  /**
   * Bumped by the shell on refresh to force a re-fetch (Req 17.1). Any change re-runs the
   * four reads with the current pair + date.
   */
  readonly refreshNonce?: number;
}

/** The tabpanel wrapper carrying the correct ARIA wiring back to its tab (Req 16.5). */
function Panel({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <section
      role="tabpanel"
      id="tabpanel-pattern-outcomes"
      aria-labelledby="tab-pattern-outcomes"
      tabIndex={0}
      style={{ padding: theme.spacing.lg, color: theme.colors.textSecondary }}
    >
      <h2 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>Pattern &amp; Outcomes</h2>
      {children}
    </section>
  );
}

export function PatternOutcomesTab({
  loaders = defaultLoaders,
  refreshNonce = 0,
}: PatternOutcomesTabProps): JSX.Element {
  const { pair, date } = useSelection();
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A concrete pair is required; "All pairs" prompts a pick instead of fetching.
  const concretePair: Pair | null = pair === ALL_PAIRS ? null : pair;

  const load = useCallback(
    async (activePair: Pair, decisionDate: string | null, signal: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const [firing, excursions, realized, candles] = await Promise.all([
          loaders.loadConfidenceTrend(activePair, signal),
          loaders.loadExcursions(activePair, decisionDate, signal),
          loaders.loadRealized(activePair, decisionDate, signal),
          loaders.loadCandles(activePair, signal),
        ]);
        if (!mounted.current || signal.aborted) return;
        setState({
          status: "ready",
          data: {
            firing: firing.rows,
            excursions: excursions.rows,
            realized: realized.rows,
            candles: candles.rows,
          },
        });
      } catch (cause) {
        if (signal.aborted) return;
        if (!mounted.current) return;
        // Non-secret message only — never the raw payload/stack (Req 14.2).
        const message =
          cause instanceof Error && cause.name === "ApiError"
            ? cause.message
            : "Could not load pattern and outcome data.";
        setState({ status: "error", message });
      }
    },
    [loaders],
  );

  useEffect(() => {
    if (concretePair === null) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    void load(concretePair, date, controller.signal);
    return () => controller.abort();
  }, [concretePair, date, refreshNonce, load]);

  // "All pairs": per-pair detail is undefined — ask the viewer to pick a pair (per design).
  if (concretePair === null) {
    return (
      <Panel>
        <p style={{ color: theme.colors.textSecondary }}>
          Pattern &amp; Outcomes shows one pair at a time. Choose a specific pair from the
          Pair selector above to see its confidence trend, excursion profile,
          prediction-versus-actual comparison, and price chart.
        </p>
      </Panel>
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <Panel>
        <p role="status" aria-live="polite" style={{ color: theme.colors.textSecondary }}>
          Loading {concretePair} pattern and outcome data…
        </p>
      </Panel>
    );
  }

  if (state.status === "error") {
    return (
      <Panel>
        <p role="alert" style={{ color: theme.semantic.danger }}>
          {state.message}
        </p>
      </Panel>
    );
  }

  const { data } = state;
  const trend = shapeConfidenceTrend(data.firing, concretePair);
  const excursion = shapeExcursionProfile(data.excursions);
  const prediction = shapePredictionActual(data.realized);
  const price = shapePriceSeries(data.candles);

  const noData =
    trend.points.length === 0 &&
    excursion.points.length === 0 &&
    !prediction.hasData &&
    price.points.length === 0;

  if (noData) {
    return (
      <Panel>
        <p style={{ color: theme.colors.textMuted }}>
          No data for {concretePair}
          {date !== null ? ` on ${date}` : ""}.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <Accordion
        title="Earned confidence trend"
        subtitle="Source: firing_setups"
        defaultOpen
      >
        <ConfidenceTrendChart series={trend} />
        <A11yDataTable
          table={trend.table}
          caption={`Earned confidence by decision date for ${concretePair} (screen-reader table).`}
          visuallyHidden
        />
      </Accordion>

      <Accordion title="Excursion profile (MFE / MAE)" subtitle="Source: analogue_outcomes">
        <ExcursionProfileChart series={excursion} />
        <A11yDataTable
          table={excursion.table}
          caption="Favorable (MFE) and adverse (MAE) excursion in pips by decision date (screen-reader table)."
          visuallyHidden
        />
      </Accordion>

      <Accordion
        title="Prediction versus actual"
        subtitle="Source: realized_outcomes (most recent matured)"
      >
        <PredictionActual vm={prediction} />
      </Accordion>

      <Accordion title="Price chart (OHLC)" subtitle="Source: candles">
        <PriceChart series={price} />
        <A11yDataTable
          table={price.table}
          caption="Open, high, low, and close prices by date (screen-reader table)."
          visuallyHidden
        />
      </Accordion>
    </Panel>
  );
}
