// Track-record (look-ahead-safe replay) module public API.

export {
  REPLAYABLE_STRATEGY_IDS,
  DEFAULT_TRACK_RECORD_LOOKBACK_DAYS,
  realizedDirectionAfter,
  replayDates,
  replayClassicalRecords,
  patternRecords,
  type PairCandles,
  type ReplayArgs,
  type PatternOutcomeInput,
  type ReplayableStrategyId,
} from "./strategyRecord.js";
export {
  DEFAULT_RANGE_RECORD_LOOKBACK_DAYS,
  replayRangeRecords,
  type RangeForecastAt,
  type RangeRecordArgs,
} from "./rangeRecord.js";
export { buildTrackRecordSlice, type TrackRecordSliceDeps } from "./trackRecordSlice.js";
export { memoizeMaturedOutcomes } from "./memoizedAnalogueStore.js";
