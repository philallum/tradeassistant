//
// Mirrors the structural style of dashboardReadMigration.test.ts / schema.test.ts: it reads
// the migration SQL as text and asserts the shape of migration 20260916000004
// (dashboard-data-activation Req 2.1 / 9.1):
//   * select, insert, update (NOT delete) granted to pipeline_writer on each of the three
//     gate tables (gate_verdicts, gate_fold_verdicts, feature_registry);
//   * a pipeline_writer_rw RLS policy per gate table (drop-then-create, re-runnable);
//   * RLS enabled on all three gate tables;
//   * the migration touches ONLY the three gate tables and leaves 20260916000002's five
//     compute-table pipeline_writer policies untouched;
//   * the migration is idempotent / safely re-runnable.
//
// This is a STRUCTURAL guard over the SQL source, not a behavioural DB test; the live
// behaviour (pipeline_writer can insert/update the gate tables, re-apply is a no-op) is
// validated against a real Supabase/Postgres during the hosted migration apply (task 9).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260916000004_gate_tables_pipeline_writer.sql",
);

// The three gate tables the Gate_Run writes through pipeline_writer.
const GATE_TABLES = ["gate_verdicts", "gate_fold_verdicts", "feature_registry"] as const;

// The five compute tables owned by 20260916000002 — this migration must NOT touch their
// pipeline_writer_rw policies.
const COMPUTE_TABLES_2 = [
  "candles",
  "pattern_vectors",
  "analogue_outcomes",
  "firing_setups",
  "realized_outcomes",
] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Gate-tables pipeline_writer migration 20260916000004 (dashboard-data-activation Req 2.1)", () => {
  it("migration file exists and is non-empty", () => {
    expect(read(MIGRATION_PATH).length).toBeGreaterThan(0);
  });

  it("grants select, insert, update (and NO delete) to pipeline_writer on each gate table", () => {
    const sql = read(MIGRATION_PATH);
    for (const table of GATE_TABLES) {
      expect(sql, `missing grant on ${table}`).toMatch(
        new RegExp(`grant\\s+select,\\s*insert,\\s*update\\s+on\\s+${table}\\s+to pipeline_writer`, "i"),
      );
    }
    // No DELETE is ever granted to pipeline_writer. Scan actual `grant ... to pipeline_writer;`
    // statements (not prose) and assert none include delete.
    const writerGrants = (sql.match(/^grant\s+[^;\n]*?\s+to pipeline_writer\s*;/gim) ?? []).join("\n");
    expect(writerGrants.length).toBeGreaterThan(0);
    expect(writerGrants).not.toMatch(/\bdelete\b/i);
    expect(writerGrants).toMatch(/select,\s*insert,\s*update/i);
  });

  it("enables RLS on all three gate tables", () => {
    const sql = read(MIGRATION_PATH);
    for (const table of GATE_TABLES) {
      expect(sql, `missing RLS enable on ${table}`).toMatch(
        new RegExp(`alter table ${table} enable row level security`, "i"),
      );
    }
  });

  it("defines a pipeline_writer_rw RLS policy per gate table with the drop-then-create pattern", () => {
    const sql = read(MIGRATION_PATH);
    for (const table of GATE_TABLES) {
      expect(sql, `missing drop policy on ${table}`).toMatch(
        new RegExp(`drop policy if exists pipeline_writer_rw on ${table}`, "i"),
      );
      expect(sql, `missing create policy on ${table}`).toMatch(
        new RegExp(
          `create policy pipeline_writer_rw on ${table} for all to pipeline_writer using \\(true\\) with check \\(true\\)`,
          "i",
        ),
      );
    }
  });

  it("is self-contained: never touches the five compute-table policies owned by 20260916000002", () => {
    const sql = read(MIGRATION_PATH);
    for (const table of COMPUTE_TABLES_2) {
      expect(sql, `must not touch pipeline_writer_rw on ${table}`).not.toMatch(
        new RegExp(`policy pipeline_writer_rw on ${table}\\b`, "i"),
      );
      expect(sql, `must not grant to pipeline_writer on ${table}`).not.toMatch(
        new RegExp(`to pipeline_writer on ${table}\\b`, "i"),
      );
    }
    // It must not create/drop the pipeline_writer role itself — that is 20260916000002's job.
    expect(sql).not.toMatch(/create role pipeline_writer/i);
  });

  it("is idempotent / safely re-runnable (guarded grants and drop-then-create policies)", () => {
    const sql = read(MIGRATION_PATH);
    // `enable row level security` is idempotent; `grant` is idempotent; policies use
    // `drop policy if exists` before `create policy`. Assert no bare `create policy`
    // without a preceding `drop policy if exists` for the same object.
    const createPolicies = sql.match(/create policy pipeline_writer_rw on (\w+)/gi) ?? [];
    expect(createPolicies.length).toBe(GATE_TABLES.length);
    for (const table of GATE_TABLES) {
      const dropIdx = sql.search(new RegExp(`drop policy if exists pipeline_writer_rw on ${table}`, "i"));
      const createIdx = sql.search(new RegExp(`create policy pipeline_writer_rw on ${table}`, "i"));
      expect(dropIdx, `drop must precede create for ${table}`).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThan(dropIdx);
    }
  });
});
