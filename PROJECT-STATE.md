<!-- LIVING-DOCS:PROJECT-STATE -->
# PROJECT-STATE.md — Current Project State

> Living state document (Requirement 5.1). The current-state section below is
> maintained by the Living-Docs Writer (`updateState()`); everything between the
> `BEGIN`/`END STATE` markers is machine-managed and rewritten on each update.

<!-- BEGIN STATE -->
- **Phase:** Operational Wiring (operational-wiring spec) — cloud half; Task 12 complete, Task 13 final checkpoint pending
- **Updated:** 2026-10-01
- **Summary:** fx-daily-pattern-assistant foundation complete. operational-wiring Tasks 1–10 and 12 done: CsvLoader, Supabase storage adapters (three PORTs), StagedRunner (backfill/backtest/forward-look), OperationalSafety guard, SecretManagerProvisioner, DeployVerifier, SchedulerProvisioner, hosted Supabase backfill, and least-privilege hosted write access. Task 12 live: RLS on the five compute tables + least-privilege pipeline_writer role (no DELETE) + authenticator membership; Scoped_Write_Credential is an ES256 JWT signed with an operator-held BYO key (project uses asymmetric JWT keys), set as the supabase-key secret; SupabaseRestClient splits apikey (publishable) vs Bearer (scoped JWT). Verified live against trade-assistant-508806: scoped INSERT/UPDATE succeed, DELETE/out-of-scope denied; manual Cloud Run Job execution succeeded on the deployed header-split image. Remaining: Task 13 final checkpoint.
<!-- END STATE -->

## Notes

The state block above is rewritten in place by `LivingDocs.updateState()`. Prose
outside the markers is preserved across updates.
