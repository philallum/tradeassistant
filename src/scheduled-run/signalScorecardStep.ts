// Daily-run wiring for the Signal Scorecard (signal-scorecard feature).
// A separate, fail-safe, read-only consumer bolted onto the end of the daily
// run. It does two things each trading day:
//
//   1. RECONCILE the backlog: fill the realized next-session direction of any
//      prior `signal_predictions` rows whose following session has now closed,
//      scoring each directional call against the actual move
//      (`reconcileOutcomes`). "The following day registers the actual outcome"
//      falls out naturally - a prediction made on day D matures the first run on
//      or after D+1 that has D's forward candle.
//
//   2. RECORD today's directions: write one open row per available signal cell
//      per pair with its suggested direction (`recordPredictions`), copied from the
//      per-run Confluence_Matrix. The matrix is built ONCE by the daily run
//      (`buildRunMatrix`) and shared with the `confluence` snapshot slice, so the
//      directions recorded here are by construction the ones the dashboard shows.
//      This step builds nothing itself.
//
// REPLAY GUARD: the `third_party` signal is a LIVE external read (the provider's
// "latest" endpoint) that cannot be reconstructed for a past date. When the run's
// Decision_Date is not the live trading date (an explicit `RUN_DECISION_DATE`
// replay) recording it would store today's value as that date's prediction, which
// the next reconcile would then score. The caller passes `recordThirdParty: false`
// in that case and this step omits only that signal, logging a named notice. The
// other five signals are pure functions of stored candles and replay correctly.
//
// FAIL-SAFE by construction: the whole step is wrapped so any error - a store write
// failure, a candle read failure - is logged secret-free and swallowed. It writes to
// its OWN table only, never to firing_setups, and it feeds nothing the
// firing/confidence/Kill_Gate path reads, so a defect here can never change the
// firing view, the persisted firing rows, or the snapshot.
//
// It runs AFTER the source-of-truth firing rows are persisted, mirroring the
// confluence/edge/track-record slices' placement in `makePersistView`.

import type { TradingDate } from "../guard/types.js";
import type { CandleStore } from "../ingestion/types.js";
import {
  recordPredictions,
  reconcileOutcomes,
  type SignalPredictionStore,
} from "../dashboard/signalScorecard.js";
import type { RunMatrix } from "./confluenceSlice.js";
import { warnEvent } from "./warn.js";

/** The collaborators the scorecard step needs. All read-only except the store. */
export interface SignalScorecardStepDeps {
  /** The run's Decision_Date (`YYYY-MM-DD`). */
  readonly decisionDate: TradingDate;
  /** The scorecard store (Supabase adapter in prod, in-memory in tests). */
  readonly store: SignalPredictionStore;
  /** The Candle storage port (reconcile reads each prediction's forward session). */
  readonly candleStore: CandleStore;
  /**
   * The per-run matrix, built once by the daily run and shared with the confluence slice.
   * `null` means it could not be built; nothing is recorded (the failure was already
   * warned when the matrix was built).
   */
  readonly run: RunMatrix | null;
  /**
   * Whether to record the live-only `third_party` signal. Defaults to `true`. The daily run
   * passes `false` for a replayed (non-live) Decision_Date; see the REPLAY GUARD above.
   */
  readonly recordThirdParty?: boolean;
  /** Called (once) when the `third_party` signal is withheld. Defaults to a named log line. */
  readonly onThirdPartySkipped?: (decisionDate: TradingDate) => void;
  /** Secret-free warning sink. */
  readonly warn?: (step: string, err: unknown) => void;
}

function defaultWarn(step: string, err: unknown): void {
  warnEvent("scheduled_run.signal_scorecard_failed", { step }, err);
}

function defaultThirdPartySkipped(decisionDate: TradingDate): void {
  console.log(
    JSON.stringify({
      event: "signal_scorecard.third_party_skipped",
      decisionDate,
      reason: "decision_date_is_not_the_live_trading_date",
    }),
  );
}

/**
 * Run the daily Signal Scorecard step: reconcile the open backlog, then record
 * today's per-signal directions. NEVER throws - any failure is logged
 * secret-free and swallowed so the run (and every other slice) is unaffected.
 */
export async function runSignalScorecardStep(deps: SignalScorecardStepDeps): Promise<void> {
  const warn = deps.warn ?? defaultWarn;

  // 1. Reconcile the backlog first so a row recorded on a prior day matures as
  //    soon as its forward session exists. Isolated so a reconcile failure does
  //    not prevent today's recording.
  try {
    await reconcileOutcomes(deps.store, deps.decisionDate, deps.candleStore);
  } catch (err) {
    warn("reconcile", err);
  }

  // 2. Record today's directions from the shared per-run matrix.
  try {
    if (deps.run === null) {
      warn("record", new Error("confluence matrix could not be built; skipping record"));
      return;
    }
    const withholdThirdParty = deps.recordThirdParty === false;
    if (withholdThirdParty) {
      (deps.onThirdPartySkipped ?? defaultThirdPartySkipped)(deps.decisionDate);
    }
    await recordPredictions(deps.store, deps.run.matrix, {
      excludeStrategyIds: withholdThirdParty ? ["third_party"] : [],
    });
  } catch (err) {
    warn("record", err);
  }
}
