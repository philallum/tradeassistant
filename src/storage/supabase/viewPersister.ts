// Supabase `firing_setups` writer for the `persistView` seam (design Component 3).
//
// Implements the `DashboardViewPersister` type (src/scheduled-run/scheduledRun.ts)
// by writing a produced `DashboardView` — the firing cards AND the
// currency-concentration / choppiness suppressions — to the `firing_setups`
// table:
//   decision_date, pair, direction, horizon, earned_confidence,
//   stop_loss_pips, take_profit_pips, surfaced, suppression_reason,
//   competing_pairs, strategy_id
//   PK (decision_date, pair, strategy_id)
//
// A rendered card is a `surfaced = true` row with no suppression_reason; a
// suppression is a `surfaced = false` row carrying its fixed reason
// (`currency_concentration` or `too_choppy`). Upsert is idempotent on the
// primary key so re-running the same Decision_Date rewrites its rows rather than
// duplicating them. This replaces ONLY the throwing `persistView` stub in
// main.ts; the runner and pipeline are unchanged.

import type {
  DashboardSuppression,
  DashboardView,
  FiringCard,
} from "../../dashboard/index.js";
import type {
  DashboardViewPersister,
} from "../../scheduled-run/scheduledRun.js";
import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";

const FIRING_SETUPS = "firing_setups";

/** The v1 deterministic system Strategy_Source (schema default 'system'). */
const SYSTEM_STRATEGY_ID = "system";

function cardRow(decisionDate: string, card: FiringCard): Record<string, unknown> {
  return {
    decision_date: decisionDate,
    pair: card.pair,
    strategy_id: SYSTEM_STRATEGY_ID,
    direction: card.direction,
    horizon: card.horizon,
    earned_confidence: card.earnedConfidence,
    stop_loss_pips: card.stopLossPips,
    take_profit_pips: card.takeProfitPips,
    surfaced: true,
    suppression_reason: null,
    competing_pairs: null,
  };
}

function suppressionRow(
  decisionDate: string,
  suppression: DashboardSuppression,
): Record<string, unknown> {
  // A suppression carries no directional signal (the guards are suppressors,
  // never sources). `direction`/`horizon` are NOT NULL in the schema, so a
  // suppressed row records the fixed non-directional sentinels FLAT / horizon 1
  // alongside surfaced=false and the guard's reason.
  const competingPairs =
    suppression.reason === "currency_concentration"
      ? [...suppression.competingPairs]
      : null;
  return {
    decision_date: decisionDate,
    pair: suppression.pair,
    strategy_id: SYSTEM_STRATEGY_ID,
    direction: "FLAT",
    horizon: 1,
    earned_confidence: 0,
    stop_loss_pips: null,
    take_profit_pips: null,
    surfaced: false,
    suppression_reason: suppression.reason,
    competing_pairs: competingPairs,
  };
}

/** Build the rows for a `DashboardView`: surfaced cards + suppressed setups. */
export function firingSetupRows(
  view: DashboardView,
): Record<string, unknown>[] {
  return [
    ...view.cards.map((card) => cardRow(view.decisionDate, card)),
    ...view.suppressed.map((s) => suppressionRow(view.decisionDate, s)),
  ];
}

/**
 * Build a `DashboardViewPersister` bound to a resolved {@link SupabaseConfig}.
 * Writes the view's firing cards + suppressions to `firing_setups`. The
 * `SupabaseConfig.key` is a `Secret_Key`, carried only in request headers by the
 * REST client and never logged.
 */
export function makeSupabaseViewPersister(
  supabase: SupabaseConfig,
  fetchImpl?: typeof fetch,
): DashboardViewPersister {
  const client =
    fetchImpl === undefined
      ? new SupabaseRestClient(supabase)
      : new SupabaseRestClient(supabase, fetchImpl);
  return async (view: DashboardView): Promise<void> => {
    await client.upsert(
      FIRING_SETUPS,
      firingSetupRows(view),
      "decision_date,pair,strategy_id",
    );
  };
}
