// Schema-Reduction Reconcile — Required_Object_Set manifest + enumeration + idempotent drops
// (simplify-to-cloud-minimal tasks 5.1 / 5.2;
//  Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.10, 8.1, 8.2, 8.3, 8.5, 8.6, 4.2, 4.5, 4.6).
//
// Mirrors the structural style of schema.test.ts / dashboardReadMigration.test.ts: it
// reads the migration SQL as text and asserts the shape of the reconcile section appended
// to migration 20260916000006.
//
// Task 5.1 defined:
//   * the authoritative Required_Object_Set keep-list (R10.1), defined positively;
//   * the read-only information_schema / pg_catalog enumeration + diff query (R10.2, R10.3)
//     that classifies every live object as 'kept' or 'orphaned'.
//
// Task 5.2 (this extension) adds the DESTRUCTIVE, idempotent reconcile:
//   * data preservation of the Realized_Outcome_Journal BEFORE any drop (R8.6, R10.6);
//   * `drop ... if exists` of every orphaned view, policy, table, and (guarded) role so
//     only the Required_Object_Set remains, and re-running is a no-op (R10.4, R10.5);
//   * public SELECT on the six retained tables + INSERT/UPDATE restricted to the single
//     Write_Credential (role `fx_writer`), with NO RLS row policies (R4.5, R4.6).
// The hosted apply (task 5.3) remains out of scope here.
//
// This is a STRUCTURAL guard over the SQL source, not a behavioural DB test; the live
// enumeration + reconcile behaviour is exercised against a real Supabase/Postgres at
// reconcile time (task 5.3).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260916000006_evaluation_reports.sql",
);

// The six Required_Object_Set tables (design C4, R8.1 / R10.1).
const REQUIRED_TABLES = [
  "candles",
  "pattern_vectors",
  "analogue_outcomes",
  "firing_setups",
  "realized_outcomes",
  "evaluation_reports",
] as const;

// Objects that must be enumerated-and-classified-as-orphaned, never listed as required.
const ORPHANED_TABLES = [
  "yields",
  "data_splits",
  "walk_forward_folds",
  "gate_verdicts",
  "gate_fold_verdicts",
  "feature_registry",
  "calendar_events",
  "news_risk_flags",
  "version_ledger",
  "signal_rationale",
  "external_reference_comparison",
] as const;

// The project-created roles that are Orphaned_Objects under public data (R4.x).
const ORPHANED_ROLES = ["pipeline_writer", "dashboard_reader", "diagnostic_reader"] as const;

