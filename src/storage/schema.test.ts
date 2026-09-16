import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Database Schema Migrations (Requirements 7.2, 7.3, 8.4, 13.8, 17.1, 17.2, 19, 21, 22)", () => {
  const migrationPath = resolve(
    process.cwd(),
    "supabase/migrations/20260916000000_initial_schema.sql",
  );

  it("migration file exists and is non-empty", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("defines the vector extension and pgcrypto", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create extension if not exists vector;/i);
    expect(sql).toMatch(/create extension if not exists "pgcrypto";/i);
  });

  it("defines candles table with ohlc_valid check and (asset, date) primary key", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists candles/i);
    expect(sql).toMatch(/primary key\s*\(asset,\s*date\)/i);
    expect(sql).toMatch(/constraint ohlc_valid check/i);
  });

  it("defines yields table keyed by (country, date)", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists yields/i);
    expect(sql).toMatch(/primary key\s*\(country,\s*date\)/i);
  });

  it("defines pattern_vectors table with dim=70 vector and HNSW cosine index", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists pattern_vectors/i);
    expect(sql).toMatch(/embedding\s+vector\(70\)/i);
    expect(sql).toMatch(/weekly_trend_sign\s+text\s+not null check/i);
    expect(sql).toMatch(/using hnsw\s*\(embedding vector_cosine_ops\)/i);
  });

  it("defines analogue_outcomes, data_splits, and walk_forward_folds", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists analogue_outcomes/i);
    expect(sql).toMatch(/primary key\s*\(asset,\s*decision_date,\s*horizon\)/i);
    expect(sql).toMatch(/create table if not exists data_splits/i);
    expect(sql).toMatch(/create table if not exists walk_forward_folds/i);
    expect(sql).toMatch(/primary key\s*\(asset,\s*fold_index\)/i);
  });

  it("defines gate_verdicts and gate_fold_verdicts with cascade references", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists gate_verdicts/i);
    expect(sql).toMatch(/create table if not exists gate_fold_verdicts/i);
    expect(sql).toMatch(/references gate_verdicts\(id\)/i);
    expect(sql).toMatch(/primary key\s*\(verdict_id,\s*fold_index\)/i);
  });

  it("defines calendar_events, news_risk_flags, firing_setups, and version_ledger", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists calendar_events/i);
    expect(sql).toMatch(/create table if not exists news_risk_flags/i);
    expect(sql).toMatch(/create table if not exists firing_setups/i);
    expect(sql).toMatch(/suppression_reason/i);
    expect(sql).toMatch(/competing_pairs/i);
    expect(sql).toMatch(/create table if not exists version_ledger/i);
  });
});
