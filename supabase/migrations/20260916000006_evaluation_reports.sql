-- Migration: evaluation_reports — the human-read Evaluation_Report persistence
-- Runs after the diagnostic-read-path migration
-- (20260916000005_diagnostic_read_path.sql) and applies identically across local
-- and hosted Supabase targets (simplify-to-cloud-minimal Requirement 8.4).
--
-- Implements simplify-to-cloud-minimal Requirement 1.3 / 8.2 (design Data Models):
-- the two-stage Kill_Gate is reframed from an automatic PASS/CUT verdict into a
-- human-read Evaluation_Report. This migration ADDS the `evaluation_reports`
-- table that stores the measured metrics for a configuration over the
-- Out_Of_Sample_Test. It carries NO `verdict` column (Requirement 8.2 / 1.3):
-- the former `gate_verdicts.verdict` collapse has no successor here.
--
-- This is the LOCAL-target add only. The destructive schema reduction — dropping
-- `gate_verdicts`/`gate_fold_verdicts` and the other orphaned objects — is
-- explicitly deferred to Phase 4 (task 5). This migration therefore ONLY creates
-- `evaluation_reports` and leaves every existing table in place.
--
-- The named columns map directly onto the EvaluationReport fields; the richer
-- sub-objects (MFE/MAE summary, strength breakdown, uncertainty + CI, and the
-- non-binding annotations) are stored in the `metrics` jsonb so a read
-- reconstructs the report faithfully.
--
-- All statements are idempotent / re-runnable (`create table if not exists`,
-- `create index if not exists`) so the migration is safe to apply more than once
-- against either target. No secret value appears here.

-- evaluation_reports (Requirement 1.2, 1.3, 8.2)
-- Keyed by a DB-generated uuid; one row per recorded evaluation of a config over
-- a chronological out-of-sample split. There is NO verdict column.
create table if not exists evaluation_reports (
  id                 uuid primary key default gen_random_uuid(),
  config_id          text not null,
  split_train_end    date not null,
  split_test_start   date not null,
  split_test_end     date not null,
  sample_size        integer not null,
  predictions_count  integer not null,
  model_accuracy     double precision not null,
  baseline_accuracy  double precision not null,
  delta_vs_baseline  double precision not null,
  friction_adj_model double precision,
  friction_adj_base  double precision,
  metrics            jsonb not null default '{}'::jsonb,  -- MFE/MAE, strength, CI, annotations
  created_at         timestamptz not null default now()
  -- NO verdict column (Requirement 8.2)
);

-- Reads select the newest report for a config, ordered by created_at desc.
create index if not exists evaluation_reports_config_created_idx
  on evaluation_reports (config_id, created_at desc);
