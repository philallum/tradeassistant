/**
 * Public surface of the Pattern & Outcomes tab (task 9.3).
 *
 * Exports the `PatternOutcomesTab` the shell wiring (task 9.6) mounts, plus the loader type
 * for callers that want to inject their own data source (tests, storybook-style harnesses).
 */

export { PatternOutcomesTab } from "./PatternOutcomesTab";
export type {
  PatternOutcomesTabProps,
  PatternOutcomesLoaders,
} from "./PatternOutcomesTab";
