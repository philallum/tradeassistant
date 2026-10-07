-- Follow-up Migration: Diagnostic_Read_Path — least-privilege read-only diagnostic role
-- Runs after the gate-tables pipeline_writer migration
-- (20260916000004_gate_tables_pipeline_writer.sql) and applies identically across local and
-- hosted Supabase targets (Requirement 17.2).
--
-- Implements dashboard-data-activation Requirement 6 (Service-Role-Key Diagnostic Policy):
--   * 6.1  Establishes a durable Diagnostic_Read_Path — a read-only diagnostic Postgres role
--          (diagnostic_reader) that returns exact hosted row counts for routine read-only
--          verification WITHOUT requiring the Service_Role_Key.
--   * 6.5  The role is granted ONLY the read access required to return row counts: SELECT on
--          exactly the counted tables, USAGE on schema public. It is granted NO write
--          (no INSERT/UPDATE/DELETE) and NO RLS-bypassing capability (NOT a superuser, no
--          BYPASSRLS). RLS policies permit SELECT for this role where RLS is enabled so the
--          role can read counts without ever bypassing RLS.
--
-- The role is reached through PostgREST via a signed JWT whose `role` claim selects
-- diagnostic_reader (a Scoped_Read_Credential), exactly as pipeline_writer / dashboard_reader
-- are reached (20260916000002 / 20260916000003). The RLS-bypassing Service_Role_Key is NEVER
-- used for routine diagnostics (spec Req 6.3) and never appears in this migration. The
-- rationale and operating policy are recorded in supabase/DIAGNOSTIC_READ_PATH_POLICY.md
-- (spec Req 6.2, 6.4).
--
-- The counted tables are the compute-written + gate tables whose exact row counts matter for
-- routine hosted verification: candles, pattern_vectors, analogue_outcomes, firing_setups,
-- realized_outcomes, gate_verdicts, gate_fold_verdicts, feature_registry.
--
-- All statements are idempotent / re-runnable so this migration is safe to apply more than
-- once against either target. No secret value or JWT appears here.

-- 1. Least-privilege diagnostic_reader role (Req 6.1, 6.5)
-- `create role` lacks IF NOT EXISTS, so guard it in a DO block for re-runnability.
-- NOLOGIN: the role is never logged into directly; it is reached only via the JWT `role`
-- claim resolved by PostgREST. NO superuser, NO BYPASSRLS, NO createrole/createdb — the
-- defaults are the least-privilege posture, and we assert them explicitly for clarity.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'diagnostic_reader') then
    create role diagnostic_reader nologin nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
end
$$;

-- PostgREST connects as the `authenticator` role and switches into the role named by the JWT
-- `role` claim via SET ROLE. For that switch to be permitted, the authenticator must be a
-- MEMBER of diagnostic_reader. Without this grant PostgREST rejects a diagnostic_reader JWT
-- with `42501: permission denied to set role "diagnostic_reader"`. Guarded for
-- re-runnability; `authenticator` always exists on a Supabase project.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant diagnostic_reader to authenticator;
  end if;
end
$$;

-- 2. Grant schema usage, then SELECT (and ONLY SELECT) on each counted table (Req 6.5).
-- No INSERT/UPDATE/DELETE is granted, so the diagnostic path can read counts and nothing
-- more. `grant` is idempotent / re-runnable.
grant usage on schema public to diagnostic_reader;

grant select on candles to diagnostic_reader;
grant select on pattern_vectors to diagnostic_reader;
grant select on analogue_outcomes to diagnostic_reader;
grant select on firing_setups to diagnostic_reader;
grant select on realized_outcomes to diagnostic_reader;
grant select on gate_verdicts to diagnostic_reader;
grant select on gate_fold_verdicts to diagnostic_reader;
grant select on feature_registry to diagnostic_reader;

-- 3. RLS SELECT policies scoped to diagnostic_reader (Req 6.5)
-- RLS is enabled on every counted table (20260916000000 + 20260916000002 for candles /
-- pattern_vectors / analogue_outcomes / firing_setups / realized_outcomes; 20260916000003 +
-- 20260916000004 for gate_verdicts / gate_fold_verdicts / feature_registry). Because the
-- role holds NO RLS-bypass, a read-only SELECT policy is required for it to see any rows.
-- One SELECT-only policy per table permitting the full row set for diagnostic_reader; the
-- table-level grants above withhold every write, so this policy can never widen the scope
-- beyond reads. Guard with `drop policy if exists` then `create policy` so the migration is
-- re-runnable. These are additive and role-scoped to diagnostic_reader; the pipeline_writer
-- and dashboard_reader policies from earlier migrations are left untouched.
drop policy if exists diagnostic_reader_select on candles;
create policy diagnostic_reader_select on candles for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on pattern_vectors;
create policy diagnostic_reader_select on pattern_vectors for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on analogue_outcomes;
create policy diagnostic_reader_select on analogue_outcomes for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on firing_setups;
create policy diagnostic_reader_select on firing_setups for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on realized_outcomes;
create policy diagnostic_reader_select on realized_outcomes for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on gate_verdicts;
create policy diagnostic_reader_select on gate_verdicts for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on gate_fold_verdicts;
create policy diagnostic_reader_select on gate_fold_verdicts for select to diagnostic_reader using (true);

drop policy if exists diagnostic_reader_select on feature_registry;
create policy diagnostic_reader_select on feature_registry for select to diagnostic_reader using (true);