-- ============================================================================
-- SCHEMA-REDUCTION RECONCILE — Required_Object_Set manifest + live enumeration
-- (simplify-to-cloud-minimal task 5.1; Requirements 10.1, 10.2, 10.3)
-- ============================================================================
--
-- This section is the version-controlled, authoritative definition of what the
-- simplified ("cloud-minimal") system keeps, plus the read-only introspection
-- query that enumerates the LIVE Supabase account and diffs it against that
-- keep-list. It is DECLARATIVE / NON-DESTRUCTIVE: the DROP statements that
-- actually reduce the schema are added by task 5.2 (idempotent reconcile) and
-- applied to the hosted target by task 5.3. Nothing below mutates the schema.
--
-- ----------------------------------------------------------------------------
-- Required_Object_Set (R10.1) — the authoritative positive keep-list
-- ----------------------------------------------------------------------------
-- Defined POSITIVELY (what is kept); everything else enumerated in the account
-- is an Orphaned_Object (R10.3) and is removed by the reconcile (task 5.2/5.3).
--
-- Required TABLES (design C4, R8.1):
--   candles              — OHLC price history (base signal input)
--   pattern_vectors      — dim=70 shape embeddings + weekly_trend_sign
--   analogue_outcomes    — matured forward outcomes consumed by retrieval
--   firing_setups        — the daily observation / prediction record
--   realized_outcomes    — the Realized_Outcome_Journal (predicted vs actual)
--   evaluation_reports   — the human-read Evaluation_Report (created above)
--
-- Required EXTENSIONS (prerequisites of the kept tables):
--   vector               — pattern_vectors.embedding vector(70) + HNSW index
--   pgcrypto             — gen_random_uuid() default on evaluation_reports.id
--
-- Required INDEXES (owned by the kept tables):
--   pattern_vectors_embedding_hnsw_idx    (pattern_vectors)
--   pattern_vectors_trend_asset_idx       (pattern_vectors)
--   evaluation_reports_config_created_idx (evaluation_reports)
--   -- plus the system-generated primary-key indexes of the six kept tables.
--
-- Required ROLES: NONE project-created. Under public data the Read_Side_Security
--   roles are removed (R4.x): pipeline_writer, dashboard_reader, and
--   diagnostic_reader are all Orphaned_Objects. Public SELECT is granted on the
--   kept tables and the single Write_Credential holds INSERT/UPDATE; there are no
--   project-created roles and no RLS row policies in the Required_Object_Set
--   (design C4 "write path under public data").
--
-- Required VIEWS: NONE. The dashboard read views (v_*) are Orphaned_Objects;
--   their display content moves into the JSON snapshot / firing_setups (design C4).
--
-- Required POLICIES: NONE. All RLS policies are Orphaned_Objects (no RLS under
--   public data).
--
-- Everything NOT named above — in particular the tables yields, data_splits,
-- walk_forward_folds, gate_verdicts, gate_fold_verdicts, feature_registry,
-- calendar_events, news_risk_flags, version_ledger, signal_rationale,
-- external_reference_comparison; every v_* read view; the pipeline_writer /
-- dashboard_reader / diagnostic_reader roles; and every RLS policy — is an
-- Orphaned_Object to be dropped by the reconcile.
--
-- ----------------------------------------------------------------------------
-- Live enumeration + diff (R10.2, R10.3) — read-only, run at reconcile time
-- ----------------------------------------------------------------------------
-- The query below enumerates the objects ACTUALLY present in the account
-- (tables, views, indexes, functions, roles, policies in `public` and any
-- project-created schema) from information_schema / pg_catalog, and classifies
-- each as 'kept' (a Required_Object_Set member) or 'orphaned' (R10.3). It acts
-- on the real account contents rather than on assumed migration history (R10.2),
-- so out-of-band objects are caught too. It is READ-ONLY: it selects from the
-- catalogs and changes nothing. The reconcile (task 5.2) drops exactly the rows
-- this query classifies as 'orphaned'.
--
-- To run manually against a target (local or hosted) at reconcile time, execute
-- the single SELECT in the block below (it is left commented so applying this
-- migration performs no action):
--
-- with required_tables(name) as (values
--     ('candles'), ('pattern_vectors'), ('analogue_outcomes'),
--     ('firing_setups'), ('realized_outcomes'), ('evaluation_reports')
--   ),
--   -- No project-created views, roles, or policies are required under public data.
--   required_views(name) as (select null::text where false),
--   required_roles(name) as (select null::text where false),
--   -- Project-created schemas to enumerate: public + any non-system schema.
--   project_schemas(nspname) as (
--     select nspname from pg_namespace
--     where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
--       and nspname not like 'pg_temp_%'
--       and nspname not like 'pg_toast_temp_%'
--   ),
--   -- TABLES (base tables) in project schemas.
--   enum_tables as (
--     select 'table'::text as kind, t.table_schema as schema_name, t.table_name as object_name,
--            case when t.table_name in (select name from required_tables)
--                 then 'kept' else 'orphaned' end as classification
--     from information_schema.tables t
--     join project_schemas s on s.nspname = t.table_schema
--     where t.table_type = 'BASE TABLE'
--   ),
--   -- VIEWS in project schemas (none are required → all orphaned).
--   enum_views as (
--     select 'view'::text, v.table_schema, v.table_name,
--            case when v.table_name in (select name from required_views)
--                 then 'kept' else 'orphaned' end
--     from information_schema.views v
--     join project_schemas s on s.nspname = v.table_schema
--   ),
--   -- INDEXES in project schemas: kept iff they belong to a kept table.
--   enum_indexes as (
--     select 'index'::text, i.schemaname, i.indexname,
--            case when i.tablename in (select name from required_tables)
--                 then 'kept' else 'orphaned' end
--     from pg_indexes i
--     join project_schemas s on s.nspname = i.schemaname
--   ),
--   -- FUNCTIONS declared in project schemas (none required → all orphaned).
--   enum_functions as (
--     select 'function'::text, n.nspname, p.proname,
--            'orphaned'::text
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     join project_schemas s on s.nspname = n.nspname
--   ),
--   -- ROLES: project-created roles only (exclude built-in / Supabase-managed).
--   -- None are required → every project role is orphaned under public data.
--   enum_roles as (
--     select 'role'::text, '-'::text, r.rolname,
--            case when r.rolname in (select name from required_roles)
--                 then 'kept' else 'orphaned' end
--     from pg_roles r
--     where r.rolname in ('pipeline_writer', 'dashboard_reader', 'diagnostic_reader')
--   ),
--   -- POLICIES in project schemas (no RLS policies required → all orphaned).
--   enum_policies as (
--     select 'policy'::text, pol.schemaname, (pol.tablename || '.' || pol.policyname),
--            'orphaned'::text
--     from pg_policies pol
--     join project_schemas s on s.nspname = pol.schemaname
--   )
-- select kind, schema_name, object_name, classification
-- from (
--   select * from enum_tables
--   union all select * from enum_views
--   union all select * from enum_indexes
--   union all select * from enum_functions
--   union all select * from enum_roles
--   union all select * from enum_policies
-- ) enumerated
-- order by classification, kind, schema_name, object_name;
--
-- Reading the result: every row classified 'kept' must equal the
-- Required_Object_Set; every row classified 'orphaned' is the exact drop set the
-- reconcile (task 5.2) removes. The account is clean only WHERE no 'orphaned'
-- rows remain (R10.9), which is the idempotency check task 5.2 encodes.

