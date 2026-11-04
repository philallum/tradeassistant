// Expected candle size (range forecast) module public API.

export type {
  ExpectedRange,
  RangeBucket,
  RangeCutoffs,
  RangeHorizon,
} from "./types.js";
export {
  deriveExpectedRange,
  spanRatio,
  tercileCutoffs,
  bucketOf,
  RANGE_NEIGHBOURHOOD_FLOOR,
  RANGE_HISTORY_FLOOR,
} from "./expectedRange.js";
export { realizedSpanPips, realizedBucket } from "./realized.js";
