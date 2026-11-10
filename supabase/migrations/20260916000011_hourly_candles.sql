-- Migration: hourly_candles — an archive of the HOURLY bars the daily candles are built from.
-- Runs after intraday_validations (20260916000010); applies identically to local and hosted.
--
-- PURPOSE: the system builds each daily candle from hourly bars on the 17:00 America/New_York
-- close and then discards them. Keeping them lets an OFFLINE simulation resolve the order in
-- which a stop and a target were touched inside a session, which daily bars cannot say. Nothing
-- in the live decision path reads this table.
--
-- ADDITIVE ONLY: creates `hourly_candles` and nothing else; drops/alters no existing object. The
-- adapter reads and writes fail-safe (absent table -> empty / swallowed), so a torn deploy is
-- harmless. Idempotent (`if not exists`, guarded grants). No secret value appears here; the single
-- Write_Credential is referenced by its Postgres role name only (`fx_writer`).
--
-- One row per (pair, bar_open_utc).
create table if not exists hourly_candles (
  pair          text not null,
  bar_open_utc  timestamptz not null,   -- the instant the hourly bar OPENED (UTC)
  open          numeric not null,
  high          numeric not null,
  low           numeric not null,
  close         numeric not null,
  source        text not null,          -- provider provenance tag, never a secret
  created_at    timestamptz not null default now(),
  primary key (pair, bar_open_utc)
);
create index if not exists hourly_candles_open_idx on hourly_candles (bar_open_utc);
-- RLS posture matches the other retained tables under the public-data model (idempotent).
alter table if exists hourly_candles disable row level security;
grant select on hourly_candles to public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fx_writer') then
    grant select, insert, update on hourly_candles to fx_writer;
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      grant fx_writer to authenticator;
    end if;
  end if;
end
$$;
