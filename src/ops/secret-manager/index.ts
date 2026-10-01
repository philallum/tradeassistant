// SecretManagerProvisioner module (spec Req 3, design Component 4).
//
// Public API for task 6.1: name-only `Env_Key` classification and the
// name-only `SecretProvisionPlan` builder. No `Secret_Key` value is ever read
// into any exported shape (spec Req 3.3, 6.2).

export * from "./classify.js";
export * from "./types.js";
export * from "./provisioner.js";
export * from "./grantVerify.js";
export * from "./deployWorkflow.js";
