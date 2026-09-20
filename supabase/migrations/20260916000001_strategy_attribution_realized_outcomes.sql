-- Follow-up Migration: Strategy Attribution & Realized-Outcome Journal
-- Runs after the initial schema (20260916000000_initial_schema.sql) and applies
-- identically across local and hosted Supabase targets (Requirement 17.2).
--
-- Adds Strategy_Source attribution to firing_setups and introduces the
-- realized_outcomes predicted-versus-actual journal (Component 19, Requirement 25).
-- All statements are idempotent / re-runnable so this migration is safe to apply
-- more than once against either target.

-- 1. firing_setups: Strategy_Source attribution + expanded suppression reasons (Requirements 25.1, 22.3)

-- Add strategy_id Strategy_Source attribution; v1 deterministic system = 'system' (Req 25.1)
alter table firing_setups
  add column if not exists strategy_id text not null default 'system';

-- Repoint the primary key to (decision_date, pair, strategy_id) so multiple
-- strategies can coexist per (decision_date, pair) (Req 25.1).
-- The initial schema declared the PK inline, giving it the Postgres auto-generated
-- name firing_setups_pkey; drop it (guarded) and add the new composite key.
alter table firing_setups
  drop constraint if exists firing_setups_pkey;

alter table firing_setups
  add constraint firing_setups_pkey primary key (decision_date, pair, strategy_id);

-- Add 'too_choppy' to the allowed suppression reasons (Component 18, Req 22.3).
-- The initial schema declared the check inline, giving it the auto-generated name
-- firing_setups_suppression_reason_check; drop it (guarded) and add the updated set.
alter table firing_setups
  drop constraint if exists firing_setups_suppression_reason_check;

alter table firing_setups
  add constraint firing_setups_suppression_reason_check
  check (suppression_reason in ('news', 'currency_concentration', 'below_floor', 'not_fired', 'too_choppy'));

-- 2. realized_outcomes (Requirement 25)
-- The growing predicted-versus-actual corpus (Component 19). Each row pairs what a
-- Strategy_Source predicted for a fired setup with the actual forward outcome,
-- populated only from matured outcomes via the shared Look-Ahead Guard. Keyed by
-- (strategy_id, pair, decision_date) for idempotent upsert (Req 25.7). It never feeds
-- the deterministic scoring path and is a consumer-friendly record future strategies
-- read and append to on the same terms as the v1 system (Req 25.6).
create table if not exists realized_outcomes (
  strategy_id        text not null default 'system',  -- Strategy_Source (Req 25.1)
  pair               text not null,
  decision_date      date not null,                   -- the date the setup fired
  predicted_direction text not null check (predicted_direction in ('UP', 'DOWN', 'FLAT')),
  horizon            smallint not null check (horizon in (1, 2, 3)),
  earned_confidence  double precision not null,
  stop_loss_pips     double precision,                -- as surfaced (may be null below floor)
  take_profit_pips   double precision,
  realized_direction text check (realized_direction in ('UP', 'DOWN', 'FLAT')), -- null until matured (Req 25.2, 25.3)
  realized_mfe_pips  double precision,
  realized_mae_pips  double precision,
  matured            boolean not null default false,  -- true once the horizon window has closed (Req 25.3)
  recorded_at        timestamptz not null default now(),
  primary key (strategy_id, pair, decision_date)      -- idempotent per strategy/pair/date (Req 25.7)
);
