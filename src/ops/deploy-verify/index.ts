// DeployVerifier module (spec Req 4, design Component 5).
//
// Public API for task 7.1: the recorded `DeployVerifyResult` outcome, the pure
// execution-status/prerequisite input shapes, and the pure success and
// prerequisite predicates (`evaluateExecution`, `checkPrerequisites`). The live
// `gcloud` wiring (execute Job, describe execution, read Cloud Logging) is
// task 7.5 and is NOT part of this surface. No `Secret_Key` value is ever read
// into or emitted from any exported shape (spec Req 4.6, 6.2).

export * from "./types.js";
export * from "./verifier.js";
