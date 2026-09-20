// Confidence & Horizon Selector module public API — Component 5.
// Requirements 1.4, 10.1–10.7.

export * from "./types.js";
export {
  confidenceSelector,
  earnedConfidence,
  classify,
  selectHorizon,
  rawResolutionRate,
  analogueCount,
} from "./confidenceSelector.js";
export { computeAtr14, trueRange, ATR_LOOKBACK } from "./atr.js";
