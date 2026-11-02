/**
 * Public surface of the Evaluation (Gate) Category_Tab.
 *
 * The shell wires the tab in by importing `GateTab` from here. The report card and pure
 * helpers are re-exported for the tab's own unit/example and accessibility tests.
 */

export { GateTab } from "./GateTab";
export type { GateTabProps, EvaluationReportsLoader, NetEvaluationLoader, NetEvaluationSlices } from "./GateTab";
export { EvaluationReportCard } from "./EvaluationReportCard";
export type { EvaluationReportCardProps } from "./EvaluationReportCard";
export { selectLatestReport } from "./selectReport";
export * from "./format";
export { NetEvaluationSection } from "./NetEvaluationSection";
