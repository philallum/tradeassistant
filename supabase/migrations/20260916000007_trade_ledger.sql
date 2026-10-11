-- Migration: trade_ledger — the deterministic Trade_Ledger (trader-edge-validation
-- Stage C, task 5; design R3). Runs after the evaluation_reports / schema-reconcile
-- migration (20260916000006) and applies identically across local and hosted
-- Supabase targets.
--
-- ADDITIVE ONLY: this migration CREATES the `trade_ledger` table and nothing
-- else. It DROPS nothing and touches NO existing table, so applying it (or not
-- applying it) cannot break the daily run — the SupabaseTradeLedgerStore adapter
-- reads fail-safe (absent table → empty) so a torn deploy (code live before the
-- migration, or vice versa) is harmless. All statements are idempotent
-- (`create table/index if not exists`, guarded grants) so it is safe to re-run.
-- No secret value appears here; the single Write_Credential is referenced by its
-- Postgres role name only (`fx_writer`), never by any key material.
--
-- One row per eligible forecast per strategy, keyed by (strategy_id, pair,
-- decision_date) — the system is strategy_id 'system'; a Comparator_Strategy
-- (R5) uses its own id so the same table holds every strategy side by side under
-- one Execution_Model. `fired` is false for a SUPPRESSED forecast kept to
-- evaluate the selection rule (R3.2); `outcome` carries the path-aware
-- classification including 'ambiguous' (R3.5), which is never a win/loss.

create table if not exists trade_ledger (
  strategy_id       text not null,
  pair              text not null,
  decision_date     date not null,
  fired             boolean not null,
  direction         text not null,              -- 'UP' | 'DOWN' | 'FLAT'
  horizon           integer not null,           -- 1 | 2 | 3
  earned_confidence double precision not null,
  entry_price       double precision not null,
  entry_date        date not null,
  stop_loss_pips    double precision,           -- null below the risk-boundary floor
  take_profit_pips  double precision,           -- null below the floor
  outcome           text not null,              -- 'target_first'|'stop_first'|'expired'|'ambiguous'
  gross_pips        double precision not null,
  cost_pips         double precision not null,
  net_pips          double precision not null,
  r_multiple        double precision,           -- null when stop_loss_pips is null
  created_at        timestamptz not null default now(),
  primary key (strategy_id, pair, decision_date)
);

-- Window reads select by decision_date (optionally one strategy), newest-last.
create index if not exists trade_ledger_date_idx
  on trade_ledger (decision_date);
create index if not exists trade_ledger_strategy_date_idx
  on trade_ledger (strategy_id, decision_date);

-- RLS posture matches the other retained tables under the public-data model:
-- hosted Supabase auto-ENABLES RLS on every new public table via a project event
-- trigger, which with NO policy would block both the public read path and the
-- fx_writer write path through PostgREST. Disable RLS so trade_ledger matches
-- the public-data model (idempotent).
alter table if exists trade_ledger disable row level security;

-- Public read (the dashboard reads it with no credential); INSERT/UPDATE
-- restricted to the single Write_Credential role `fx_writer`. Guarded on the
-- role's existence so a target that provisions fx_writer out-of-band still
-- applies the public-read grant cleanly; re-runnable.
grant select on trade_ledger to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fx_writer') then
    grant select, insert, update on trade_ledger to fx_writer;
    -- authenticator must be a MEMBER of fx_writer so PostgREST can SET ROLE for a
    -- fx_writer-claim JWT (mirrors the evaluation_reports / retained-table grants).
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      grant fx_writer to authenticator;
    end if;
  end if;
end
$$;
