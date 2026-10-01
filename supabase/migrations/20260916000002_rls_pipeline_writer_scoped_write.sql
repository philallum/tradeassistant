-- Follow-up Migration: Row-Level Security + Least-Privilege pipeline_writer Role
-- Runs after the strategy-attribution migration (20260916000001_strategy_attribution_realized_outcomes.sql)
-- and applies identically across local and hosted Supabase targets (Requirement 17.2).
--
-- Implements Requirement 8 (operational-wiring): enables Row-Level Security on the
-- five compute-written tables and defines a dedicated least-privilege pipeline_writer
-- role granted only INSERT/UPDATE/SELECT on exactly those tables (no DELETE, no other
-- tables or schemas), with RLS policies scoped to that role (Req 8.1, 8.2).
--
-- The deployed Cloud_Run_Job reaches this role through PostgREST via a signed JWT whose
-- `role` claim selects pipeline_writer (the Scoped_Write_Credential, Req 8.3); the
-- RLS-bypassing service-role key is reserved for operator-run one-off operations and is
-- never deployed into the Job (Req 8.4). No secret value or JWT appears in this migration.
--
-- All statements are idempotent / re-runnable so this migration is safe to apply more
-- than once against either target.

-- 1. Enable Row-Level Security on the five compute-written tables (Req 8.1)
alter table candles enable row level security;
alter table pattern_vectors enable row level security;
alter table analogue_outcomes enable row level security;
alter table firing_setups enable row level security;
alter table realized_outcomes enable row level security;

-- 2. Least-privilege pipeline_writer role (Req 8.2)
-- `create role` lacks IF NOT EXISTS, so guard it in a DO block for re-runnability.
-- NOLOGIN: the role is never logged into directly; it is reached only via the JWT
-- `role` claim resolved by PostgREST.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pipeline_writer') then
    create role pipeline_writer nologin;
  end if;
end
$$;

-- PostgREST connects as the `authenticator` role and switches into the role named
-- by the JWT `role` claim via SET ROLE. For that switch to be permitted, the
-- authenticator must be a MEMBER of pipeline_writer. Without this grant PostgREST
-- rejects a pipeline_writer JWT with `42501: permission denied to set role
-- "pipeline_writer"` (Req 8.3 — the Scoped_Write_Credential must be assumable).
-- Guarded for re-runnability; `authenticator` always exists on a Supabase project.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant pipeline_writer to authenticator;
  end if;
end
$$;

-- Grant schema usage, then SELECT/INSERT/UPDATE (NOT DELETE) on each of the five tables.
grant usage on schema public to pipeline_writer;

grant select, insert, update on candles to pipeline_writer;
grant select, insert, update on pattern_vectors to pipeline_writer;
grant select, insert, update on analogue_outcomes to pipeline_writer;
grant select, insert, update on firing_setups to pipeline_writer;
grant select, insert, update on realized_outcomes to pipeline_writer;

-- 3. RLS policies scoped to pipeline_writer (Req 8.2)
-- One policy per table permitting the row set for pipeline_writer. The table-level
-- grants above already withhold DELETE, so the write scope is bounded to INSERT/UPDATE.
-- Guard with `drop policy if exists` then `create policy` so the migration is re-runnable.
drop policy if exists pipeline_writer_rw on candles;
create policy pipeline_writer_rw on candles for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on pattern_vectors;
create policy pipeline_writer_rw on pattern_vectors for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on analogue_outcomes;
create policy pipeline_writer_rw on analogue_outcomes for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on firing_setups;
create policy pipeline_writer_rw on firing_setups for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on realized_outcomes;
create policy pipeline_writer_rw on realized_outcomes for all to pipeline_writer using (true) with check (true);
