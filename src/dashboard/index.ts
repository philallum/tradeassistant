// Silent-by-Default Dashboard & Currency Concentration Guard module public API —
// Components 11 and 16 (Requirements 16, 22, 1, 12.3).
//
// `dailyRun()` evaluates all five pairs, fires a pair only when it is
// gate-passing AND its Earned_Confidence >= the configurable Confidence_Threshold
// AND news permits (16.2, 16.5, 16.6, 1.1), then applies the Currency
// Concentration Guard as a dashboard-level suppression step AFTER the per-pair
// firing decisions and BEFORE render (22). Both the firing decision and the
// guard are deterministic and take no LLM input; rationale/labels flow outward
// only, onto the rendered card (15.2, 15.4).

export * from "./types.js";
export {
  applyCurrencyConcentrationGuard,
  currencyConcentrationGuard,
} from "./currencyConcentrationGuard.js";
export {
  dailyRun,
  createDashboard,
  type Dashboard,
  type PairEvaluation,
} from "./dashboard.js";
export {
  renderFiringCard,
  RISK_BOUNDARY_NOT_ACTIONABLE,
  type RenderedCard,
} from "./renderFiringCard.js";
export {
  persistFiringSetups,
  InMemoryFiringSetupStore,
  SYSTEM_STRATEGY_ID,
  type FiringSetupRow,
  type FiringSetupStore,
  type SuppressionReason,
  type PairOutcomeOverride,
  type PersistFiringSetupsOptions,
} from "./persistFiringSetups.js";
