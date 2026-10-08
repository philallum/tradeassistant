


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."analogue_outcomes" (
    "asset" "text" NOT NULL,
    "decision_date" "date" NOT NULL,
    "horizon" smallint NOT NULL,
    "direction" "text" NOT NULL,
    "mfe_pips" double precision NOT NULL,
    "mae_pips" double precision NOT NULL,
    "atr14" double precision NOT NULL,
    "matured" boolean NOT NULL,
    CONSTRAINT "analogue_outcomes_direction_check" CHECK (("direction" = ANY (ARRAY['UP'::"text", 'DOWN'::"text", 'FLAT'::"text"]))),
    CONSTRAINT "analogue_outcomes_horizon_check" CHECK (("horizon" = ANY (ARRAY[1, 2, 3])))
);


ALTER TABLE "public"."analogue_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "decision_date" "date" NOT NULL,
    "currency" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "impact" "text" NOT NULL,
    "event_ts" timestamp with time zone NOT NULL,
    "source" "text" NOT NULL
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."candles" (
    "asset" "text" NOT NULL,
    "date" "date" NOT NULL,
    "open" double precision NOT NULL,
    "high" double precision NOT NULL,
    "low" double precision NOT NULL,
    "close" double precision NOT NULL,
    "source" "text" NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ohlc_valid" CHECK ((("high" >= "low") AND (("open" >= "low") AND ("open" <= "high")) AND (("close" >= "low") AND ("close" <= "high"))))
);


ALTER TABLE "public"."candles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."data_splits" (
    "asset" "text" NOT NULL,
    "train_end" "date" NOT NULL,
    "test_start" "date" NOT NULL,
    "test_end" "date" NOT NULL,
    "frozen" boolean DEFAULT true NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."data_splits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."external_reference_comparison" (
    "decision_date" "date" NOT NULL,
    "pair" "text" NOT NULL,
    "own_direction" "text",
    "reference_direction" "text",
    "reference_score" double precision,
    "provider" "text",
    "comparison" "text" NOT NULL,
    "provenance" "text" DEFAULT 'external_provider'::"text" NOT NULL,
    "is_display_only" boolean DEFAULT true NOT NULL,
    "fetched_at" timestamp with time zone,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "external_reference_comparison_comparison_check" CHECK (("comparison" = ANY (ARRAY['agree'::"text", 'diverge'::"text", 'neutral'::"text", 'unavailable'::"text"]))),
    CONSTRAINT "external_reference_comparison_own_direction_check" CHECK (("own_direction" = ANY (ARRAY['UP'::"text", 'DOWN'::"text", 'FLAT'::"text"]))),
    CONSTRAINT "external_reference_comparison_reference_direction_check" CHECK (("reference_direction" = ANY (ARRAY['BUY'::"text", 'SELL'::"text", 'HOLD'::"text"])))
);


ALTER TABLE "public"."external_reference_comparison" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feature_registry" (
    "feature_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "verdict_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feature_registry_status_check" CHECK (("status" = ANY (ARRAY['candidate'::"text", 'included'::"text", 'cut'::"text"])))
);


