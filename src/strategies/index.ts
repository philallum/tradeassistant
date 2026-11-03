// Multi-Strategy Confluence Engine module public API.
// Requirements 1.1, 6.1.
//
// The signal contract is the one shared vocabulary every producer speaks, and
// `prepareCandles` is the single Look_Ahead_Safe preparation step they all run
// first. The four built-in strategy factories and their config types complete
// the producer surface. Later stages (adapters, the confluence engine, config,
// and the per-run matrix builder) append their exports to this barrel.

export * from "./types.js";
export { prepareCandles } from "./candles.js";

export { createTrendStrategy, DEFAULT_TREND_CONFIG } from "./trend.js";
export type { TrendConfig } from "./trend.js";

export { createBreakoutStrategy, DEFAULT_BREAKOUT_CONFIG } from "./breakout.js";
export type { BreakoutConfig } from "./breakout.js";

export { createRangeStrategy, DEFAULT_RANGE_CONFIG } from "./range.js";
export type { RangeConfig } from "./range.js";

export { createReversalStrategy, DEFAULT_REVERSAL_CONFIG } from "./reversal.js";
export type { ReversalConfig } from "./reversal.js";

export {
  adaptCustomPattern,
  adaptThirdParty,
  DEFAULT_THIRD_PARTY_SCALE,
} from "./adapters.js";
export type { AdapterOutcome, ThirdPartyScoreScale } from "./adapters.js";
export {
  createConfluenceEngine,
  DEFAULT_CONFLUENCE_CONFIG,
} from "./confluenceEngine.js";
export type {
  ConfluenceStatus,
  ConfluenceWeights,
  ConfluenceConfig,
  ConfluenceResult,
  ConfluenceError,
  ConfluenceEngine,
} from "./confluenceEngine.js";

export {
  confluenceConfigFromEnv,
  CONFLUENCE_WEIGHTS_ENV,
  CONFLUENCE_CONFLICT_THRESHOLD_ENV,
  CONFLUENCE_ALIGNMENT_THRESHOLD_ENV,
} from "./config.js";
export type { ConfluenceConfigPartial } from "./config.js";

export { buildConfluenceMatrix } from "./confluenceMatrix.js";
export type {
  PairConfluenceInput,
  CellOutcome,
  PairConfluence,
  ConfluenceMatrix,
  StrategyBundle,
} from "./confluenceMatrix.js";