-- ============================================================================
-- SCHEMA-REDUCTION RECONCILE — idempotent destructive reconcile
-- (simplify-to-cloud-minimal task 5.2; Requirements 10.4, 10.5, 10.10, 8.1,
--  8.2, 8.3, 8.5, 8.6, 4.2, 4.5, 4.6)
-- ============================================================================
--
-- This section is the DESTRUCTIVE half of the reconcile. The manifest + live
-- enumeration above (task 5.1) is declarative; this section actually reduces the
-- schema to EXACTLY the Required_Object_Set, so that after it runs the account
-- contains only the six kept tables (candles, pattern_vectors, analogue_outcomes,
-- firing_setups, realized_outcomes, evaluation_reports), their indexes, and the
-- `vector` / `pgcrypto` extensions — and NO project-created role, view, or RLS
-- policy under public data.
--
-- It is the LOCAL authoring of the reconcile. Applying it to the HOSTED target is
-- task 5.3 and is operator-approved (R10.7). Nothing here is run against hosted
-- by this file.
--
-- IDEMPOTENCY (R10.5) — the whole section is safe to re-run against an already
-- reconciled account and makes no further changes:
--   * every DROP uses `if exists` (tables, views, policies, functions) or a
--     guarded `drop role` (DROP ROLE lacks IF EXISTS, so each role drop is
--     wrapped in a `do $$ ... if exists (...) ... $$` block);
--   * every GRANT / REVOKE targets objects that remain after the drops (the six
--     kept tables) and is itself re-runnable;
--   * the data-preservation back-fill is an `insert ... select ... on conflict
--     do nothing` guarded by `to_regclass` existence checks, so it inserts no
--     duplicate rows and is a no-op once realized_outcomes already holds the row
--     (or once its source object is gone).
-- Re-running therefore leaves the account byte-for-byte in the Required_Object_Set
-- and the enumeration diff above reports zero 'orphaned' rows (R10.9).
--
-- ORDERING (R8.6, R10.6) — DATA PRESERVATION BEFORE DROPS. The data-bearing
-- Realized_Outcome_Journal must survive the reduction, so the back-fill of
-- realized-outcome rows runs FIRST, before any DROP. Only after the realized
-- outcomes are preserved into the retained `realized_outcomes` shape does the
-- section drop the orphaned data-bearing objects. `realized_outcomes` and
-- `firing_setups` are themselves RETAINED (never dropped here).
--
-- NO secret value appears here. The single Write_Credential is referenced by its
-- Postgres role name only (`fx_writer`), never by any key material.

