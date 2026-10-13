-- Migration: frozen_baselines — the version-stamped Parameter_Set captures
-- (trader-edge-validation Stage D, task 9; design R11). Runs after the
-- trade_ledger migration (20260916000007) and applies identically across local
-- and hosted Supabase targets.
--
-- ADDITIVE ONLY: this migration CREATES the `frozen_baselines` table and nothing
-- else. It DROPS nothing and touches NO existing table, so applying it (or not
-- applying it) cannot break the daily run — the SupabaseFrozenBaselineStore
-- adapter reads fail-safe (absent table → empty) so a torn deploy (code live
-- before the migration, or vice versa) is harmless. All statements are
-- idempotent (`create table/index if not exists`, guarded grants) so it is safe
-- to re-run. No secret value appears here; the single Write_Credential is
-- referenced by its Postgres role name only (`fx_writer`), never by any key
-- material.
--
-- One row per captured Frozen_Baseline, keyed by `id` (the version stamp). The
-- table is APPEND-ONLY: a capture is immutable once written so a walk-forward /
-- comparator result stays traceable to the exact frozen assumptions that
-- produced it (R7.2, R11.1). The full Parameter_Set is stored as `params` jsonb
-- so the record is self-describing without a column-per-knob coupling; nothing
-- here is a NEW tunable parameter (R12.2) — the row only RECORDS live constants.

create table if not exists frozen_baselines (
  id          text not null,            -- the version stamp (R11.1); primary key
  captured_at timestamptz not null,     -- ISO capture time
  params      jsonb not null,           -- the full ParameterSet (R7.3), self-describing
  created_at  timestamptz not null default now(),
  primary key (id)
);

-- Reads list captures newest-last by capture time.
create index if not exists frozen_baselines_captured_at_idx
  on frozen_baselines (captured_at);

-- RLS posture matches the other retained tables under the public-data model:
-- hosted Supabase auto-ENABLES RLS on every new public table via a project event
-- trigger, which with NO policy would block both the public read path and the
-- fx_writer write path through PostgREST. Disable RLS so frozen_baselines matches
-- the public-data model (idempotent).
alter table if exists frozen_baselines disable row level security;

-- Public read (the dashboard / ops read it with no credential); INSERT
-- restricted to the single Write_Credential role `fx_writer` (append-only, so no
-- UPDATE/DELETE grant). Guarded on the role's existence so a target that
-- provisions fx_writer out-of-band still applies the public-read grant cleanly;
-- re-runnable.
grant select on frozen_baselines to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fx_writer') then
    grant select, insert on frozen_baselines to fx_writer;
    -- authenticator must be a MEMBER of fx_writer so PostgREST can SET ROLE for a
    -- fx_writer-claim JWT (mirrors the trade_ledger / retained-table grants).
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      grant fx_writer to authenticator;
    end if;
  end if;
end
$$;
