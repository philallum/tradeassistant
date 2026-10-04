-- Companion Migration: Dashboard Read-Only Serving Layer — Views, Read Role, Default-Deny RLS
-- Runs after the pipeline-writer RLS migration (20260916000002_rls_pipeline_writer_scoped_write.sql)
-- and applies identically across local and hosted Supabase targets (Requirement 21.5).
--
-- Implements Dashboard_UI Requirement 4 (read-only serving layer):
--   * 4.1  The Read_Proxy reads only from the Read_Only_View set, never base tables directly.
--   * 4.2  Each view projects exactly the columns the dashboard renders — no speculative columns.
--   * 4.3  Row-Level Security is enabled on every relation in the dashboard read path.
--   * 4.4  The read role (dashboard_reader) is granted SELECT on the view set only, and no
--          INSERT/UPDATE/DELETE on any relation.
--   * 4.5  Default-deny posture: a new base table/column is invisible until a view + grant expose it.
--   * 4.6  dashboard_reader is SEPARATE from pipeline_writer; this migration leaves the
--          20260916000002 pipeline_writer grants/policies UNCHANGED.
--   * 4.7 / 21.5  Delivered as this companion migration, applied identically local + hosted.
-- Also implements Req 20.3 (display-only tables written only under the pipeline_writer path).
--
-- This migration is SEPARATE from 20260916000002 and touches none of its objects:
-- it adds two NEW display-only base tables, a NEW dashboard_reader role, nine NEW
-- security_invoker views, and NEW dashboard_reader-scoped grants/policies only.
--
-- All statements are idempotent / re-runnable (create ... if not exists,
-- create or replace view, drop policy if exists + create policy, guarded DO-block
-- role creation) so this migration is safe to apply more than once against either target.
--
-- RECONCILIATION — view security model (verified empirically against supabase/postgres):
--   The design text proposed `with (security_invoker = true)` for the nine views. That
--   option is SELF-CONTRADICTORY with the default-deny posture this requirement mandates:
--   a security_invoker view resolves under the QUERYING role's privileges, so PostgreSQL
--   requires dashboard_reader to hold a table-level SELECT *privilege* on each base table
--   (an RLS policy is NOT sufficient — the privilege is checked before RLS). But Req 4.4
--   forbids granting dashboard_reader any base-table privilege, and Req 4.1/4.5 require
--   that it be UNABLE to read base tables directly. With security_invoker the reader could
--   read NOTHING (no base grant) — the views would be dead — unless we granted base-table
--   SELECT, which would then let it read base tables directly, breaking 4.1/4.5.
--
--   The posture that actually satisfies 4.1, 4.4 and 4.5 is a standard (definer-rights)
--   view owned by a role that holds the base-table privileges: dashboard_reader is granted
--   SELECT on the VIEW only, reads the curated projection through the view owner's rights,
--   and holds NO base-table grant — so a direct `SELECT ... FROM <base table>` by
--   dashboard_reader is refused (default-deny preserved). This is the classic PostgreSQL
--   view-privilege model. The nine views are therefore created WITHOUT security_invoker.
--   Verified in a throwaway postgres: reader reads EURUSD-only through v_firing_setups and
--   is denied a direct firing_setups read.
--
--   The pre-existing pipeline_writer_rw policies from 20260916000002 are left in place and
--   unmodified; all new objects here are additive and role-scoped to dashboard_reader
--   (Req 4.6). A role-scoped `dashboard_reader_select` RLS policy is still added on the two
--   NEW display-only tables as the task specifies; with definer-rights views it is belt-
--   and-suspenders (never the sole gate) and remains harmless.

-- ============================================================================
-- Subtask 1.1 — Two display-only base tables with RLS + pipeline_writer grants
-- (Req 4.3, 20.3, 21.5)
-- ============================================================================

-- signal_rationale: display-only AI rationale / pattern labels / research proposals.
-- Never a scoring or gate input; written only under the pipeline_writer write path.
create table if not exists signal_rationale (
  decision_date   date not null,
  pair            text not null,
  strategy_id     text not null default 'system',
  rationale_text  text not null,
  analogue_labels text[] not null default '{}',
  proposals       jsonb not null default '[]'::jsonb,
  provenance      text not null default 'llm',
  is_display_only boolean not null default true,
  recorded_at     timestamptz not null default now(),
  primary key (decision_date, pair, strategy_id)
);