// The nine dashboard read views (migration 003) that the reconcile drops (R4.2, R8.3).
const ORPHANED_VIEWS = [
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

function read(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

// The executable SQL = every line that is NOT a `--` comment. The enumeration
// SELECT (task 5.1) is commented documentation and must stay out of this slice;
// the task-5.2 drops/grants ARE executable and must appear in it.
function executable(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("Schema-reduction reconcile manifest + enumeration + idempotent drops (tasks 5.1/5.2)", () => {
  it("migration file exists and is non-empty", () => {
    expect(read().length).toBeGreaterThan(0);
  });

  // --- R10.1: authoritative Required_Object_Set, defined positively ----------

  it("declares the authoritative Required_Object_Set keep-list (R10.1)", () => {
    const sql = read();
    expect(sql).toMatch(/Required_Object_Set/);
    expect(sql).toMatch(/positively/i);
    // Every required table is named as a kept object in the `required_tables` CTE.
    const requiredCte = sql.slice(
      sql.indexOf("required_tables(name) as (values"),
      sql.indexOf("required_views(name)"),
    );
    for (const table of REQUIRED_TABLES) {
      expect(requiredCte, `required table ${table} must be in the keep-list`).toMatch(
        new RegExp(`'${table}'`),
      );
    }
  });

  it("states that no project-created views, roles, or policies are required under public data (R10.1)", () => {
    const sql = read();
    expect(sql).toMatch(/required_views\(name\) as \(select null::text where false\)/i);
    expect(sql).toMatch(/required_roles\(name\) as \(select null::text where false\)/i);
  });

  // --- R10.2: live enumeration from information_schema / pg_catalog -----------

  it("enumerates the live account from information_schema / pg_catalog (R10.2)", () => {
    const sql = read();
    expect(sql).toMatch(/information_schema\.tables/i);
    expect(sql).toMatch(/information_schema\.views/i);
    expect(sql).toMatch(/pg_indexes/i);
    expect(sql).toMatch(/pg_proc/i);
    expect(sql).toMatch(/pg_roles/i);
    expect(sql).toMatch(/pg_policies/i);
  });

  it("enumerates project schemas rather than assuming only public (R10.2)", () => {
    const sql = read();
    expect(sql).toMatch(/project_schemas/i);
    expect(sql).toMatch(/pg_catalog/);
    expect(sql).toMatch(/information_schema/);
    expect(sql).toMatch(/pg_toast/);
  });

  // --- R10.3: classify every enumerated object as kept vs orphaned -----------

  it("classifies every enumerated object as 'kept' or 'orphaned' (R10.3)", () => {
    const sql = read();
    expect(sql).toMatch(/'kept'/);
    expect(sql).toMatch(/'orphaned'/);
    // The six object kinds are all enumerated and unioned into one classified result set.
    for (const kind of ["table", "view", "index", "function", "role", "policy"]) {
      expect(sql, `enumeration must cover ${kind}`).toMatch(new RegExp(`'${kind}'::text`));
    }
    expect(sql).toMatch(/classification/i);
  });

  it("treats the known orphaned tables and roles as removable, never as required (R10.3)", () => {
    const sql = read();
    const requiredCte = sql.slice(
      sql.indexOf("required_tables(name) as (values"),
      sql.indexOf("required_views(name)"),
    );
    for (const table of ORPHANED_TABLES) {
      expect(requiredCte, `${table} must NOT be in the required keep-list`).not.toMatch(
        new RegExp(`'${table}'`),
      );
    }
    for (const role of ORPHANED_ROLES) {
      expect(sql, `orphaned role ${role} must be enumerated`).toMatch(new RegExp(`'${role}'`));
    }
  });

  // --- Scope guard: the enumeration SELECT (5.1) stays commented -------------

  it("keeps the task-5.1 enumeration SELECT commented (documentation, not executed)", () => {
    const sql = read();
    // The enumeration query is documentation: present but commented out, so applying the
    // migration runs no account-wide SELECT. (The task-5.2 drops/grants below ARE executed.)
    expect(executable(sql)).not.toMatch(/select \* from enum_tables/i);
    expect(sql).toMatch(/select \* from enum_tables/i);
  });

  // --- R8/R4.2: the destructive drops are present and executed (task 5.2) ----

  it("drops every orphaned table with `if exists` so only the keep-list remains (R8.1-8.3, R4.2)", () => {
    const exec = executable(read());
    for (const table of ORPHANED_TABLES) {
      expect(exec, `missing executed drop of orphaned table ${table}`).toMatch(
        new RegExp(`drop table if exists ${table}\\b`, "i"),
      );
    }
    // The six retained tables must NOT be dropped.
    for (const table of REQUIRED_TABLES) {
      expect(exec, `retained table ${table} must never be dropped`).not.toMatch(
        new RegExp(`drop table if exists ${table}\\b`, "i"),
      );
    }
  });

  it("drops the nine orphaned read views with `if exists` (R4.2, R8.3)", () => {
    const exec = executable(read());
    for (const view of ORPHANED_VIEWS) {
      expect(exec, `missing executed drop of view ${view}`).toMatch(
        new RegExp(`drop view if exists ${view}\\b`, "i"),
      );
    }
  });

  it("drops the RLS policies and keeps NO RLS row policy in the keep-list (R4.5, R4.6)", () => {
    const exec = executable(read());
    // The three policy families from migrations 002/003/004/005 are all dropped. STEP 3 is a
    // table-existence-guarded DO loop (idempotency fix, see test below): each (policy, table)
    // pair is dropped via `execute format('drop policy if exists %I on public.%I', ...)`, and
    // the family names appear as the values driving that loop.
    expect(exec).toMatch(/drop policy if exists %I on public\.%I/i);
    expect(exec).toMatch(/'pipeline_writer_rw'/i);
    expect(exec).toMatch(/'dashboard_reader_select'/i);
    expect(exec).toMatch(/'diagnostic_reader_select'/i);
    // No RLS policy is CREATEd by the reconcile — under public data there are none.
    expect(exec).not.toMatch(/create policy/i);
    // RLS is disabled on ALL six retained tables (no row policies under public data). Note
    // evaluation_reports is created by this migration; hosted Supabase auto-enables RLS on
    // new public tables, so it too must be explicitly disabled here.
    for (const table of REQUIRED_TABLES) {
      expect(exec, `RLS must be disabled on retained ${table}`).toMatch(
        new RegExp(`alter table if exists ${table} disable row level security`, "i"),
      );
    }
  });

  it("guards STEP 3 policy drops on table existence so a re-apply is a no-op (R10.5)", () => {
    const exec = executable(read());
    // Several policies sit on tables STEP 5 drops; on a second apply those tables are gone, so
    // `drop policy if exists ... on <missing table>` would raise 42P01. The DO loop guards each
    // drop on `to_regclass('public.' || <table>) is not null`, making STEP 3 re-runnable.
    expect(exec).toMatch(/to_regclass\('public\.' \|\| pol\.table_name\) is not null/i);
  });

  it("drops the three project-created roles under guarded, re-runnable DO blocks (R4.2, R4.6)", () => {
    const exec = executable(read());
    for (const role of ORPHANED_ROLES) {
      // Each role drop is guarded: present-check then `drop role` (DROP ROLE lacks IF EXISTS).
      expect(exec, `missing guarded drop of role ${role}`).toMatch(
        new RegExp(`if exists \\(select 1 from pg_roles where rolname = '${role}'\\)`, "i"),
      );
      expect(exec, `missing drop role ${role}`).toMatch(new RegExp(`drop role ${role}\\b`, "i"));
    }
    // No project-created role is (re-)created by the reconcile.
    expect(exec).not.toMatch(/create role (pipeline_writer|dashboard_reader|diagnostic_reader)\b/i);
  });

  // --- R8.6 / R10.6: data preservation BEFORE any drop -----------------------

  it("preserves the Realized_Outcome_Journal into realized_outcomes BEFORE any drop (R8.6, R10.6)", () => {
    const exec = executable(read());
    // The back-fill inserts into the retained journal, guarded + idempotent.
    expect(exec).toMatch(/insert into realized_outcomes/i);
    expect(exec).toMatch(/on conflict \(strategy_id, pair, decision_date\) do nothing/i);
    expect(exec).toMatch(/to_regclass\('public\.realized_outcomes'\)/i);
    // Ordering: the preservation insert must come BEFORE the first destructive drop.
    const insertIdx = exec.search(/insert into realized_outcomes/i);
    const firstDropIdx = exec.search(/drop (table|view|role|policy) /i);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(firstDropIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx, "data preservation must precede the drops").toBeLessThan(firstDropIdx);
  });

  // --- R4.5 / R4.6: public read, restricted write, no RLS --------------------

  it("grants public SELECT on the six retained tables (R4.5)", () => {
    const exec = executable(read());
    for (const table of REQUIRED_TABLES) {
      expect(exec, `missing public SELECT grant on ${table}`).toMatch(
        new RegExp(`grant select on ${table} to public`, "i"),
      );
    }
  });

  it("restricts INSERT/UPDATE to the single Write_Credential and never grants public write (R4.6)", () => {
    const exec = executable(read());
    // The Write_Credential role gets select/insert/update (NOT delete) on retained tables.
    for (const table of REQUIRED_TABLES) {
      expect(exec, `missing fx_writer insert/update grant on ${table}`).toMatch(
        new RegExp(`grant select, insert, update on ${table} to fx_writer`, "i"),
      );
    }
    // PUBLIC never receives insert/update/delete; scan the actual `to public` grants.
    const publicGrants = (exec.match(/grant[^;]*to public\s*;/gi) ?? []).join("\n");
    expect(publicGrants.length).toBeGreaterThan(0);
    expect(publicGrants).not.toMatch(/\b(insert|update|delete)\b/i);
    // No DELETE is granted to the Write_Credential either.
    const writerGrants = (exec.match(/grant[^;]*to fx_writer\s*;/gi) ?? []).join("\n");
    expect(writerGrants).not.toMatch(/\bdelete\b/i);
  });

  it("makes fx_writer assumable via PostgREST by granting it to authenticator (R4.5, R4.6)", () => {
    const exec = executable(read());
    // PostgREST connects as `authenticator` and SET ROLEs into the JWT `role` claim;
    // without the membership grant a fx_writer JWT is rejected with 42501. Mirrors
    // `grant pipeline_writer to authenticator` in migration 20260916000002.
    expect(exec, "fx_writer must be granted to authenticator so PostgREST can SET ROLE").toMatch(
      /grant fx_writer to authenticator/i,
    );
    // The membership grant is guarded on `authenticator` existence so it is a no-op /
    // re-runnable on a target where that role is absent.
    expect(exec).toMatch(/if exists \(select 1 from pg_roles where rolname = 'authenticator'\)/i);
  });

  // --- R10.5: idempotency — safe to re-run -----------------------------------

  it("is idempotent: every table/view/policy drop uses `if exists`, every role drop is guarded (R10.5)", () => {
    const exec = executable(read());
    // Every executed `drop table|view|policy` uses the `if exists` guard.
    const guardedDrops = exec.match(/drop (table|view|policy)[^\n]*/gi) ?? [];
    expect(guardedDrops.length).toBeGreaterThan(0);
    for (const stmt of guardedDrops) {
      expect(stmt, `drop must be guarded: ${stmt}`).toMatch(/if exists/i);
    }
    // Every executed `drop role` is preceded by a pg_roles existence guard (DROP ROLE has
    // no IF EXISTS), so the whole role-drop step is a no-op once the roles are gone.
    const roleDrops = exec.match(/drop role \w+/gi) ?? [];
    expect(roleDrops.length).toBe(ORPHANED_ROLES.length);
    expect(exec.match(/if exists \(select 1 from pg_roles/gi)?.length ?? 0).toBeGreaterThanOrEqual(
      ORPHANED_ROLES.length,
    );
  });

  // --- The evaluation_reports create (task 2) is still intact ----------------

  it("still creates evaluation_reports with no verdict column (task 2 unchanged)", () => {
    const sql = read();
    expect(sql).toMatch(/create table if not exists evaluation_reports/i);
    expect(sql).not.toMatch(/^\s*verdict\s+text/im);
  });
});
