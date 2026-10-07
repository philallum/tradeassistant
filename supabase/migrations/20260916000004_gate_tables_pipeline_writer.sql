-- Follow-up Migration: pipeline_writer write path for the gate tables
-- Runs after the dashboard read-views migration (20260916000003_dashboard_read_views_rls.sql)
-- and applies identically across local and hosted Supabase targets (Requirement 17.2).
--
-- Implements dashboard-data-activation Requirement 2.1 / 9.1 (design "RLS risk"): the
-- existing least-privilege migration 20260916000002 granted pipeline_writer INSERT/UPDATE/
-- SELECT (no DELETE) + an RLS policy on the five compute-written tables, but it did NOT
-- cover gate_verdicts, gate_fold_verdicts, or feature_registry. RLS is already ENABLED on
-- gate_verdicts and gate_fold_verdicts (20260916000003), and this migration enables it on
-- feature_registry too — yet no pipeline_writer grant or policy exists on any of the three.
-- With RLS enabled and no matching grant/policy, the hosted Gate_Run's writes through the
-- Scoped_Write_Credential (the pipeline_writer JWT) are REFUSED. This migration closes that
-- gap so the Gate_Run can persist aggregate + per-fold verdicts and the included
-- feature_registry rows.
--
-- Mirrors 20260916000002 exactly: grant select, insert, update (NOT delete) on each gate
-- table to pipeline_writer, and a pipeline_writer_rw RLS policy per table. It names no
-- object owned by 20260916000002 (it touches only the three gate tables) and leaves that
-- migration's five compute-table policies untouched. No secret value or JWT appears here.
--
-- All statements are idempotent / re-runnable so this migration is safe to apply more than
-- once against either target.

-- 1. Ensure RLS is enabled on all three gate tables.
-- gate_verdicts / gate_fold_verdicts were enabled by 20260916000003; feature_registry had
-- no prior RLS. `enable row level security` is idempotent, so re-stating the first two is
-- safe and makes this migration self-contained with respect to the RLS posture it relies on.
alter table gate_verdicts enable row level security;
alter table gate_fold_verdicts enable row level security;
alter table feature_registry enable row level security;

-- 2. Grant SELECT/INSERT/UPDATE (NOT DELETE) on each gate table to pipeline_writer.
-- Schema usage was already granted to pipeline_writer in 20260916000002. The pipeline_writer
-- role and its membership in `authenticator` are likewise established there; this migration
-- adds only the table-level grants the gate write path needs.
grant select, insert, update on gate_verdicts to pipeline_writer;
grant select, insert, update on gate_fold_verdicts to pipeline_writer;
grant select, insert, update on feature_registry to pipeline_writer;

-- 3. RLS policies scoped to pipeline_writer, mirroring 20260916000002's drop-then-create
-- pattern so the migration is re-runnable. The table-level grants above already withhold
-- DELETE, so the write scope is bounded to INSERT/UPDATE/SELECT.
drop policy if exists pipeline_writer_rw on gate_verdicts;
create policy pipeline_writer_rw on gate_verdicts for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on gate_fold_verdicts;
create policy pipeline_writer_rw on gate_fold_verdicts for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on feature_registry;
create policy pipeline_writer_rw on feature_registry for all to pipeline_writer using (true) with check (true);
