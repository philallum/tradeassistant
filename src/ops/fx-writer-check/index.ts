// fx_writer scoped-write check module (spec simplify-to-cloud-minimal task
// 5.2a.4; Req 4.5, 4.6, 8.4). Public surface: the pure verdict classifier and
// the live runner. No Secret_Key value is read into or emitted from any
// exported shape.

export * from "./types.js";
export { classifyVerdict, runFxWriterCheck, type FxWriterCheckDeps } from "./fxWriterCheck.js";
