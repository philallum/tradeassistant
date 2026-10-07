# Diagnostic_Read_Path Policy

Version-controlled policy for routine read-only hosted verification
(dashboard-data-activation Requirement 6).

This document is the authoritative, committed record of **which credential/endpoint routine
read-only diagnostics use** and **why the alternatives are insufficient**. It accompanies the
idempotent migration
[`supabase/migrations/20260916000005_diagnostic_read_path.sql`](./migrations/20260916000005_diagnostic_read_path.sql),
which provisions the role described below.

## Summary

| Concern | Decision |
| --- | --- |
| Routine read-only diagnostic path | `diagnostic_reader` Postgres role, reached via a scoped read JWT (`role` claim = `diagnostic_reader`) through PostgREST |
| Access granted | `SELECT` only on the counted tables + `USAGE` on `schema public` |
| Write access | None (no `INSERT`/`UPDATE`/`DELETE`) |
| RLS posture | `NOBYPASSRLS`, `NOSUPERUSER`; reads only through role-scoped `SELECT` RLS policies |
| Service_Role_Key for routine use | **Never** |

## The Diagnostic_Read_Path

Routine read-only verification (obtaining exact hosted row counts) uses the **`diagnostic_reader`
Postgres role**. It is a `NOLOGIN` role reached only through PostgREST, by presenting a signed
JWT whose `role` claim selects `diagnostic_reader` (a scoped read credential). PostgREST connects
as `authenticator` and `SET ROLE`s into `diagnostic_reader`; the migration grants
`diagnostic_reader` to `authenticator` so that switch is permitted.

The role is granted the minimum needed to return counts and nothing more:

- `USAGE` on `schema public`
- `SELECT` on exactly the **counted tables** — the compute-written and gate tables whose exact
  row counts matter for routine verification:
  - `candles`
  - `pattern_vectors`
  - `analogue_outcomes`
  - `firing_setups`
  - `realized_outcomes`
  - `gate_verdicts`
  - `gate_fold_verdicts`
  - `feature_registry`
- A role-scoped `SELECT`-only RLS policy (`diagnostic_reader_select`) on each counted table, so
  the role can read counts under RLS **without any RLS-bypass**.

The role is created `NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`. It holds **no
write grant** (`INSERT`/`UPDATE`/`DELETE`) on any table and **no RLS-bypassing capability**
(Req 6.5). It is distinct from `pipeline_writer` (write path) and `dashboard_reader` (curated
view-only serving layer); the migration leaves both of those untouched.

A counts query against this path (e.g. `GET /rest/v1/<table>?select=count` with the
`Prefer: count=exact` header, or `select count(*) from <table>`) returns exact row counts
without the Service_Role_Key.

## Why the other credentials are insufficient for raw counts

- **Publishable (anon) key — RLS-limited to 0 rows.** The anon role has no `SELECT` RLS policy
  on the counted base tables, so under default-deny RLS it sees **0 rows**. A count through the
  anon key therefore reports `0` regardless of the true hosted row count, making it useless for
  verification. (The curated dashboard read views intentionally project only display data for
  `dashboard_reader`; they are not a raw-count path either.)
- **Scoped read key (raw PostgREST) — 401.** The scoped read credential is not authorized for
  raw PostgREST reads of the base tables and is rejected with **HTTP 401**, so it cannot return
  raw counts.

Because both of the lighter-weight credentials fail to return accurate raw counts, the dedicated
least-privilege `diagnostic_reader` role is the durable path for routine verification.

## Service_Role_Key policy

- **Routine verification never uses the Service_Role_Key** (Req 6.3). Routine read-only
  diagnostics use the Diagnostic_Read_Path above.
- **Operator one-off only** (Req 6.4): if the Service_Role_Key is ever used for a one-off, it is:
  - used **strictly for read-only** diagnostics,
  - used **only with explicit operator approval**, and
  - **never echoed, logged, or committed** — the key is referenced by name only and sourced from
    Secret_Manager or stdin, consistent with `operational-wiring` Requirement 8.4 and
    dashboard-data-activation Requirement 9.

## Provisioning and application

The role, grants, and RLS policies are defined in the idempotent migration
`supabase/migrations/20260916000005_diagnostic_read_path.sql`, which applies identically to the
local and hosted Supabase targets and is safe to re-run. Applying the grant to the hosted backend
is a separate operator-approved live operation (spec task 13.3) performed under the Live Cloud
Execution Protocol (Requirement 9): the exact command is shown for approval before execution, the
resolved target/project are reconciled first, and only non-secret references are recorded.
