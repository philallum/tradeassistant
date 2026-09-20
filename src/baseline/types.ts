// Weekly-Trend-Follow Baseline Types (Requirement 11.1, Design Component 6).

import type { Candle, TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";

/**
 * The null-hypothesis predictor whose predicted direction equals the
 * Weekly_Trend_Sign at the Decision_Date: the 5-trading-day rolling
 * rate-of-change sign of the close (UP if Close_T - Close_{T-5} >= 0, else DOWN).
 * (Requirement 11.1)
 *
 * Design Component 6 specifies `predict(decisionDate, pair): DirectionClass`.
 * Because the baseline is a pure, deterministic function with no hidden mutable
 * state (Requirement 3.2), the past candle `window` is supplied explicitly rather
 * than fetched internally. The Look-Ahead Guard is enforced on the window so no
 * candle dated at or after `decisionDate` can influence the prediction.
 */
export interface Baseline {
  /**
   * Returns the 5-trading-day rolling ROC sign for the pre-`decisionDate`
   * window: always UP or DOWN, never FLAT and never a calendar-week trend.
   */
  predict(window: readonly Candle[], decisionDate: TradingDate): DirectionClass;
}
