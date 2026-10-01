// Job write-credential selector module (spec Req 8, design Component 9).
//
// Public API for task 12.2: the name/config-only credential descriptor shapes
// and the pure `selectJobWriteCredential` selector that resolves the deployed
// Cloud_Run_Job's write path to the Scoped_Write_Credential — never the
// Service_Role_Key (spec Req 8.4) and never the publishable/anon key
// (spec Req 8.5). The live role/credential creation + deploy injection is
// task 12.3/12.4; the Property 26 test is colocated here. No `Secret_Key` value
// is ever read into or emitted from any exported shape (spec Req 8.8, 6.2).

export * from "./types.js";
export {
  selectJobWriteCredential,
  JOB_WRITE_CREDENTIAL_KIND,
} from "./selector.js";
export {
  JOB_HOSTED_WRITE_ENV_KEY,
  SERVING_LAYER_PUBLISHABLE_ENV_KEY,
  OPERATOR_SERVICE_ROLE_ENV_KEY,
  JOB_HOSTED_CREDENTIAL_CANDIDATES,
  resolveJobWriteCredential,
  assertJobWriteCredentialScoped,
} from "./jobWriteConfig.js";
