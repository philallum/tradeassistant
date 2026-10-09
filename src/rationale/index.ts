// Signal Rationale & Pattern Description module public API — Component 9 roles
// `signal_rationale` / `pattern_description` (Requirement 15).
//
// The OUTWARD-ONLY display layer: plain-language rationale derived from the
// deterministic numeric signal (15.1, 15.2) and qualitative analogue labels
// (15.3), both produced as `LlmTagged<…>` display-only values so they are
// excluded from the directional-probability and Kill_Gate verdict computations
// by construction (15.4; the AI / Deterministic boundary). Every call routes
// through the single `LlmInterface.invoke()` gateway (Requirement 2.4).

export type {
  SignalNumericInputs,
  AnalogueSummary,
  SignalRationaleText,
  AnalogueLabels,
} from "./types.js";
export { generateSignalRationale, generatePatternDescription } from "./rationale.js";
export type {
  DailyCommentaryPair,
  DailyCommentaryInput,
  DailyCommentaryText,
} from "./dailyCommentary.js";
export { generateDailyCommentary, toDailyCommentaryInput } from "./dailyCommentary.js";