ALTER TABLE "public"."feature_registry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."firing_setups" (
    "decision_date" "date" NOT NULL,
    "pair" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "horizon" smallint NOT NULL,
    "earned_confidence" double precision NOT NULL,
    "stop_loss_pips" double precision,
    "take_profit_pips" double precision,
    "surfaced" boolean NOT NULL,
    "suppression_reason" "text",
    "competing_pairs" "text"[],
    "strategy_id" "text" DEFAULT 'system'::"text" NOT NULL,
    CONSTRAINT "firing_setups_direction_check" CHECK (("direction" = ANY (ARRAY['UP'::"text", 'DOWN'::"text", 'FLAT'::"text"]))),
    CONSTRAINT "firing_setups_horizon_check" CHECK (("horizon" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "firing_setups_suppression_reason_check" CHECK (("suppression_reason" = ANY (ARRAY['news'::"text", 'currency_concentration'::"text", 'below_floor'::"text", 'not_fired'::"text", 'too_choppy'::"text"])))
);


ALTER TABLE "public"."firing_setups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gate_fold_verdicts" (
    "verdict_id" "uuid" NOT NULL,
    "fold_index" integer NOT NULL,
    "sample_size" integer NOT NULL,
    "skipped" boolean DEFAULT false NOT NULL,
    "gate1_passed" boolean,
    "gate2_passed" boolean,
    "verdict" "text",
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "gate_fold_verdicts_verdict_check" CHECK (("verdict" = ANY (ARRAY['PASS'::"text", 'CUT'::"text"])))
);


ALTER TABLE "public"."gate_fold_verdicts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gate_verdicts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "config_id" "text" NOT NULL,
    "sample_size" integer NOT NULL,
    "gate1_model_acc" double precision NOT NULL,
    "gate1_baseline_acc" double precision NOT NULL,
    "gate1_delta_pp" double precision NOT NULL,
    "gate1_passed" boolean NOT NULL,
    "gate2_model_ra" double precision,
    "gate2_baseline_ra" double precision,
    "gate2_margin" double precision,
    "gate2_passed" boolean,
    "verdict" "text" NOT NULL,
    "selected_horizon" smallint,
    "split_train_end" "date" NOT NULL,
    "split_test_start" "date" NOT NULL,
    "split_test_end" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gate_verdicts_selected_horizon_check" CHECK (("selected_horizon" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "gate_verdicts_verdict_check" CHECK (("verdict" = ANY (ARRAY['PASS'::"text", 'CUT'::"text"])))
);


ALTER TABLE "public"."gate_verdicts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."news_risk_flags" (
    "decision_date" "date" NOT NULL,
    "pair" "text" NOT NULL,
    "level" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "feed_ok" boolean NOT NULL
);


ALTER TABLE "public"."news_risk_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pattern_vectors" (
    "asset" "text" NOT NULL,
    "decision_date" "date" NOT NULL,
    "embedding" "public"."vector"(70) NOT NULL,
    "weekly_trend_sign" "text" NOT NULL,
    "scale_dims" "jsonb" NOT NULL,
    CONSTRAINT "pattern_vectors_weekly_trend_sign_check" CHECK (("weekly_trend_sign" = ANY (ARRAY['UP'::"text", 'DOWN'::"text"])))
);


