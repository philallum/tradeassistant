/**
 * Tab router (task 9.6).
 *
 * Replaces the task-9.1 `TabPanelPlaceholder` in the app shell with the real routing from
 * the active {@link TabId} to the matching Category_Tab component (tasks 9.2–9.5). It is a
 * thin, pure-presentational switch: it mounts exactly one tab for the active id and passes
 * the two shell-owned signals every tab needs.
 *
 * Signals passed down:
 *   - `refreshNonce` — bumped by the shell's refresh control; each tab that accepts it
 *     re-issues its own fetch with the api client's cache-bust transform (Req 17.1, 17.2).
 *     The Gate tab does not expose a `refreshNonce` prop (it is cross-config, not per the
 *     browsed date), so refresh is wired to it by remounting it with `key={refreshNonce}`,
 *     which re-runs its initial fetch — the same end-to-end "fresh fetch" effect (Req 17.1).
 *   - `decisionDate` — the EFFECTIVE Decision_Date (the browsed date when available, else
 *     the resolved latest, else `null`), already computed by the shell via the pure
 *     `selectBrowseDate`. Only the per-pair tabs that query a single date (AI, Third-party)
 *     take it; the Setups and Pattern & Outcomes tabs resolve their own effective date from
 *     the shared selection store, and the Gate tab is date-independent.
 *
 * This component recomputes nothing and does no fetching of its own — each tab owns its data
 * loading and its loading / empty / error states (task 9.6).
 */

import type { JSX } from "react";

import type { TabId } from "../routing/routes";
import { AiTab } from "../tabs/Ai";
import { GateTab } from "../tabs/Gate";
import { PatternOutcomesTab } from "../tabs/PatternOutcomes";
import { SetupsTab } from "../tabs/Setups";
import { ThirdPartyTab } from "../tabs/ThirdParty";

export interface TabRouterProps {
  /** The active Category_Tab to render (from `useRoute`). */
  readonly tab: TabId;
  /** Bumped by the shell on refresh so each tab re-fetches fresh data (Req 17.1, 17.2). */
  readonly refreshNonce: number;
  /**
   * The effective Decision_Date (browsed-or-latest-or-null), resolved by the shell. Passed
   * to the per-pair single-date tabs (AI, Third-party).
   */
  readonly decisionDate: string | null;
}

/**
 * Render the Category_Tab component for the active {@link TabId}. The switch is exhaustive
 * over the five tab ids; every tab renders its own ARIA `tabpanel` wrapper and its own
 * loading / empty / error states.
 */
export function TabRouter({ tab, refreshNonce, decisionDate }: TabRouterProps): JSX.Element {
  switch (tab) {
    case "setups":
      return <SetupsTab refreshNonce={refreshNonce} />;
    case "pattern-outcomes":
      return <PatternOutcomesTab refreshNonce={refreshNonce} />;
    case "gate":
      // GateTab has no refreshNonce prop (cross-config, date-independent); remounting it on
      // a refresh re-runs its initial fetch, giving the same fresh-fetch effect (Req 17.1).
      return <GateTab key={refreshNonce} />;
    case "ai":
      return <AiTab decisionDate={decisionDate} refreshNonce={refreshNonce} />;
    case "third-party":
      return (
        <ThirdPartyTab decisionDate={decisionDate} refreshNonce={refreshNonce} />
      );
  }
}
