// Supabase `firing_setups` writer for the `persistView` seam (design Component 3).
//
// Implements the `DashboardViewPersister` type (src/scheduled-run/scheduledRun.ts)
// by writing a produced `DashboardView` — the firing cards — to the
// `firing_setups` table:
//   decision_date, pair, direction, horizon, earned_confidence,
//   stop_loss_pips, take_profit_pips, surfaced, suppression_reason, strategy_id
//   PK (decision_date, pair, strategy_id)
//
// A rendered card is a `surfaced = true` row with no suppression_reason. There
// are no dashboard-level suppressors: the Currency_Concentration_Guard
// (Requirement 3.3) and the Choppiness_Guard (Requirement 3.1) have been
// removed, so the view carries only firing cards and the writer emits no
// suppression rows (and no `competing_pairs` plumbing). Upsert is idempotent on
// the primary key so re-running the same Decision_Date rewrites its rows rather
// than duplicating them.

import type {
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
  };
}

/** Build the rows for a `DashboardView`: one surfaced card row per firing pair. */
export function firingSetupRows(
  view: DashboardView,
): Record<string, unknown>[] {
  return view.cards.map((card) => cardRow(view.decisionDate, card));
}

/**
 * Build a `DashboardViewPersister` bound to a resolved {@link SupabaseConfig}.
 * Writes the view's firing cards to `firing_setups`. The `SupabaseConfig.key` is
 * a `Secret_Key`, carried only in request headers by the REST client and never
 * logged.
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
