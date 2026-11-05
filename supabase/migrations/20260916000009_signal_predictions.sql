-- Migration: signal_predictions — the per-signal daily direction scorecard
-- (signal-scorecard feature). Runs after the frozen_baselines migration
-- (20260916000008) and applies identically across local and hosted Supabase
-- targets.
--
-- PURPOSE: keep a permanent, dated record of what EACH of the six signals
-- (trend, breakout, range, reversal, custom_pattern, third_party) suggested for
-- a pair on a given Decision_Date (UP | DOWN | FLAT), and — once the following
-- session has closed — what the market actually did, so we can see which signal
-- was historically right or wrong. Unlike the replay-based `trackRecord`
-- snapshot slice, this captures the NON-REPLAYABLE third_party signal (a live
-- external read that cannot be reconstructed) and every day's pattern call, not
-- just fired days.
--
-- ADDITIVE ONLY: this migration CREATES the `signal_predictions` table and
-- nothing else. It DROPS nothing and touches NO existing table, so applying it
-- (or not) cannot break the daily run — the SupabaseSignalPredictionStore
-- adapter reads/writes fail-safe (absent table → empty / swallowed) so a torn
-- deploy (code live before the migration, or vice versa) is harmless. All
-- statements are idempotent (`create table/index if not exists`, guarded grants)
-- so it is safe to re-run. No secret value appears here; the single
-- Write_Credential is referenced by its Postgres role name only (`fx_writer`).
--
-- One row per (decision_date, pair, strategy_id). `predicted_direction` is
-- written the day the signal is registered; `realized_direction` / `correct`
-- stay NULL until the next session matures and a later run reconciles them.
-- `correct` counts a directional (UP/DOWN) call only — a FLAT prediction is an
-- abstention and is recorded with `correct = null` even once matured.

create table if not exists signal_predictions (
  decision_date       date not null,
  pair                text not null,
  strategy_id         text not null,              -- trend|breakout|range|reversal|custom_pattern|third_party
  predicted_direction text not null,              -- 'UP' | 'DOWN' | 'FLAT'
  realized_direction  text,                       -- 'UP' | 'DOWN' | 'FLAT'; null until matured
  correct             boolean,                     -- null until matured; null for a FLAT prediction (abstention)
  created_at          timestamptz not null default now(),
  reconciled_at       timestamptz,                 -- set when realized_direction is filled
  primary key (decision_date, pair, strategy_id)
);

-- Reads: by decision_date (one day's registration) and the unreconciled backlog
-- (realized_direction is null) for the reconciliation pass.
create index if not exists signal_predictions_date_idx
  on signal_predictions (decision_date);
create index if not exists signal_predictions_unreconciled_idx
  on signal_predictions (decision_date)
  where realized_direction is null;

-- RLS posture matches the other retained tables under the public-data model:
-- hosted Supabase auto-ENABLES RLS on every new public table, which with NO
-- policy would block both the public read path and the fx_writer write path
-- through PostgREST. Disable RLS so signal_predictions matches the public-data
-- model (idempotent).
alter table if exists signal_predictions disable row level security;

-- Public read (the dashboard reads it with no credential); INSERT/UPDATE
-- restricted to the single Write_Credential role `fx_writer`. Guarded on the
-- role's existence so a target that provisions fx_writer out-of-band still
-- applies the public-read grant cleanly; re-runnable.
grant select on signal_predictions to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fx_writer') then
    grant select, insert, update on signal_predictions to fx_writer;
    -- authenticator must be a MEMBER of fx_writer so PostgREST can SET ROLE for a
    -- fx_writer-claim JWT (mirrors the trade_ledger / retained-table grants).
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      grant fx_writer to authenticator;
    end if;
  end if;
end
$$;