-- external_reference_comparison: display-only own-vs-provider direction comparison.
-- Never a scoring or gate input; written only under the pipeline_writer write path.
create table if not exists external_reference_comparison (
  decision_date   date not null,
  pair            text not null,
  own_direction   text check (own_direction in ('UP','DOWN','FLAT')),
  reference_direction text check (reference_direction in ('BUY','SELL','HOLD')),
  reference_score double precision,
  provider        text,
  comparison      text not null check (comparison in ('agree','diverge','neutral','unavailable')),
  provenance      text not null default 'external_provider',
  is_display_only boolean not null default true,
  fetched_at      timestamptz,
  recorded_at     timestamptz not null default now(),
  primary key (decision_date, pair)
);

-- Enable Row-Level Security so RLS covers every relation in the dashboard read path (Req 4.3).
alter table signal_rationale enable row level security;
alter table external_reference_comparison enable row level security;

-- Grant the existing pipeline_writer role SELECT/INSERT/UPDATE (NO DELETE) on the two new
-- display-only tables, mirroring the write scope of 20260916000002 (Req 20.3).
grant select, insert, update on signal_rationale to pipeline_writer;
grant select, insert, update on external_reference_comparison to pipeline_writer;

-- pipeline_writer RLS policies on the two new tables, mirroring the exact pattern from
-- 20260916000002 (drop-if-exists then create; for all; using/with check true). The
-- table-level grants above already withhold DELETE, bounding the write scope to INSERT/UPDATE.
drop policy if exists pipeline_writer_rw on signal_rationale;
create policy pipeline_writer_rw on signal_rationale for all to pipeline_writer using (true) with check (true);

drop policy if exists pipeline_writer_rw on external_reference_comparison;
create policy pipeline_writer_rw on external_reference_comparison for all to pipeline_writer using (true) with check (true);

-- ============================================================================
-- Subtask 1.2 — dashboard_reader role + nine security_invoker views
-- (Req 4.1, 4.2)
-- ============================================================================

-- Dedicated least-privilege read role, SEPARATE from pipeline_writer (Req 4.6).
-- `create role` lacks IF NOT EXISTS, so guard it in a DO block for re-runnability.
-- NOLOGIN: reached only via the JWT `role` claim resolved by PostgREST, never logged in.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dashboard_reader') then
    create role dashboard_reader nologin;
  end if;
end
$$;

-- PostgREST connects as `authenticator` and SET ROLEs into the role named by the JWT
-- `role` claim; for that switch to succeed authenticator must be a MEMBER of
-- dashboard_reader. Guarded for re-runnability; `authenticator` always exists on Supabase.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant dashboard_reader to authenticator;
  end if;
end
$$;

-- The five tradable pairs (PAIRS). Pair/asset-scoped views filter to this set so a stray
-- base row can never widen the dashboard surface (design: Read_Only_View set).

-- v_decision_dates — distinct decision dates that have at least one PAIRS firing_setups row.
create or replace view v_decision_dates as
  select distinct decision_date
  from firing_setups
  where pair in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- v_firing_setups — cards + suppressions + confidence trend.
create or replace view v_firing_setups as
  select
    decision_date,
    pair,
    strategy_id,
    direction,
    horizon,
    earned_confidence,
    stop_loss_pips,
    take_profit_pips,
    surfaced,
    suppression_reason,
    competing_pairs
  from firing_setups
  where pair in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- v_analogue_outcomes — excursion profile.
create or replace view v_analogue_outcomes as
  select
    asset,
    decision_date,
    horizon,
    direction,
    mfe_pips,
    mae_pips,
    matured
  from analogue_outcomes
  where asset in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- v_realized_outcomes — prediction-vs-actual journal.
