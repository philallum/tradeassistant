/**
 * Public surface of the Setups Category_Tab (task 9.2).
 *
 * The shell (task 9.6) imports {@link SetupsTab} from here to mount the tab. The pure
 * view-state resolver and its types are re-exported for the tab's own tests and for any
 * sibling that needs the Setups state classification.
 */

export { SetupsTab } from "./SetupsTab";
export type {
  SetupsTabProps,
  DecisionDatesLoader,
  FiringSetupsLoader,
} from "./SetupsTab";
export { FiringCard } from "./FiringCard";
export { SuppressionList } from "./SuppressionList";
export { resolveSetupsViewState } from "./setupsViewState";
export type { SetupsViewState } from "./setupsViewState";
