-- Read-only live enumeration (migration ...006 task 5.1), run verbatim.
with required_tables(name) as (values
    ('candles'), ('pattern_vectors'), ('analogue_outcomes'),
    ('firing_setups'), ('realized_outcomes'), ('evaluation_reports')
  ),
  required_views(name) as (select null::text where false),
  required_roles(name) as (select null::text where false),
  project_schemas(nspname) as (
    select nspname from pg_namespace
    where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
      and nspname not like 'pg_temp_%'
      and nspname not like 'pg_toast_temp_%'
  ),
  enum_tables as (
    select 'table'::text as kind, t.table_schema as schema_name, t.table_name as object_name,
           case when t.table_name in (select name from required_tables)
                then 'kept' else 'orphaned' end as classification
    from information_schema.tables t
    join project_schemas s on s.nspname = t.table_schema
    where t.table_type = 'BASE TABLE'
  ),
  enum_views as (
    select 'view'::text, v.table_schema, v.table_name,
           case when v.table_name in (select name from required_views)
                then 'kept' else 'orphaned' end
    from information_schema.views v
    join project_schemas s on s.nspname = v.table_schema
  ),
  enum_indexes as (
    select 'index'::text, i.schemaname, i.indexname,
           case when i.tablename in (select name from required_tables)
                then 'kept' else 'orphaned' end
    from pg_indexes i
    join project_schemas s on s.nspname = i.schemaname
  ),
  enum_functions as (
    select 'function'::text, n.nspname, p.proname,
           'orphaned'::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join project_schemas s on s.nspname = n.nspname
  ),
  enum_roles as (
    select 'role'::text, '-'::text, r.rolname,
           case when r.rolname in (select name from required_roles)
                then 'kept' else 'orphaned' end
    from pg_roles r
    where r.rolname in ('pipeline_writer', 'dashboard_reader', 'diagnostic_reader')
  ),
  enum_policies as (
    select 'policy'::text, pol.schemaname, (pol.tablename || '.' || pol.policyname),
           'orphaned'::text
    from pg_policies pol
    join project_schemas s on s.nspname = pol.schemaname
  )
select kind, schema_name, object_name, classification
from (
  select * from enum_tables
  union all select * from enum_views
  union all select * from enum_indexes
  union all select * from enum_functions
  union all select * from enum_roles
  union all select * from enum_policies
) enumerated
order by classification, kind, schema_name, object_name;
