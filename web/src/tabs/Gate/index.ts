/**
 * Public surface of the Gate Category_Tab (task 9.4).
 *
 * The shell wires the tab in by importing `GateTab` from here (tab-to-shell wiring is task
 * 9.6). The sub-components and pure helpers are re-exported for the tab's own unit/example
 * and accessibility tests (tasks 9.7, 9.8).
 */

export { GateTab } from "./GateTab";
export type { GateTabProps, GateVerdictsLoader, GateFoldVerdictsLoader } from "./GateTab";
export { GateVerdictCard } from "./GateVerdictCard";
export type { GateVerdictCardProps } from "./GateVerdictCard";
export { GateFoldList } from "./GateFoldList";
export type { GateFoldListProps } from "./GateFoldList";
export { selectLatestVerdict } from "./selectVerdict";
export * from "./format";
