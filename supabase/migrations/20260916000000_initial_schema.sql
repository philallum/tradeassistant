-- Initial Schema Migration for FX Daily Pattern Assistant
-- Shared schema identical across local and hosted Supabase targets (Requirement 17.2).
-- Enables pgvector and establishes storage for candles, yields, pattern_vectors,
-- analogue_outcomes, data_splits, walk_forward_folds, gate_verdicts, gate_fold_verdicts,
-- feature_registry, calendar_events, news_risk_flags, firing_setups, and version_ledger.

-- Enable extensions
create extension if not exists vector;
create extension if not exists "pgcrypto";

-- 1. candles (Requirement 7)
-- Keyed by (asset, date); OHLC validity check constraint
create table if not exists candles (
  asset       text not null,              -- one of the 5 pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD)
  date        date not null,              -- NY-close trading date (session_close = 17:00 America/New_York)
  open        double precision not null,
  high        double precision not null,
  low         double precision not null,
  close       double precision not null,
  source      text not null,
  ingested_at timestamptz not null default now(),
  primary key (asset, date),
  constraint ohlc_valid check (high >= low and open between low and high and close between low and high)
);

-- 2. yields (Requirement 13.8)
-- Asset-agnostic per-country 10-year government-bond yields, keyed by (country, date)
create table if not exists yields (
  country     text not null,              -- e.g. 'US', 'DE', 'JP', 'CH', 'CA', 'GB'
  date        date not null,              -- yield observation date
  yield_10y   double precision not null,  -- 10-year government bond yield (percent)
  source      text not null,
  ingested_at timestamptz not null default now(),
  primary key (country, date)
);

-- 3. pattern_vectors (Requirement 8)
-- Fixed-dimension dim=70 embedding + weekly_trend_sign metadata
create table if not exists pattern_vectors (
  asset             text not null,
  decision_date     date not null,
  embedding         vector(70) not null,  -- 10 + 20 + 40 trading-day per-scale shape slices
  weekly_trend_sign text not null check (weekly_trend_sign in ('UP', 'DOWN')),
  scale_dims        jsonb not null,
  primary key (asset, decision_date)
);

create index if not exists pattern_vectors_embedding_hnsw_idx
  on pattern_vectors using hnsw (embedding vector_cosine_ops);

create index if not exists pattern_vectors_trend_asset_idx
  on pattern_vectors (weekly_trend_sign, asset);

-- 4. analogue_outcomes (Requirement 9)
-- Forward outcomes per horizon (1, 2, 3 days)
create table if not exists analogue_outcomes (
  asset          text not null,
  decision_date  date not null,          -- analogue's own decision date
  horizon        smallint not null check (horizon in (1, 2, 3)),
  direction      text not null check (direction in ('UP', 'DOWN', 'FLAT')),
  mfe_pips       double precision not null,
  mae_pips       double precision not null,
  atr14          double precision not null,
  matured        boolean not null,
  primary key (asset, decision_date, horizon)
);

-- 5. data_splits (Requirement 11)
-- Static partition reference (frozen once recorded)
create table if not exists data_splits (
  asset       text not null,
  train_end   date not null,
  test_start  date not null,
  test_end    date not null,
  frozen      boolean not null default true,
  recorded_at timestamptz not null default now(),
  primary key (asset)
);

-- 6. walk_forward_folds (Requirements 11.2, 19)
-- Sequential chronological walk-forward folds
create table if not exists walk_forward_folds (
  asset       text not null,
  fold_index  integer not null,
  train_start date not null,
  train_end   date not null,
  test_start  date not null,
  test_end    date not null,
  frozen      boolean not null default true,
  recorded_at timestamptz not null default now(),
  primary key (asset, fold_index)
);

-- 7. gate_verdicts (Requirements 5, 11, 13)
-- Aggregate gate evaluation outcomes per configuration
create table if not exists gate_verdicts (
  id                 uuid primary key default gen_random_uuid(),
  config_id          text not null,
  sample_size        integer not null,
  gate1_model_acc    double precision not null,
  gate1_baseline_acc double precision not null,
  gate1_delta_pp     double precision not null,
  gate1_passed       boolean not null,
  gate2_model_ra     double precision,
  gate2_baseline_ra  double precision,
  gate2_margin       double precision,
  gate2_passed       boolean,
  verdict            text not null check (verdict in ('PASS', 'CUT')),
  selected_horizon   smallint check (selected_horizon in (1, 2, 3)),
  split_train_end    date not null,
  split_test_start   date not null,
  split_test_end     date not null,
  created_at         timestamptz not null default now()
);

-- 8. gate_fold_verdicts (Requirements 11.13, 19.4, 19.5)
-- Per-fold gate results for each config verdict
create table if not exists gate_fold_verdicts (
  verdict_id   uuid not null references gate_verdicts(id) on delete cascade,
  fold_index   integer not null,
  sample_size  integer not null,
  skipped      boolean not null default false,
  gate1_passed boolean,
  gate2_passed boolean,
  verdict      text check (verdict in ('PASS', 'CUT')),
  metrics      jsonb not null default '{}'::jsonb,
  primary key (verdict_id, fold_index)
);

-- 9. feature_registry (Requirement 13)
-- Hard ceiling of <= 12 included features enforced at application layer
create table if not exists feature_registry (
  feature_id  text primary key,
  status      text not null check (status in ('candidate', 'included', 'cut')),
  verdict_id  uuid references gate_verdicts(id),
  updated_at  timestamptz not null default now()
);

-- 10. calendar_events (Requirement 14)
-- Economic calendar events from feeds (ForexFactory / FMP)
create table if not exists calendar_events (
  decision_date date not null,
  currency      text not null,
  event_name    text not null,
  impact        text not null,
  event_ts      timestamptz not null,
  source        text not null,
  primary key (decision_date, currency, event_name, event_ts)
);

-- 11. news_risk_flags (Requirement 14)
-- Structured news risk flags per pair / date
create table if not exists news_risk_flags (
  decision_date date not null,
  pair          text not null,
  level         text not null,
  reason        text not null,
  feed_ok       boolean not null,
  primary key (decision_date, pair)
);

-- 12. firing_setups (Requirements 21, 22)
-- Daily firing decisions, empirical risk boundaries, and suppression reasons
create table if not exists firing_setups (
  decision_date      date not null,
  pair               text not null,
  direction          text not null check (direction in ('UP', 'DOWN', 'FLAT')),
  horizon            smallint not null check (horizon in (1, 2, 3)),
  earned_confidence  double precision not null,
  stop_loss_pips     double precision,
  take_profit_pips   double precision,
  surfaced           boolean not null,
  suppression_reason text check (suppression_reason in ('news', 'currency_concentration', 'below_floor', 'not_fired')),
  competing_pairs    text[],
  primary key (decision_date, pair)
);

-- 13. version_ledger (Requirement 18)
-- Tracks language, runtime, and dependency pinned versions
create table if not exists version_ledger (
  component      text primary key,
  version        text not null,
  is_prerelease  boolean not null default false,
  verified_at    date not null,
  latest_known   text
);
