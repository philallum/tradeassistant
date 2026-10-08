
SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

CREATE ROLE "dashboard_reader";
ALTER ROLE "dashboard_reader" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;
CREATE ROLE "diagnostic_reader";
ALTER ROLE "diagnostic_reader" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;
CREATE ROLE "fx_writer";
ALTER ROLE "fx_writer" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;
CREATE ROLE "pipeline_writer";
ALTER ROLE "pipeline_writer" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;

ALTER ROLE "anon" SET "statement_timeout" TO '3s';

ALTER ROLE "authenticated" SET "statement_timeout" TO '8s';

ALTER ROLE "authenticator" SET "statement_timeout" TO '8s';

ALTER ROLE "supabase_admin" SET "statement_timeout" TO '0';

GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";

RESET ALL;