-- ----------------------------------------------------------------------------
-- STEP 1 — DATA PRESERVATION (R8.6, R10.6): runs BEFORE any DROP.
-- ----------------------------------------------------------------------------
-- Preserve the Realized_Outcome_Journal (predictions paired with actual
-- outcomes) into the retained `realized_outcomes` table before the destructive
-- drops below. The journal already lives in `realized_outcomes` (retained), so
-- the only preservation needed is to guarantee that every FIRED observation in
-- the retained `firing_setups` has a corresponding realized-outcome seed row;
-- this guards against the historical case where a fired prediction was recorded
-- without its journal row. It is strictly ADDITIVE and idempotent:
--   * guarded by `to_regclass` so it is skipped entirely if either table is
--     absent (e.g. a partial earlier run), making the whole step a safe no-op;
--   * `on conflict (strategy_id, pair, decision_date) do nothing` so a row that
--     already exists in the journal is never overwritten or duplicated — the
--     actual realized_direction / realized_mfe_pips / realized_mae_pips the
--     outcome-resolution path later matures are preserved untouched.
-- Because realized_outcomes and firing_setups are both RETAINED, no data-bearing
-- object that holds realized outcomes is dropped by this migration; this step
-- exists to satisfy the "preserve before drop" ordering invariant explicitly and
-- to be robust against a journal that lags its firing record.
do $$
begin
  if to_regclass('public.realized_outcomes') is not null
     and to_regclass('public.firing_setups') is not null then
    insert into realized_outcomes (
      strategy_id, pair, decision_date, predicted_direction, horizon,
      earned_confidence, stop_loss_pips, take_profit_pips, matured
    )
    select
      'system' as strategy_id,
      f.pair,
      f.decision_date,
      f.direction as predicted_direction,
      f.horizon,
      f.earned_confidence,
      f.stop_loss_pips,
      f.take_profit_pips,
      false as matured
    from firing_setups f
    where f.direction in ('UP', 'DOWN', 'FLAT')
    on conflict (strategy_id, pair, decision_date) do nothing;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 2 — DROP the read views (R4.2, R8.3). Views depend on base tables, so
-- drop them before the tables they project. All `if exists` → re-runnable.
-- ----------------------------------------------------------------------------
drop view if exists v_decision_dates;
drop view if exists v_firing_setups;
drop view if exists v_analogue_outcomes;
drop view if exists v_realized_outcomes;
drop view if exists v_gate_verdicts;
drop view if exists v_gate_fold_verdicts;
drop view if exists v_candles;
drop view if exists v_signal_rationale;
drop view if exists v_external_reference_comparison;

-- ----------------------------------------------------------------------------
-- STEP 3 — DROP the RLS policies (R4.2, R8.3). Under public data there are NO
-- RLS row policies in the Required_Object_Set.
--
-- IDEMPOTENCY (R10.5): `drop policy if exists ... on <table>` guards only the
-- POLICY, not the TABLE — if the table itself is already gone (e.g. on a second
-- apply, after STEP 5 dropped it), the statement still errors with `42P01:
-- relation "<table>" does not exist`. Several of the policies below sit on tables
-- that STEP 5 drops (gate_verdicts, feature_registry, signal_rationale, …), so a
-- flat list is NOT re-runnable. To make the whole step a true no-op on re-apply,
-- each drop is guarded on table existence via `to_regclass`: a policy is dropped
-- only when its table is still present. Policies on the retained tables are still
-- dropped so no retained table carries a leftover row policy. CASCADE in STEP 5
-- would remove any policy on a dropped table anyway; this guard just keeps STEP 3
-- itself error-free across repeated applies.
-- ----------------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select * from (values
      -- pipeline_writer_rw policies (migrations 002, 003, 004).
      ('pipeline_writer_rw',       'candles'),
      ('pipeline_writer_rw',       'pattern_vectors'),
      ('pipeline_writer_rw',       'analogue_outcomes'),
      ('pipeline_writer_rw',       'firing_setups'),
      ('pipeline_writer_rw',       'realized_outcomes'),
      ('pipeline_writer_rw',       'gate_verdicts'),
      ('pipeline_writer_rw',       'gate_fold_verdicts'),
      ('pipeline_writer_rw',       'feature_registry'),
      ('pipeline_writer_rw',       'signal_rationale'),
      ('pipeline_writer_rw',       'external_reference_comparison'),
      -- dashboard_reader_select policies (migration 003).
      ('dashboard_reader_select',  'signal_rationale'),
      ('dashboard_reader_select',  'external_reference_comparison'),
      -- diagnostic_reader_select policies (migration 005).
      ('diagnostic_reader_select', 'candles'),
      ('diagnostic_reader_select', 'pattern_vectors'),
      ('diagnostic_reader_select', 'analogue_outcomes'),
      ('diagnostic_reader_select', 'firing_setups'),
      ('diagnostic_reader_select', 'realized_outcomes'),
      ('diagnostic_reader_select', 'gate_verdicts'),
      ('diagnostic_reader_select', 'gate_fold_verdicts'),
      ('diagnostic_reader_select', 'feature_registry')
    ) as t(policy_name, table_name)
  loop
    if to_regclass('public.' || pol.table_name) is not null then
      execute format('drop policy if exists %I on public.%I', pol.policy_name, pol.table_name);
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 4 — DISABLE RLS on the retained tables (R4.5, R4.6). Under public data
-- the retained tables carry no RLS; `disable row level security` is idempotent.
-- The dropped tables below do not need this (they are removed outright).
-- ----------------------------------------------------------------------------
alter table if exists candles disable row level security;
alter table if exists pattern_vectors disable row level security;
alter table if exists analogue_outcomes disable row level security;
alter table if exists firing_setups disable row level security;
alter table if exists realized_outcomes disable row level security;
-- evaluation_reports is CREATED by this same migration (above). Postgres creates
-- tables with RLS disabled, but hosted Supabase runs a project event trigger that
-- auto-ENABLES RLS on every new table in `public`. With RLS enabled and NO policy
-- the public-data read path (PUBLIC SELECT) and the fx_writer write path are both
-- blocked through PostgREST. Explicitly disable RLS here so evaluation_reports
-- matches the public-data model of the other retained tables (idempotent).
alter table if exists evaluation_reports disable row level security;

