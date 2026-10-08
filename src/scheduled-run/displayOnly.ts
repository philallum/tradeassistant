// Daily display-only producer — the composition that fills the `loadDisplayOnly`
// seam in `src/scheduled-run/main.ts` (Requirements 15, 20, 23).
//
// This module connects the two OUTWARD-ONLY display producers end-to-end for a
// Decision_Date, producing the display-only writes the `dashboard.json` snapshot
// carries (see `main.ts` and `snapshot.ts`):
//
//   1. AI rationale (Requirement 15): for every FIRING card in the produced
//      dashboard view, generate the plain-language `signal_rationale` and the
//      qualitative `pattern_description` analogue labels via the single
//      `LlmInterface` gateway (so both are provenance-tagged `LlmTagged<…>`).
//
//   2. Third-party cross-reference (Requirement 23): for ALL five pairs, fetch
//      the CURRENT external reference through the swappable
//      `ExternalSignalProvider`, and project each into an own-vs-reference
//      comparison against the system's own Direction_Class.
//
// Everything here is DISPLAY-ONLY and fail-safe. It takes the already-produced
// deterministic `DashboardView` + `PairEvaluation[]` as inputs and NEVER feeds
// anything back into the firing / suppression / scoring path (Requirements
// 15.2, 15.4, 23.2, 23.3). A failure in either producer degrades to "no
// rationale" / "reference unavailable" for the affected pair and never blocks
// the firing view from being persisted.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Confidence } from "../confidence/types.js";
import type { DashboardView, FiringCard } from "../dashboard/index.js";
import type { PairEvaluation } from "../dashboard/index.js";
import type { LlmInterface } from "../llm/index.js";
import { generateSignalRationale, generatePatternDescription } from "../rationale/index.js";
import type { SignalNumericInputs, AnalogueSummary } from "../rationale/index.js";
import {
  fetchAllReferences,
  toReferenceDisplays,
  type ExternalSignalProvider,
} from "../external-signal/index.js";
import type { ExternalReferenceSignal, ExternalSignalConfig } from "../external-signal/index.js";
import type {
  DisplayOnlyWrite,
  SignalRationaleWrite,
  ReferenceComparisonWrite,
} from "../storage/supabase/index.js";

/** The collaborators the daily display-only producer needs. All optional. */
export interface DisplayOnlyDeps {
  /** The LLM gateway for rationale / labels. Omit to skip AI generation. */
  readonly llm?: LlmInterface;
  /** The third-party reference provider. Omit to skip the cross-reference. */
  readonly externalProvider?: ExternalSignalProvider;
  /** External-signal config (timeout etc.). Required only with a provider. */
  readonly externalConfig?: ExternalSignalConfig;
}

/**
 * Project a firing card into the deterministic numeric inputs the
 * `signal_rationale` role consumes. The card does not carry the raw
 * pattern/trend/structural fields, so they are mapped from the card's own
 * deterministic values: `trendContext` from the Direction_Class (UP/DOWN), the
 * structural-liquidity distance approximated by the favorable-excursion pips,
 * and a descriptive pattern label. This is DISPLAY-ONLY input — none of it
 * re-enters scoring.
 */
function toNumericInputs(card: FiringCard): SignalNumericInputs {
  return {
    pattern: `${card.pair} ${card.direction} setup (horizon ${card.horizon})`,
    trendContext: card.direction === "DOWN" ? "DOWN" : "UP",
    structuralLiquidityDistancePips: Math.round(card.excursionProfile.favorablePips),
    selectedHorizon: card.horizon,
    direction: card.direction,
    earnedConfidence: card.earnedConfidence as Confidence,
  };
}

/**
 * A minimal single-analogue summary derived from the firing card's excursion
 * profile, used to seed the `pattern_description` role when the full analogue
 * neighborhood is not threaded through to this display boundary. Display-only.
 */
function toAnalogueSummaries(card: FiringCard, decisionDate: TradingDate): readonly AnalogueSummary[] {
  return [
    {
      decisionDate,
      direction: card.direction,
      horizon: card.horizon,
      mfePips: Math.round(card.excursionProfile.favorablePips),
      maePips: Math.round(card.excursionProfile.adversePips),
    },
  ];
}