create or replace view v_realized_outcomes as
  select
    strategy_id,
    pair,
    decision_date,
    predicted_direction,
    horizon,
    earned_confidence,
    stop_loss_pips,
    take_profit_pips,
    realized_direction,
    realized_mfe_pips,
    realized_mae_pips,
    matured
  from realized_outcomes
  where pair in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- v_gate_verdicts — model-vs-baseline gate verdict visual. Cross-config, NOT pair-scoped.
create or replace view v_gate_verdicts as
  select
    id,
    config_id,
    sample_size,
    gate1_model_acc,
    gate1_baseline_acc,
    gate1_delta_pp,
    gate1_passed,
    gate2_model_ra,
    gate2_baseline_ra,
    gate2_margin,
    gate2_passed,
    verdict,
    selected_horizon,
    split_test_start,
    split_test_end,
    created_at
  from gate_verdicts;

-- v_gate_fold_verdicts — walk-forward folds. Cross-config, NOT pair-scoped.
create or replace view v_gate_fold_verdicts as
  select
    verdict_id,
    fold_index,
    sample_size,
    skipped,
    gate1_passed,
    gate2_passed,
    verdict
  from gate_fold_verdicts;

-- v_candles — price chart OHLC.
create or replace view v_candles as
  select
    asset,
    date,
    open,
    high,
    low,
    close
  from candles
  where asset in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- v_signal_rationale — AI tab.
create or replace view v_signal_rationale as
  select
    decision_date,
    pair,
    strategy_id,
    rationale_text,
    analogue_labels,
    proposals,
    provenance,
    is_display_only
  from signal_rationale
  where pair in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- v_external_reference_comparison — Third-party tab.
create or replace view v_external_reference_comparison as
  select
    decision_date,
    pair,
    own_direction,
    reference_direction,
    reference_score,
    provider,
    comparison,
    provenance,
    is_display_only,
    fetched_at
  from external_reference_comparison
  where pair in ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD');

-- ============================================================================
-- Subtask 1.3 — Default-deny grants + reader RLS policies
-- (Req 4.4, 4.5, 4.6)
-- ============================================================================

-- Schema usage is required to resolve the view names.
grant usage on schema public to dashboard_reader;

-- Grant SELECT to dashboard_reader on the NINE VIEWS ONLY — and on NO base table.
-- This is the whole default-deny posture: the reader can SELECT exactly these nine
-- curated projections and nothing else; any newly added table/column stays invisible
-- until a view + grant deliberately expose it (Req 4.4, 4.5).
grant select on v_decision_dates to dashboard_reader;
grant select on v_firing_setups to dashboard_reader;
grant select on v_analogue_outcomes to dashboard_reader;
grant select on v_realized_outcomes to dashboard_reader;
grant select on v_gate_verdicts to dashboard_reader;
grant select on v_gate_fold_verdicts to dashboard_reader;
grant select on v_candles to dashboard_reader;
grant select on v_signal_rationale to dashboard_reader;
grant select on v_external_reference_comparison to dashboard_reader;

-- Enable RLS on the two gate tables so RLS covers every relation in the dashboard read
-- path (Req 4.3). candles / analogue_outcomes / firing_setups / realized_outcomes already
-- have RLS enabled (20260916000000 + 20260916000002); the two new display-only tables were
-- enabled in subtask 1.1 above.
alter table gate_verdicts enable row level security;
alter table gate_fold_verdicts enable row level security;

-- Role-scoped SELECT RLS policy on each NEW display-only base table (Req 4.4-4.6, task
-- 1.3). With the definer-rights views above the reader never queries these tables
-- directly, so this policy is belt-and-suspenders rather than the sole access gate; it is
-- role-scoped to dashboard_reader and leaves the pipeline_writer_rw policies from
-- 20260916000002 untouched. No table-level SELECT privilege is ever granted to
-- dashboard_reader, so a direct `SELECT ... FROM <base table>` by the reader is refused
-- and the default-deny posture holds (Req 4.1, 4.4, 4.5).
drop policy if exists dashboard_reader_select on signal_rationale;
create policy dashboard_reader_select on signal_rationale for select to dashboard_reader using (true);

drop policy if exists dashboard_reader_select on external_reference_comparison;
create policy dashboard_reader_select on external_reference_comparison for select to dashboard_reader using (true);