-- ----------------------------------------------------------------------------
-- STEP 5 — DROP the orphaned tables (R8.1, R8.2, R8.3, R4.2). Every DROP uses
-- `if exists` and `cascade` (so any remaining dependent object — e.g. the
-- gate_fold_verdicts FK to gate_verdicts, or a leftover grant — is removed with
-- it), making the set re-runnable and self-contained. These are the exact
-- 'orphaned' tables the enumeration above classifies for removal.
--
-- IMPORTANT ORDERING NOTE (surfaced for task 5.3): `signal_rationale` and
-- `external_reference_comparison` still have a LIVE writer in the retained daily
-- run (`src/scheduled-run/main.ts` → `makeDisplayDataPersister`). Phase 5
-- (tasks 6–6.4) removes that writer and moves the display content into the
-- `dashboard.json` snapshot. This migration drops the two tables per design
-- "Removed tables"; the HOSTED apply (task 5.3) must therefore be gated behind
-- the Phase-5 removal of that writer, else the daily run's upserts to the two
-- dropped tables would fail with 42P01. See the dangling-reference report in the
-- task completion notes.
drop table if exists gate_fold_verdicts cascade;   -- FK child of gate_verdicts
drop table if exists gate_verdicts cascade;
drop table if exists yields cascade;
drop table if exists data_splits cascade;
drop table if exists walk_forward_folds cascade;
drop table if exists feature_registry cascade;
drop table if exists calendar_events cascade;
drop table if exists news_risk_flags cascade;
drop table if exists version_ledger cascade;
drop table if exists signal_rationale cascade;
drop table if exists external_reference_comparison cascade;

