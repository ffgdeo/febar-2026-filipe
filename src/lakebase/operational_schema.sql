-- PromoFlow operational schema for the hybrid planning application.
-- Governed analytics, model scores, event facts and availability stay in Unity
-- Catalog. Lakebase stores mutable work and immutable decision-time snapshots.
CREATE SCHEMA IF NOT EXISTS promoflow_ops;

CREATE TABLE IF NOT EXISTS promoflow_ops.scenarios (
  scenario_id text PRIMARY KEY, title text NOT NULL CHECK (length(trim(title)) > 0),
  opportunity_id text, owner_principal text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','ARCHIVED')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  submitted_at timestamptz, decided_at timestamptz
);

-- Immutable input, economics, feasibility and provenance snapshot used in a decision.
CREATE TABLE IF NOT EXISTS promoflow_ops.scenario_versions (
  scenario_id text NOT NULL REFERENCES promoflow_ops.scenarios(scenario_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0), created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp, change_note text,
  event_id text, event_name text, sku_id text NOT NULL, product_name text NOT NULL,
  category text NOT NULL, cluster_id text NOT NULL, cluster_name text NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL CHECK (end_date >= start_date),
  promotion_mechanic text NOT NULL CHECK (promotion_mechanic IN ('TPR','FEATURE','DISPLAY','FEATURE_DISPLAY','BOGO')),
  discount_pct numeric(8,4) NOT NULL CHECK (discount_pct BETWEEN 0 AND 60),
  list_price numeric(18,4) NOT NULL CHECK (list_price > 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0 AND unit_cost < list_price),
  predicted_baseline_units numeric(18,2) NOT NULL CHECK (predicted_baseline_units >= 0),
  modeled_uplift_units numeric(18,2) NOT NULL, modeled_uplift_pct numeric(12,6) NOT NULL,
  predicted_promotion_units numeric(18,2) NOT NULL CHECK (predicted_promotion_units >= 0),
  estimated_trade_spend numeric(18,2) NOT NULL CHECK (estimated_trade_spend >= 0),
  estimated_incremental_margin numeric(18,2) NOT NULL, estimated_promotion_roi numeric(18,6),
  -- Feasibility only: no replenishment or transfer actions are created.
  on_hand_units numeric(18,2) NOT NULL CHECK (on_hand_units >= 0),
  inbound_units numeric(18,2) NOT NULL CHECK (inbound_units >= 0),
  committed_units numeric(18,2) NOT NULL CHECK (committed_units >= 0),
  safety_stock_units numeric(18,2) NOT NULL CHECK (safety_stock_units >= 0),
  projected_available_units numeric(18,2) NOT NULL, availability_coverage_pct numeric(12,6),
  potential_shortfall_units numeric(18,2) NOT NULL CHECK (potential_shortfall_units >= 0),
  feasibility_status text NOT NULL CHECK (feasibility_status IN ('READY','REVIEW','CONSTRAINED')),
  availability_as_of timestamptz NOT NULL,
  model_name text NOT NULL, model_version text NOT NULL, mlflow_run_id text,
  scored_at timestamptz NOT NULL, calculation_version text NOT NULL,
  analytics_freshness_at timestamptz NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb, assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (scenario_id, version)
);

CREATE TABLE IF NOT EXISTS promoflow_ops.scenario_comparisons (
  comparison_id text PRIMARY KEY, name text NOT NULL CHECK (length(trim(name)) > 0),
  owner_principal text NOT NULL, created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE TABLE IF NOT EXISTS promoflow_ops.scenario_comparison_members (
  comparison_id text NOT NULL REFERENCES promoflow_ops.scenario_comparisons(comparison_id) ON DELETE CASCADE,
  scenario_id text NOT NULL, scenario_version integer NOT NULL,
  display_order smallint NOT NULL CHECK (display_order BETWEEN 1 AND 3),
  added_at timestamptz NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (comparison_id, scenario_id), UNIQUE (comparison_id, display_order),
  FOREIGN KEY (scenario_id, scenario_version) REFERENCES promoflow_ops.scenario_versions(scenario_id, version)
);

-- Append-only human decision events; scenarios holds the current workflow state.
CREATE TABLE IF NOT EXISTS promoflow_ops.promotion_decisions (
  decision_id text PRIMARY KEY, scenario_id text NOT NULL, scenario_version integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('SUBMIT','APPROVE','REJECT','REQUEST_CHANGES')),
  actor_principal text NOT NULL, rationale text,
  decided_at timestamptz NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (scenario_id, scenario_version) REFERENCES promoflow_ops.scenario_versions(scenario_id, version)
);

-- Structured Unity Gateway output plus complete governance provenance.
CREATE TABLE IF NOT EXISTS promoflow_ops.ai_decision_briefs (
  brief_id text PRIMARY KEY, scenario_id text NOT NULL, scenario_version integer NOT NULL,
  generation_status text NOT NULL CHECK (generation_status IN ('SUCCEEDED','FAILED')),
  executive_recommendation text, supporting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions_uncertainties jsonb NOT NULL DEFAULT '[]'::jsonb,
  commercial_risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_questions jsonb NOT NULL DEFAULT '[]'::jsonb, suggested_next_action text, raw_text text,
  model_service text NOT NULL, prompt_version text NOT NULL, input_fingerprint text NOT NULL,
  response_id text, request_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb, source_freshness_at timestamptz NOT NULL,
  generated_by text NOT NULL, generated_at timestamptz NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (scenario_id, scenario_version) REFERENCES promoflow_ops.scenario_versions(scenario_id, version)
);

CREATE TABLE IF NOT EXISTS promoflow_ops.audit_events (
  audit_event_id text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('SCENARIO','COMPARISON','DECISION','AI_DECISION_BRIEF')),
  entity_id text NOT NULL, event_type text NOT NULL, actor_principal text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_scenarios_work_queue ON promoflow_ops.scenarios(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_versions_product_event ON promoflow_ops.scenario_versions(sku_id,cluster_id,event_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_decisions_scenario ON promoflow_ops.promotion_decisions(scenario_id,decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decision_briefs_scenario ON promoflow_ops.ai_decision_briefs(scenario_id,scenario_version,generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decision_briefs_fingerprint ON promoflow_ops.ai_decision_briefs(input_fingerprint,generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON promoflow_ops.audit_events(entity_type,entity_id,occurred_at DESC);

-- Retains full row images for operational audit and future CDC compatibility.
-- Reverse Lakehouse Sync is intentionally not configured in this prototype.
ALTER TABLE promoflow_ops.scenarios REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.scenario_versions REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.scenario_comparisons REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.scenario_comparison_members REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.promotion_decisions REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.ai_decision_briefs REPLICA IDENTITY FULL;
ALTER TABLE promoflow_ops.audit_events REPLICA IDENTITY FULL;
