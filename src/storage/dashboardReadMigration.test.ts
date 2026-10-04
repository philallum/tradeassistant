// Dashboard Read-Only Serving-Layer Migration — structural guard (task 1.4).
//
// Mirrors the structural style of schema.test.ts: it reads the migration SQL as text
// and asserts the shape of the companion migration 20260916000003 (Dashboard_UI Req 4):
//   * two display-only base tables created idempotently with RLS + pipeline_writer grants;
//   * the dashboard_reader read role created under a guarded DO block;
//   * all nine Read_Only_Views created with `create or replace view`;
//   * dashboard_reader granted SELECT on exactly the nine views and on NO base table;
//   * the pair/asset-scoped views filter to the five PAIRS;
//   * the migration is self-contained and leaves 20260916000002's pipeline_writer policies
//     untouched (it names no pipeline_writer object except the two NEW display-only tables).
//
// This is a STRUCTURAL guard over the SQL source, not a behavioural DB test; the live
// behaviour (reader reads through views, direct base reads denied, idempotent re-apply)
// is validated against a real Supabase/Postgres during migration apply (Req 4.7, 21.5).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260916000003_dashboard_read_views_rls.sql",
);
const WRITER_MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260916000002_rls_pipeline_writer_scoped_write.sql",
);

const NINE_VIEWS = [
  "v_decision_dates",
  "v_firing_setups",
  "v_analogue_outcomes",
  "v_realized_outcomes",
  "v_gate_verdicts",
  "v_gate_fold_verdicts",
  "v_candles",
  "v_signal_rationale",
  "v_external_reference_comparison",
] as const;

// Base tables that must NEVER receive a direct `grant select ... to dashboard_reader`.
const BASE_TABLES = [
  "firing_setups",
  "analogue_outcomes",
  "realized_outcomes",
  "gate_verdicts",
  "gate_fold_verdicts",
  "candles",
  "signal_rationale",
  "external_reference_comparison",
  "pattern_vectors",
  "yields",
] as const;

