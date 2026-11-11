// Research cost model: XTB standard account (spread only), pips per trade.
//
// Spread = BrokerChooser's published XTB averages for standard accounts (EURUSD 0.8, GBPUSD 0.9,
// USDJPY 1.1, USDCAD 1.6; USDCHF 1.8 from a search snippet because the page could not be opened).
// Commission 0 (XTB standard accounts charge spread only; not independently verified). Slippage is
// kept from exec-v1 as a conservative extra. Spreads widen in fast or off-peak markets, so real
// costs can be higher. A measurement input only: it never feeds firing, confidence or scoring.
import type { ExecutionModel } from "../../trade-sim/executionModel.js";

export const XTB_STANDARD_MODEL: ExecutionModel = {
  id: "xtb-standard-v1",
  entryReference: "next_session_open",
  perPairCost: {
    EURUSD: { spreadPips: 0.8, commissionPips: 0, slippagePips: 0.2 },
    GBPUSD: { spreadPips: 0.9, commissionPips: 0, slippagePips: 0.3 },
    USDJPY: { spreadPips: 1.1, commissionPips: 0, slippagePips: 0.2 },
    USDCHF: { spreadPips: 1.8, commissionPips: 0, slippagePips: 0.3 },
    USDCAD: { spreadPips: 1.6, commissionPips: 0, slippagePips: 0.3 },
  },
};
