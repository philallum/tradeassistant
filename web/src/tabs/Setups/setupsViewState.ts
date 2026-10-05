/**
 * Pure Setups-tab view-state resolver (property-testable — Req 19 spirit).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock
 * (`Date.now()`), and imports NOTHING from the deterministic core (`src/`). It is a
 * deterministic function of its inputs alone and recomputes nothing — it only CLASSIFIES
 * an already-shaped {@link SetupsViewModel} (produced by the pure `shapeDashboardView`
 * shaper) into the one display state the Setups tab must render.
 *
 * Keeping this classification pure means the Setups tab's own branching — "no data for this
 * date", "no data for this pair on this date", the silent "no setups fired" day, or actual
 * content — is exercised in `web/`'s own vitest + fast-check toolchain without a browser or
 * network (render tests for the component itself are deferred to tasks 9.7/9.8, which run
 * under jsdom). The impure component (`SetupsTab.tsx`) only reads this classification and
 * draws the matching region.
 *
 * The state table mirrors the design's empty-state matrix (design §Empty / error states):
 *
 * | Condition                                           | State              | Req        |
 * |-----------------------------------------------------|--------------------|------------|
 * | selected date has NO rows                           | `no-data-date`     | 7.4        |
 * | a specific pair is selected, rows exist, but that   | `no-data-pair`     | 8.7        |
 * |   pair has no card AND no suppression               |                    |            |
 * | rows exist but none surfaced (cross-pair)           | `silent`           | 13.1, 13.2 |
 * | otherwise                                           | `content`          | 8.3, 9.*   |
 *
 * Crucially, `suppressions` on the view model are ALWAYS cross-pair (the shaper never
 * filters them by pair — Req 8.5), so a currency-concentration suppression and its
 * `competing_pairs` stay visible regardless of the active pair. That is why the `silent`
 * state is evaluated BEFORE and INDEPENDENTLY of the pair-scoped empty check: a day whose
 * rows are all suppressions must show "no setups fired" plus those suppressions (Req 13.2),
 * never the pair-scoped "no data for this pair" banner that would hide them.
 */

import type { SetupsViewModel } from "../../pure/shapeDashboard";
import { ALL_PAIRS, type PairSelection } from "../../state/selection";

/**
 * The four mutually-exclusive display states the Setups tab can be in once rows have been
 * fetched and shaped. (In-flight loading and transport errors are handled separately by the
 * impure tab from the fetch lifecycle — task 9.6 — and are NOT a function of the view model,
 * so they are not part of this pure classification.)
 */
export type SetupsViewState =
  /** No rows at all for the selected Decision_Date — "no data for this date" (Req 7.4). */
  | "no-data-date"
  /**
   * A specific pair is selected and the date HAS rows, but that pair contributes neither a
   * surfaced card nor a suppression — "no data for this pair on this date" (Req 8.7).
   */
  | "no-data-pair"
  /**
   * Rows exist but none surfaced — the silent "no setups fired" day. Any suppressions are
   * still rendered alongside the message (Req 13.1, 13.2).
   */
  | "silent"
  /** At least one surfaced card (within the current scope) is shown, or content exists. */
  | "content";

/**
 * Does the suppression list carry an entry for `pair`? Suppressions are cross-pair, so this
 * only asks whether this particular pair happens to appear among them — used to decide
 * whether a single-pair selection truly has nothing of its own to show (Req 8.7).
 */
function suppressionsIncludePair(
  model: SetupsViewModel,
  pair: PairSelection,
): boolean {
  return model.suppressions.some((s) => s.pair === pair);
}

/**
 * Classify a shaped {@link SetupsViewModel} + the active {@link PairSelection} into the one
 * {@link SetupsViewState} the tab should render. Pure and total over every input.
 *
 * Precedence (first match wins):
 *   1. `no-data-date`  — the date has no rows at all (`!hasRows`). Nothing to show (Req 7.4).
 *   2. `silent`        — rows exist but none surfaced (`isSilent`). Shows "no setups fired"
 *                        plus the (cross-pair) suppressions (Req 13.1, 13.2). Checked before
 *                        the pair-scoped empty case so suppressions are never hidden.
 *   3. `no-data-pair`  — a specific pair is selected, rows exist and some surfaced, but this
 *                        pair has neither a card nor a suppression of its own (Req 8.7).
 *   4. `content`       — there is something surfaced to show in the current scope.
 */
export function resolveSetupsViewState(
  model: SetupsViewModel,
  pair: PairSelection,
): SetupsViewState {
  if (!model.hasRows) {
    return "no-data-date";
  }
  if (model.isSilent) {
    return "silent";
  }
  if (pair !== ALL_PAIRS) {
    const hasPairCard = model.cards.length > 0; // shaper already scoped cards to `pair`
    const hasPairSuppression = suppressionsIncludePair(model, pair);
    if (!hasPairCard && !hasPairSuppression) {
      return "no-data-pair";
    }
  }
  return "content";
}
