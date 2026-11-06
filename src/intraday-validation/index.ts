// Intraday 4H Candle Validation — public barrel (intraday-validation feature).
//
// A small, read-only enrichment layer around the immutable daily forecast. It
// fetches the currently-forming 4H candle a few hours after the daily run,
// deterministically classifies whether it supports or contradicts the original
// daily direction, derives a bounded UNVALIDATED confidence delta, and surfaces
// the result as its own snapshot slice. It never mutates the daily decision.

export type {
  CandleFeatures,
  Intraday4hBar,
  IntradayCandle,
  IntradayValidationRecord,
  ValidationResult,
  ValidationState,
} from "./types.js";
export { INTRADAY_VALIDATION_LABEL, VALIDATION_STATES } from "./types.js";
export { computeCandleFeatures, isCandleComputable } from "./features.js";
export {
  classifyState,
  classifyValidation,
  DELTA_PP,
  MAX_DELTA_PP,
  THRESHOLDS,
} from "./classify.js";
export { BAR_LENGTH_MS, expectedBarOpenUtc, selectFormingBar } from "./formingBar.js";
export {
  InMemoryIntradayValidationStore,
  type IntradayValidationStore,
} from "./store.js";
export {
  runIntradayValidation,
  type Intraday4hSource,
  type OriginalPrediction,
  type RunIntradayValidationDeps,
  type RunIntradayValidationResult,
} from "./runValidation.js";
