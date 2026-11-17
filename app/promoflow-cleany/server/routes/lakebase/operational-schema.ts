export const OPERATIONAL_DDL = `
CREATE SCHEMA IF NOT EXISTS promoflow_ops;
CREATE TABLE IF NOT EXISTS promoflow_ops.scenarios (
 scenario_id text PRIMARY KEY,title text NOT NULL,opportunity_id text,owner_principal text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','SUBMITTED','APPROVED','REJECTED','ARCHIVED')),
 current_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),submitted_at timestamptz,decided_at timestamptz);
CREATE TABLE IF NOT EXISTS promoflow_ops.scenario_versions (
 scenario_id text NOT NULL REFERENCES promoflow_ops.scenarios(scenario_id) ON DELETE CASCADE,version integer NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),change_note text,event_id text,event_name text,
 sku_id text NOT NULL,product_name text NOT NULL,category text NOT NULL,cluster_id text NOT NULL,cluster_name text NOT NULL,
 start_date date NOT NULL,end_date date NOT NULL,promotion_mechanic text NOT NULL,discount_pct numeric(8,4) NOT NULL,
 list_price numeric(18,4) NOT NULL,unit_cost numeric(18,4) NOT NULL,predicted_baseline_units numeric(18,2) NOT NULL,
 modeled_uplift_units numeric(18,2) NOT NULL,modeled_uplift_pct numeric(12,6) NOT NULL,
 predicted_promotion_units numeric(18,2) NOT NULL,estimated_trade_spend numeric(18,2) NOT NULL,
 estimated_incremental_margin numeric(18,2) NOT NULL,estimated_promotion_roi numeric(18,6),
 on_hand_units numeric(18,2) NOT NULL,inbound_units numeric(18,2) NOT NULL,committed_units numeric(18,2) NOT NULL,
 safety_stock_units numeric(18,2) NOT NULL,projected_available_units numeric(18,2) NOT NULL,
 availability_coverage_pct numeric(12,6),potential_shortfall_units numeric(18,2) NOT NULL,
 feasibility_status text NOT NULL CHECK(feasibility_status IN('READY','REVIEW','CONSTRAINED')),
 availability_as_of timestamptz NOT NULL,model_name text NOT NULL,model_version text NOT NULL,mlflow_run_id text,
 scored_at timestamptz NOT NULL,calculation_version text NOT NULL,analytics_freshness_at timestamptz NOT NULL,
 source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
 PRIMARY KEY(scenario_id,version));
CREATE TABLE IF NOT EXISTS promoflow_ops.scenario_comparisons (
 comparison_id text PRIMARY KEY,name text NOT NULL,owner_principal text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS promoflow_ops.scenario_comparison_members (
 comparison_id text NOT NULL REFERENCES promoflow_ops.scenario_comparisons(comparison_id) ON DELETE CASCADE,
 scenario_id text NOT NULL,scenario_version integer NOT NULL,display_order smallint NOT NULL CHECK(display_order BETWEEN 1 AND 3),
 added_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(comparison_id,scenario_id),UNIQUE(comparison_id,display_order),
 FOREIGN KEY(scenario_id,scenario_version) REFERENCES promoflow_ops.scenario_versions(scenario_id,version));
CREATE TABLE IF NOT EXISTS promoflow_ops.promotion_decisions (
 decision_id text PRIMARY KEY,scenario_id text NOT NULL,scenario_version integer NOT NULL,
 decision text NOT NULL CHECK(decision IN('SUBMIT','APPROVE','REJECT','REQUEST_CHANGES')),
 actor_principal text NOT NULL,rationale text,decided_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(scenario_id,scenario_version) REFERENCES promoflow_ops.scenario_versions(scenario_id,version));
CREATE TABLE IF NOT EXISTS promoflow_ops.ai_decision_briefs (
 brief_id text PRIMARY KEY,scenario_id text NOT NULL,scenario_version integer NOT NULL,
 generation_status text NOT NULL CHECK(generation_status IN('SUCCEEDED','FAILED')),executive_recommendation text,
 supporting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,assumptions_uncertainties jsonb NOT NULL DEFAULT '[]'::jsonb,
 commercial_risks jsonb NOT NULL DEFAULT '[]'::jsonb,validation_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
 suggested_next_action text,raw_text text,model_service text NOT NULL,prompt_version text NOT NULL,input_fingerprint text NOT NULL,
 response_id text,request_tags jsonb NOT NULL DEFAULT '{}'::jsonb,usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 latency_ms integer,source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,source_freshness_at timestamptz NOT NULL,
 generated_by text NOT NULL,generated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(scenario_id,scenario_version) REFERENCES promoflow_ops.scenario_versions(scenario_id,version));
CREATE TABLE IF NOT EXISTS promoflow_ops.audit_events (
 audit_event_id text PRIMARY KEY,entity_type text NOT NULL,entity_id text NOT NULL,event_type text NOT NULL,
 actor_principal text NOT NULL,event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_scenarios_work_queue ON promoflow_ops.scenarios(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_scenario ON promoflow_ops.promotion_decisions(scenario_id,decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefs_scenario ON promoflow_ops.ai_decision_briefs(scenario_id,scenario_version,generated_at DESC);
ALTER TABLE promoflow_ops.scenarios REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.scenario_versions REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.scenario_comparisons REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.scenario_comparison_members REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.promotion_decisions REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.ai_decision_briefs REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.audit_events REPLICA IDENTITY FULL;
`;