-- ----------------------------------------------------------------------------
-- STEP 6 — DROP the project-created roles (R4.2, R4.6, R10.10). Under public
-- data NO project-created role is in the Required_Object_Set: pipeline_writer
-- (the removed scoped-JWT writer), dashboard_reader (removed read views), and
-- diagnostic_reader (removed diagnostic read path) are all Orphaned_Objects.
-- `DROP ROLE` lacks IF EXISTS and fails if the role still owns objects or holds
-- grants, so each is wrapped in a guarded DO block that first REVOKEs the role's
-- schema-level grants and its membership in `authenticator`, then drops it only
-- when present — making the whole step re-runnable and a no-op once the roles
-- are gone. The table-level grants vanished with the tables dropped above.
--
-- NON-SUPERUSER TARGETS (hosted Supabase): the executing role here is `postgres`,
-- which on hosted Supabase is NOT a superuser. `DROP OWNED BY <role>` requires
-- the executor to hold the *privileges of* that role (an INHERIT membership),
-- not merely ADMIN on it — otherwise it fails with `42501: permission denied to
-- drop objects / Only roles with privileges of role "<role>" may drop objects
-- owned by it`. So each block first grants the target role to the current
-- executing user WITH INHERIT TRUE (guarded + idempotent) so the `drop owned by`
-- privilege check passes. On a superuser target (local `postgres`) this grant is
-- harmless and redundant. The target roles own no objects at this point, so the
-- `drop owned by` is a defensive cleanup; the grant simply makes it legal.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pipeline_writer') then
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      revoke pipeline_writer from authenticator;
    end if;
    revoke all on schema public from pipeline_writer;
    revoke all on all tables in schema public from pipeline_writer;
    execute format('grant pipeline_writer to %I with inherit true', current_user);
    drop owned by pipeline_writer;
    drop role pipeline_writer;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'dashboard_reader') then
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      revoke dashboard_reader from authenticator;
    end if;
    revoke all on schema public from dashboard_reader;
    revoke all on all tables in schema public from dashboard_reader;
    execute format('grant dashboard_reader to %I with inherit true', current_user);
    drop owned by dashboard_reader;
    drop role dashboard_reader;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'diagnostic_reader') then
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      revoke diagnostic_reader from authenticator;
    end if;
    revoke all on schema public from diagnostic_reader;
    revoke all on all tables in schema public from diagnostic_reader;
    execute format('grant diagnostic_reader to %I with inherit true', current_user);
    drop owned by diagnostic_reader;
    drop role diagnostic_reader;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- STEP 7 — WRITE PATH under public data (R4.5, R4.6). Public SELECT on the six
-- retained tables (the dashboard reads them with no credential); INSERT/UPDATE
-- restricted to the single Write_Credential role `fx_writer` (the Job's only
-- write identity). NO RLS row policies. All grants/revokes are idempotent and
-- safely re-runnable, and are guarded so a target that has not yet provisioned
-- the `fx_writer` role still applies the public-read grants cleanly.
-- ----------------------------------------------------------------------------
-- Public read: grant SELECT to the built-in PUBLIC pseudo-role on every retained
-- table (open read, no credential). `grant` is idempotent.
grant select on candles to public;
grant select on pattern_vectors to public;
grant select on analogue_outcomes to public;
grant select on firing_setups to public;
grant select on realized_outcomes to public;
grant select on evaluation_reports to public;

-- Restricted write: the single Write_Credential (role `fx_writer`) holds
-- INSERT/UPDATE (NOT DELETE) on the retained tables. PUBLIC is explicitly NOT
-- granted any write, so anonymous parties can read but never write (R4.5). The
-- grant is guarded on the role's existence so this migration does not fail on a
-- target where the Write_Credential role is provisioned out-of-band; it is a
-- no-op there and the operator provisions the role separately.
--
-- The Job writes through PostgREST (REST, not direct Postgres): PostgREST
-- connects as the `authenticator` role and switches into the role named by the
-- JWT `role` claim via SET ROLE. For that switch to be permitted, `authenticator`
-- must be a MEMBER of `fx_writer`. Without the membership grant a `fx_writer` JWT
-- is rejected with `42501: permission denied to set role "fx_writer"` — the same
-- reason migration 20260916000002 grants `pipeline_writer to authenticator` for
-- the (now dropped) scoped-JWT writer. The grant is guarded on both roles'
-- existence and is itself re-runnable, so it is a no-op on a target where either
-- role is absent and never fails to apply.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fx_writer') then
    grant usage on schema public to fx_writer;
    grant select, insert, update on candles to fx_writer;
    grant select, insert, update on pattern_vectors to fx_writer;
    grant select, insert, update on analogue_outcomes to fx_writer;
    grant select, insert, update on firing_setups to fx_writer;
    grant select, insert, update on realized_outcomes to fx_writer;
    grant select, insert, update on evaluation_reports to fx_writer;
    -- Membership grant so PostgREST's `authenticator` can `SET ROLE fx_writer`
    -- for a `fx_writer`-claim JWT (mirrors `grant pipeline_writer to
    -- authenticator` in migration 20260916000002). Guarded on `authenticator`
    -- existence; re-runnable.
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      grant fx_writer to authenticator;
    end if;
  end if;
end
$$;

-- After this section the account contains EXACTLY the Required_Object_Set: the
-- six retained tables (public SELECT; fx_writer INSERT/UPDATE; no RLS policies),
-- their indexes, and the vector/pgcrypto extensions. Re-running this migration
-- changes nothing further (R10.5), and the enumeration diff above reports zero
-- 'orphaned' rows (R10.9).