ALTER TABLE "public"."pattern_vectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realized_outcomes" (
    "strategy_id" "text" DEFAULT 'system'::"text" NOT NULL,
    "pair" "text" NOT NULL,
    "decision_date" "date" NOT NULL,
    "predicted_direction" "text" NOT NULL,
    "horizon" smallint NOT NULL,
    "earned_confidence" double precision NOT NULL,
    "stop_loss_pips" double precision,
    "take_profit_pips" double precision,
    "realized_direction" "text",
    "realized_mfe_pips" double precision,
    "realized_mae_pips" double precision,
    "matured" boolean DEFAULT false NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "realized_outcomes_horizon_check" CHECK (("horizon" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "realized_outcomes_predicted_direction_check" CHECK (("predicted_direction" = ANY (ARRAY['UP'::"text", 'DOWN'::"text", 'FLAT'::"text"]))),
    CONSTRAINT "realized_outcomes_realized_direction_check" CHECK (("realized_direction" = ANY (ARRAY['UP'::"text", 'DOWN'::"text", 'FLAT'::"text"])))
);


ALTER TABLE "public"."realized_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signal_rationale" (
    "decision_date" "date" NOT NULL,
    "pair" "text" NOT NULL,
    "strategy_id" "text" DEFAULT 'system'::"text" NOT NULL,
    "rationale_text" "text" NOT NULL,
    "analogue_labels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "proposals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "provenance" "text" DEFAULT 'llm'::"text" NOT NULL,
    "is_display_only" boolean DEFAULT true NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signal_rationale" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_analogue_outcomes" AS
 SELECT "asset",
    "decision_date",
    "horizon",
    "direction",
    "mfe_pips",
    "mae_pips",
    "matured"
   FROM "public"."analogue_outcomes"
  WHERE ("asset" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_analogue_outcomes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_candles" AS
 SELECT "asset",
    "date",
    "open",
    "high",
    "low",
    "close"
   FROM "public"."candles"
  WHERE ("asset" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_candles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_decision_dates" AS
 SELECT DISTINCT "decision_date"
   FROM "public"."firing_setups"
  WHERE ("pair" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_decision_dates" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_external_reference_comparison" AS
 SELECT "decision_date",
    "pair",
    "own_direction",
    "reference_direction",
    "reference_score",
    "provider",
    "comparison",
    "provenance",
    "is_display_only",
    "fetched_at"
   FROM "public"."external_reference_comparison"
  WHERE ("pair" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_external_reference_comparison" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_firing_setups" AS
 SELECT "decision_date",
    "pair",
    "strategy_id",
    "direction",
    "horizon",
    "earned_confidence",
    "stop_loss_pips",
    "take_profit_pips",
    "surfaced",
    "suppression_reason",
    "competing_pairs"
   FROM "public"."firing_setups"
  WHERE ("pair" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_firing_setups" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_gate_fold_verdicts" AS
 SELECT "verdict_id",
    "fold_index",
    "sample_size",
    "skipped",
    "gate1_passed",
    "gate2_passed",
    "verdict"
   FROM "public"."gate_fold_verdicts";


ALTER VIEW "public"."v_gate_fold_verdicts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_gate_verdicts" AS
 SELECT "id",
    "config_id",
    "sample_size",
    "gate1_model_acc",
    "gate1_baseline_acc",
    "gate1_delta_pp",
    "gate1_passed",
    "gate2_model_ra",
    "gate2_baseline_ra",
    "gate2_margin",
    "gate2_passed",
    "verdict",
    "selected_horizon",
    "split_test_start",
    "split_test_end",
    "created_at"
   FROM "public"."gate_verdicts";


ALTER VIEW "public"."v_gate_verdicts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_realized_outcomes" AS
 SELECT "strategy_id",
    "pair",
    "decision_date",
    "predicted_direction",
    "horizon",
    "earned_confidence",
    "stop_loss_pips",
    "take_profit_pips",
    "realized_direction",
    "realized_mfe_pips",
    "realized_mae_pips",
    "matured"
   FROM "public"."realized_outcomes"
  WHERE ("pair" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_realized_outcomes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_signal_rationale" AS
 SELECT "decision_date",
    "pair",
    "strategy_id",
    "rationale_text",
    "analogue_labels",
    "proposals",
    "provenance",
    "is_display_only"
   FROM "public"."signal_rationale"
  WHERE ("pair" = ANY (ARRAY['EURUSD'::"text", 'GBPUSD'::"text", 'USDJPY'::"text", 'USDCHF'::"text", 'USDCAD'::"text"]));


ALTER VIEW "public"."v_signal_rationale" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."version_ledger" (
    "component" "text" NOT NULL,
    "version" "text" NOT NULL,
    "is_prerelease" boolean DEFAULT false NOT NULL,
    "verified_at" "date" NOT NULL,
    "latest_known" "text"
);


ALTER TABLE "public"."version_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."walk_forward_folds" (
    "asset" "text" NOT NULL,
    "fold_index" integer NOT NULL,
    "train_start" "date" NOT NULL,
    "train_end" "date" NOT NULL,
    "test_start" "date" NOT NULL,
    "test_end" "date" NOT NULL,
    "frozen" boolean DEFAULT true NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."walk_forward_folds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."yields" (
    "country" "text" NOT NULL,
    "date" "date" NOT NULL,
    "yield_10y" double precision NOT NULL,
    "source" "text" NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."yields" OWNER TO "postgres";


ALTER TABLE ONLY "public"."analogue_outcomes"
    ADD CONSTRAINT "analogue_outcomes_pkey" PRIMARY KEY ("asset", "decision_date", "horizon");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("decision_date", "currency", "event_name", "event_ts");



ALTER TABLE ONLY "public"."candles"
    ADD CONSTRAINT "candles_pkey" PRIMARY KEY ("asset", "date");



ALTER TABLE ONLY "public"."data_splits"
    ADD CONSTRAINT "data_splits_pkey" PRIMARY KEY ("asset");



ALTER TABLE ONLY "public"."external_reference_comparison"
    ADD CONSTRAINT "external_reference_comparison_pkey" PRIMARY KEY ("decision_date", "pair");



ALTER TABLE ONLY "public"."feature_registry"
    ADD CONSTRAINT "feature_registry_pkey" PRIMARY KEY ("feature_id");



ALTER TABLE ONLY "public"."firing_setups"
    ADD CONSTRAINT "firing_setups_pkey" PRIMARY KEY ("decision_date", "pair", "strategy_id");



ALTER TABLE ONLY "public"."gate_fold_verdicts"
    ADD CONSTRAINT "gate_fold_verdicts_pkey" PRIMARY KEY ("verdict_id", "fold_index");



ALTER TABLE ONLY "public"."gate_verdicts"
    ADD CONSTRAINT "gate_verdicts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."news_risk_flags"
    ADD CONSTRAINT "news_risk_flags_pkey" PRIMARY KEY ("decision_date", "pair");



ALTER TABLE ONLY "public"."pattern_vectors"
    ADD CONSTRAINT "pattern_vectors_pkey" PRIMARY KEY ("asset", "decision_date");



ALTER TABLE ONLY "public"."realized_outcomes"
    ADD CONSTRAINT "realized_outcomes_pkey" PRIMARY KEY ("strategy_id", "pair", "decision_date");



ALTER TABLE ONLY "public"."signal_rationale"
    ADD CONSTRAINT "signal_rationale_pkey" PRIMARY KEY ("decision_date", "pair", "strategy_id");



ALTER TABLE ONLY "public"."version_ledger"
    ADD CONSTRAINT "version_ledger_pkey" PRIMARY KEY ("component");



ALTER TABLE ONLY "public"."walk_forward_folds"
    ADD CONSTRAINT "walk_forward_folds_pkey" PRIMARY KEY ("asset", "fold_index");



ALTER TABLE ONLY "public"."yields"
    ADD CONSTRAINT "yields_pkey" PRIMARY KEY ("country", "date");



CREATE INDEX "pattern_vectors_embedding_hnsw_idx" ON "public"."pattern_vectors" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "pattern_vectors_trend_asset_idx" ON "public"."pattern_vectors" USING "btree" ("weekly_trend_sign", "asset");



ALTER TABLE ONLY "public"."feature_registry"
    ADD CONSTRAINT "feature_registry_verdict_id_fkey" FOREIGN KEY ("verdict_id") REFERENCES "public"."gate_verdicts"("id");



ALTER TABLE ONLY "public"."gate_fold_verdicts"
    ADD CONSTRAINT "gate_fold_verdicts_verdict_id_fkey" FOREIGN KEY ("verdict_id") REFERENCES "public"."gate_verdicts"("id") ON DELETE CASCADE;



ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dashboard_reader_select" ON "public"."external_reference_comparison" FOR SELECT TO "dashboard_reader" USING (true);



CREATE POLICY "dashboard_reader_select" ON "public"."signal_rationale" FOR SELECT TO "dashboard_reader" USING (true);



ALTER TABLE "public"."data_splits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "diagnostic_reader_select" ON "public"."feature_registry" FOR SELECT TO "diagnostic_reader" USING (true);



CREATE POLICY "diagnostic_reader_select" ON "public"."gate_fold_verdicts" FOR SELECT TO "diagnostic_reader" USING (true);



CREATE POLICY "diagnostic_reader_select" ON "public"."gate_verdicts" FOR SELECT TO "diagnostic_reader" USING (true);



ALTER TABLE "public"."external_reference_comparison" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feature_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gate_fold_verdicts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gate_verdicts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."news_risk_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_writer_rw" ON "public"."external_reference_comparison" TO "pipeline_writer" USING (true) WITH CHECK (true);



CREATE POLICY "pipeline_writer_rw" ON "public"."feature_registry" TO "pipeline_writer" USING (true) WITH CHECK (true);



CREATE POLICY "pipeline_writer_rw" ON "public"."gate_fold_verdicts" TO "pipeline_writer" USING (true) WITH CHECK (true);



CREATE POLICY "pipeline_writer_rw" ON "public"."gate_verdicts" TO "pipeline_writer" USING (true) WITH CHECK (true);



CREATE POLICY "pipeline_writer_rw" ON "public"."signal_rationale" TO "pipeline_writer" USING (true) WITH CHECK (true);



ALTER TABLE "public"."signal_rationale" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."version_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."walk_forward_folds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."yields" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "pipeline_writer";
GRANT USAGE ON SCHEMA "public" TO "dashboard_reader";
GRANT USAGE ON SCHEMA "public" TO "diagnostic_reader";
GRANT USAGE ON SCHEMA "public" TO "fx_writer";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";









GRANT ALL ON TABLE "public"."analogue_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."analogue_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."analogue_outcomes" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."analogue_outcomes" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."analogue_outcomes" TO "diagnostic_reader";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."analogue_outcomes" TO "fx_writer";



GRANT ALL ON TABLE "public"."calendar_events" TO "anon";
GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT ALL ON TABLE "public"."candles" TO "anon";
GRANT ALL ON TABLE "public"."candles" TO "authenticated";
GRANT ALL ON TABLE "public"."candles" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."candles" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."candles" TO "diagnostic_reader";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."candles" TO "fx_writer";



GRANT ALL ON TABLE "public"."data_splits" TO "anon";
GRANT ALL ON TABLE "public"."data_splits" TO "authenticated";
GRANT ALL ON TABLE "public"."data_splits" TO "service_role";



GRANT ALL ON TABLE "public"."external_reference_comparison" TO "anon";
GRANT ALL ON TABLE "public"."external_reference_comparison" TO "authenticated";
GRANT ALL ON TABLE "public"."external_reference_comparison" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."external_reference_comparison" TO "pipeline_writer";



GRANT ALL ON TABLE "public"."feature_registry" TO "anon";
GRANT ALL ON TABLE "public"."feature_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_registry" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."feature_registry" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."feature_registry" TO "diagnostic_reader";



GRANT ALL ON TABLE "public"."firing_setups" TO "anon";
GRANT ALL ON TABLE "public"."firing_setups" TO "authenticated";
GRANT ALL ON TABLE "public"."firing_setups" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."firing_setups" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."firing_setups" TO "diagnostic_reader";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."firing_setups" TO "fx_writer";



GRANT ALL ON TABLE "public"."gate_fold_verdicts" TO "anon";
GRANT ALL ON TABLE "public"."gate_fold_verdicts" TO "authenticated";
GRANT ALL ON TABLE "public"."gate_fold_verdicts" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."gate_fold_verdicts" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."gate_fold_verdicts" TO "diagnostic_reader";



GRANT ALL ON TABLE "public"."gate_verdicts" TO "anon";
GRANT ALL ON TABLE "public"."gate_verdicts" TO "authenticated";
GRANT ALL ON TABLE "public"."gate_verdicts" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."gate_verdicts" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."gate_verdicts" TO "diagnostic_reader";



GRANT ALL ON TABLE "public"."news_risk_flags" TO "anon";
GRANT ALL ON TABLE "public"."news_risk_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."news_risk_flags" TO "service_role";



GRANT ALL ON TABLE "public"."pattern_vectors" TO "anon";
GRANT ALL ON TABLE "public"."pattern_vectors" TO "authenticated";
GRANT ALL ON TABLE "public"."pattern_vectors" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."pattern_vectors" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."pattern_vectors" TO "diagnostic_reader";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."pattern_vectors" TO "fx_writer";



GRANT ALL ON TABLE "public"."realized_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."realized_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."realized_outcomes" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."realized_outcomes" TO "pipeline_writer";
GRANT SELECT ON TABLE "public"."realized_outcomes" TO "diagnostic_reader";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."realized_outcomes" TO "fx_writer";



GRANT ALL ON TABLE "public"."signal_rationale" TO "anon";
GRANT ALL ON TABLE "public"."signal_rationale" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_rationale" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."signal_rationale" TO "pipeline_writer";



GRANT ALL ON TABLE "public"."v_analogue_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."v_analogue_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."v_analogue_outcomes" TO "service_role";
GRANT SELECT ON TABLE "public"."v_analogue_outcomes" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_candles" TO "anon";
GRANT ALL ON TABLE "public"."v_candles" TO "authenticated";
GRANT ALL ON TABLE "public"."v_candles" TO "service_role";
GRANT SELECT ON TABLE "public"."v_candles" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_decision_dates" TO "anon";
GRANT ALL ON TABLE "public"."v_decision_dates" TO "authenticated";
GRANT ALL ON TABLE "public"."v_decision_dates" TO "service_role";
GRANT SELECT ON TABLE "public"."v_decision_dates" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_external_reference_comparison" TO "anon";
GRANT ALL ON TABLE "public"."v_external_reference_comparison" TO "authenticated";
GRANT ALL ON TABLE "public"."v_external_reference_comparison" TO "service_role";
GRANT SELECT ON TABLE "public"."v_external_reference_comparison" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_firing_setups" TO "anon";
GRANT ALL ON TABLE "public"."v_firing_setups" TO "authenticated";
GRANT ALL ON TABLE "public"."v_firing_setups" TO "service_role";
GRANT SELECT ON TABLE "public"."v_firing_setups" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_gate_fold_verdicts" TO "anon";
GRANT ALL ON TABLE "public"."v_gate_fold_verdicts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_gate_fold_verdicts" TO "service_role";
GRANT SELECT ON TABLE "public"."v_gate_fold_verdicts" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_gate_verdicts" TO "anon";
GRANT ALL ON TABLE "public"."v_gate_verdicts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_gate_verdicts" TO "service_role";
GRANT SELECT ON TABLE "public"."v_gate_verdicts" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_realized_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."v_realized_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."v_realized_outcomes" TO "service_role";
GRANT SELECT ON TABLE "public"."v_realized_outcomes" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."v_signal_rationale" TO "anon";
GRANT ALL ON TABLE "public"."v_signal_rationale" TO "authenticated";
GRANT ALL ON TABLE "public"."v_signal_rationale" TO "service_role";
GRANT SELECT ON TABLE "public"."v_signal_rationale" TO "dashboard_reader";



GRANT ALL ON TABLE "public"."version_ledger" TO "anon";
GRANT ALL ON TABLE "public"."version_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."version_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."walk_forward_folds" TO "anon";
GRANT ALL ON TABLE "public"."walk_forward_folds" TO "authenticated";
GRANT ALL ON TABLE "public"."walk_forward_folds" TO "service_role";



GRANT ALL ON TABLE "public"."yields" TO "anon";
GRANT ALL ON TABLE "public"."yields" TO "authenticated";
GRANT ALL ON TABLE "public"."yields" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































