-- Migration: intraday_validations — the read-only intraday 4H-candle validation
-- ledger (intraday-validation feature). Runs after the signal_predictions
-- migration (20260916000009) and applies identically across local and hosted
-- Supabase targets.
--
-- PURPOSE: keep a permanent, dated record of the intraday 4H enrichment produced
-- a few hours after the immutable daily prediction. For each (decision_date,
-- pair) it stores a SNAPSHOT of the original daily direction/confidence being
-- validated (audit — never a mutation of the daily rows), the forming 4H bar's
-- minimal OHLC, the derived shape features, and the deterministic validation
-- outcome (state + bounded confidence delta + current confidence + reason). The
-- features are stored so the feature's actual usefulness can be MEASURED later
-- without recomputation ("measure before believing"); the confidence delta is a
-- bounded, UNVALIDATED adjustment, NOT a calibrated probability.
--
-- ADDITIVE ONLY: this migration CREATES the `intraday_validations` table and
-- nothing else. It DROPS nothing and touches NO existing table, so applying it
-- (or not) cannot break the daily run — the SupabaseIntradayValidationStore
-- adapter reads/writes fail-safe (absent table → empty / swallowed) so a torn
-- deploy (code live before the migration, or vice versa) is harmless. All
-- statements are idempotent (`create table/index if not exists`, guarded grants)
-- so it is safe to re-run. No secret value appears here; the single
-- Write_Credential is referenced by its Postgres role name only (`fx_writer`).
--
-- One row per (decision_date, pair). A re-run for the same day overwrites via
-- the idempotent merge upsert on the composite PK.

create table if not exists intraday_validations (
  decision_date        date not null,
  pair                 text not null,
  original_direction   text not null,              -- 'UP' | 'DOWN' | 'FLAT' (snapshot; untouched)
  original_confidence  numeric not null,           -- percentage points [0,100] (snapshot; untouched)
  validation_timestamp timestamptz not null,       -- when the forming 4H bar was observed
  bar_open_utc         timestamptz not null,       -- forming bar's open instant (UTC boundary audit)
  h4_open              numeric not null,
  h4_high              numeric not null,
  h4_low               numeric not null,
  h4_current_price     numeric not null,           -- close-so-far of the forming bar
  body                 numeric not null,           -- currentPrice - open (signed)
  range                numeric not null,           -- high - low
  upper_wick           numeric not null,
  lower_wick           numeric not null,
  validation_state     text not null,              -- STRONGLY_SUPPORTS|SUPPORTS|NEUTRAL|CONTRADICTS|STRONGLY_CONTRADICTS|NOT_APPLICABLE
  confidence_delta     numeric not null,           -- bounded [-10,+10] percentage points
  current_confidence   numeric not null,           -- clamp(original + delta, 0, 100)
  reason               text not null,              -- plain-language, display-only
  created_at           timestamptz not null default now(),
  primary key (decision_date, pair)
);

-- Reads: by decision_date (one day's validation) and across a window for the
-- later usefulness analysis.
create index if not exists intraday_validations_date_idx
  on intraday_validations (decision_date);

-- RLS posture matches the other retained tables under the public-data model:
-- hosted Supabase auto-ENABLES RLS on every new public table, which with NO
-- policy would block both the public read path and the fx_writer write path
-- through PostgREST. Disable RLS so intraday_validations matches the public-data
-- model (idempotent).
alter table if exists intraday_validations disable row level security;

-- Public read (the dashboard reads it with no credential); INSERT/UPDATE
-- restricted to the single Write_Credential role `fx_writer`. Guarded on the
-- role's existence so a target that provisions fx_writer out-of-band still
-- applies the public-read grant cleanly; re-runnable.
grant select on intraday_validations to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fx_writer') then
    grant select, insert, update on intraday_validations to fx_writer;
    -- authenticator must be a MEMBER of fx_writer so PostgREST can SET ROLE for a
    -- fx_writer-claim JWT (mirrors the signal_predictions / retained-table grants).
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      grant fx_writer to authenticator;
    end if;
  end if;
end
$$;