const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Dashboard read-only serving-layer migration 20260916000003 (Requirement 4)", () => {
  it("migration file exists and is non-empty", () => {
    expect(read(MIGRATION_PATH).length).toBeGreaterThan(0);
  });

  // --- Subtask 1.1: display-only base tables, RLS, pipeline_writer grants ---

  it("creates the two display-only base tables idempotently (Req 4.3, 20.3)", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/create table if not exists signal_rationale/i);
    expect(sql).toMatch(/create table if not exists external_reference_comparison/i);
    expect(sql).toMatch(/primary key\s*\(decision_date,\s*pair,\s*strategy_id\)/i);
    expect(sql).toMatch(/primary key\s*\(decision_date,\s*pair\)/i);
    expect(sql).toMatch(/comparison in \('agree','diverge','neutral','unavailable'\)/i);
  });

  it("enables RLS and grants pipeline_writer select/insert/update (no delete) on the new tables (Req 20.3)", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/alter table signal_rationale enable row level security/i);
    expect(sql).toMatch(/alter table external_reference_comparison enable row level security/i);
    expect(sql).toMatch(/grant select, insert, update on signal_rationale to pipeline_writer/i);
    expect(sql).toMatch(
      /grant select, insert, update on external_reference_comparison to pipeline_writer/i,
    );
    // No DELETE is ever granted to pipeline_writer in this migration. Scan actual
    // `grant ... to pipeline_writer;` statements (not prose) and assert none include delete.
    const writerGrants = (sql.match(/^grant\s+[^;\n]*?\s+to pipeline_writer\s*;/gim) ?? []).join(
      "\n",
    );
    expect(writerGrants).not.toMatch(/\bdelete\b/i);
    expect(writerGrants).toMatch(/select,\s*insert,\s*update/i);
    // pipeline_writer_rw policies mirror 20260916000002's drop-then-create pattern.
    expect(sql).toMatch(/drop policy if exists pipeline_writer_rw on signal_rationale/i);
    expect(sql).toMatch(
      /create policy pipeline_writer_rw on signal_rationale for all to pipeline_writer using \(true\) with check \(true\)/i,
    );
  });

  // --- Subtask 1.2: read role + nine views ---------------------------------

  it("creates the dashboard_reader role under a guarded DO block (not an unguarded create role)", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/do \$\$/i);
    expect(sql).toMatch(
      /if not exists \(select 1 from pg_roles where rolname = 'dashboard_reader'\)[\s\S]*?create role dashboard_reader nologin/i,
    );
    expect(sql).toMatch(/grant dashboard_reader to authenticator/i);
  });

  it("creates all nine read-only views with create-or-replace", () => {
    const sql = read(MIGRATION_PATH);
    for (const view of NINE_VIEWS) {
      expect(sql, `missing create or replace view ${view}`).toMatch(
        new RegExp(`create or replace view ${view}\\b`, "i"),
      );
    }
  });

  it("filters the pair/asset-scoped views to the five PAIRS and leaves the gate views cross-config", () => {
    const sql = read(MIGRATION_PATH);
    const pairList = PAIRS.map((p) => `'${p}'`).join(",");
    // The filter appears once per pair/asset-scoped view (7 of the nine views).
    const occurrences = sql.split(`in (${pairList})`).length - 1;
    expect(occurrences).toBe(7);
    // The two gate views are NOT pair-scoped: no WHERE pair/asset filter on them.
    const gateVerdicts = sql.slice(sql.indexOf("create or replace view v_gate_verdicts"));
    const gateVerdictsBody = gateVerdicts.slice(0, gateVerdicts.indexOf(";"));
    expect(gateVerdictsBody).not.toMatch(/where/i);
  });

  // --- Subtask 1.3: default-deny grants + reader RLS policies ---------------

  it("grants usage on schema public to dashboard_reader", () => {
    expect(read(MIGRATION_PATH)).toMatch(/grant usage on schema public to dashboard_reader/i);
  });

  it("grants dashboard_reader SELECT on exactly the nine views and on no base table (Req 4.4, 4.5)", () => {
    const sql = read(MIGRATION_PATH);
    for (const view of NINE_VIEWS) {
      expect(sql, `missing reader grant on ${view}`).toMatch(
        new RegExp(`grant select on ${view} to dashboard_reader`, "i"),
      );
    }
    // No base table may receive a direct SELECT grant to the reader (default-deny).
    for (const table of BASE_TABLES) {
      expect(sql, `base table ${table} must not be granted to dashboard_reader`).not.toMatch(
        new RegExp(`grant select on ${table} to dashboard_reader`, "i"),
      );
    }
    // Count the reader SELECT grants: exactly nine, one per view.
    const readerSelectGrants = sql.match(/grant select on \w+ to dashboard_reader/gi) ?? [];
    expect(readerSelectGrants.length).toBe(NINE_VIEWS.length);
  });

  it("adds a role-scoped dashboard_reader_select RLS policy on the two new display-only tables", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/drop policy if exists dashboard_reader_select on signal_rationale/i);
    expect(sql).toMatch(
      /create policy dashboard_reader_select on signal_rationale for select to dashboard_reader using \(true\)/i,
    );
    expect(sql).toMatch(
      /create policy dashboard_reader_select on external_reference_comparison for select to dashboard_reader using \(true\)/i,
    );
  });

  // --- Req 4.6: separate from, and leaves untouched, 20260916000002 ---------

  it("is self-contained: references no pre-existing pipeline_writer table from 20260916000002", () => {
    const sql = read(MIGRATION_PATH);
    // The only pipeline_writer_rw policies this migration defines are on the TWO new
    // display-only tables; it must not drop/recreate the writer policies on the five
    // compute tables that 20260916000002 owns.
    for (const table of [
      "candles",
      "pattern_vectors",
      "analogue_outcomes",
      "firing_setups",
      "realized_outcomes",
    ]) {
      expect(sql, `must not touch pipeline_writer_rw on ${table}`).not.toMatch(
        new RegExp(`policy pipeline_writer_rw on ${table}\\b`, "i"),
      );
    }
  });

  it("the pre-existing pipeline-writer migration still exists and is unchanged in shape", () => {
    const writer = read(WRITER_MIGRATION_PATH);
    expect(writer).toMatch(/create role pipeline_writer nologin/i);
    expect(writer).toMatch(/create policy pipeline_writer_rw on firing_setups for all to pipeline_writer/i);
  });

  // --- Idempotency shape ----------------------------------------------------

  it("is idempotent in shape (create-if-not-exists, create-or-replace, drop-policy-if-exists, guarded role)", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/create table if not exists/i);
    expect(sql).toMatch(/create or replace view/i);
    expect(sql).toMatch(/drop policy if exists/i);
    expect(sql).toMatch(/if not exists \(select 1 from pg_roles/i);
  });
});