/**
 * Generate the AI rationale + analogue labels for every firing card. Each card
 * is independent and fail-safe: if the model errors for one card it is simply
 * omitted from the rationale write (its card still renders, just without AI
 * text). Returns an empty list when no LLM is configured or nothing fired.
 */
async function buildRationales(
  view: DashboardView,
  deps: DisplayOnlyDeps,
): Promise<readonly SignalRationaleWrite[]> {
  const llm = deps.llm;
  if (llm === undefined || view.cards.length === 0) {
    return [];
  }

  const writes = await Promise.all(
    view.cards.map(async (card): Promise<SignalRationaleWrite | null> => {
      try {
        const [rationale, analogueLabels] = await Promise.all([
          generateSignalRationale(llm, toNumericInputs(card)),
          generatePatternDescription(llm, toAnalogueSummaries(card, view.decisionDate)),
        ]);
        return {
          decisionDate: view.decisionDate,
          pair: card.pair,
          rationale,
          analogueLabels,
        };
      } catch (err) {
        logDisplayWarning("rationale", card.pair, err);
        return null;
      }
    }),
  );

  return writes.filter((w): w is SignalRationaleWrite => w !== null);
}

/**
 * Fetch and project the third-party cross-reference for ALL five pairs into
 * comparison writes. Uses each pair's OWN Direction_Class (from the deterministic
 * evaluations) for the agree/diverge/neutral tag. Fail-safe per pair: an
 * unavailable reference is still written (as a `null` reference with an
 * `unavailable` comparison) so the dashboard shows an explicit state rather than
 * a blank. Returns an empty list when no provider is configured.
 */
async function buildComparisons(
  decisionDate: TradingDate,
  evaluations: readonly PairEvaluation[],
  deps: DisplayOnlyDeps,
): Promise<readonly ReferenceComparisonWrite[]> {
  const provider = deps.externalProvider;
  const config = deps.externalConfig;
  if (provider === undefined || config === undefined) {
    return [];
  }

  const ownByPair = new Map<Pair, DirectionClass>();
  for (const evaluation of evaluations) {
    ownByPair.set(evaluation.pair, evaluation.direction);
  }

  const outcomes = await fetchAllReferences(provider, decisionDate, config);
  const displays = toReferenceDisplays(outcomes, ownByPair);

  // Index the fetched signals by pair so we can carry the full reference row.
  const signalByPair = new Map<Pair, ExternalReferenceSignal>();
  for (const outcome of outcomes) {
    if (outcome.available) signalByPair.set(outcome.pair, outcome.signal);
  }

  return displays.map((display): ReferenceComparisonWrite => ({
    decisionDate,
    pair: display.pair,
    ownDirection: ownByPair.get(display.pair) ?? null,
    reference: signalByPair.get(display.pair) ?? null,
    comparison: display.comparison,
  }));
}

/** Structured, secret-free warning for a per-pair display producer failure. */
function logDisplayWarning(producer: string, pair: Pair, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    JSON.stringify({ event: "scheduled_run.display_warning", producer, pair, message }),
  );
}

/**
 * Build the complete {@link DisplayOnlyWrite} for a Decision_Date from the
 * produced dashboard view and the per-pair evaluations. Returns `undefined` when
 * neither producer yielded anything (no LLM + no provider, or nothing to write),
 * so the persister stays a no-op in that case — matching the original seam
 * contract in `main.ts`.
 */
export async function buildDisplayOnly(
  view: DashboardView,
  evaluations: readonly PairEvaluation[],
  deps: DisplayOnlyDeps,
): Promise<DisplayOnlyWrite | undefined> {
  const [rationales, comparisons] = await Promise.all([
    buildRationales(view, deps),
    buildComparisons(view.decisionDate, evaluations, deps),
  ]);

  if (rationales.length === 0 && comparisons.length === 0) {
    return undefined;
  }
  return {
    ...(rationales.length > 0 ? { rationales } : {}),
    ...(comparisons.length > 0 ? { comparisons } : {}),
  };
}

/** Re-export PAIRS for callers that want the canonical five-pair order. */
export { PAIRS };
