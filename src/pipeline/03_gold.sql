-- PromoFlow Gold: governed promotion-planning decision products.

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.promotion_performance
CLUSTER BY (start_date, sku_id, cluster_id)
COMMENT 'Campaign-level promotion results. Baseline is the average non-promoted daily units per store for the same SKU and cluster.'
AS
WITH nonpromo_baseline AS (
  SELECT s.sku_id, st.cluster_id,
         AVG(CAST(s.units_sold AS DECIMAL(18,4))) AS baseline_units_per_store_day
  FROM promoflow.promoflow_silver.pos_sales s
  JOIN promoflow.promoflow_silver.stores st ON s.store_id = st.store_id
  WHERE s.promotion_id IS NULL
  GROUP BY s.sku_id, st.cluster_id
), campaign_actuals AS (
  SELECT p.promotion_id, p.sku_id, p.cluster_id, p.start_date, p.end_date,
         p.mechanic, p.discount_pct, p.incident_code,
         COUNT(DISTINCT st.store_id) AS participating_stores,
         SUM(s.units_sold) AS actual_units,
         SUM(s.gross_revenue) AS actual_revenue,
         SUM(s.lost_sales_units) AS lost_sales_units
  FROM promoflow.promoflow_silver.promotions p
  JOIN promoflow.promoflow_silver.stores st ON p.cluster_id = st.cluster_id
  LEFT JOIN promoflow.promoflow_silver.pos_sales s
    ON s.promotion_id = p.promotion_id AND s.store_id = st.store_id
  GROUP BY p.promotion_id, p.sku_id, p.cluster_id, p.start_date, p.end_date,
           p.mechanic, p.discount_pct, p.incident_code
)
SELECT a.promotion_id, a.sku_id, pr.product_name, a.cluster_id, c.cluster_name,
       a.start_date, a.end_date, a.mechanic, a.discount_pct, a.incident_code,
       a.participating_stores, a.actual_units,
       CAST(ROUND(b.baseline_units_per_store_day * a.participating_stores
                  * (datediff(a.end_date, a.start_date) + 1), 0) AS BIGINT) AS baseline_units,
       CAST(a.actual_units - ROUND(b.baseline_units_per_store_day * a.participating_stores
                  * (datediff(a.end_date, a.start_date) + 1), 0) AS BIGINT) AS incremental_units,
       CAST(ROUND((a.actual_units / NULLIF(b.baseline_units_per_store_day * a.participating_stores
                  * (datediff(a.end_date, a.start_date) + 1), 0)) - 1, 4) AS DECIMAL(10,4)) AS modeled_uplift_rate,
       CAST(a.actual_revenue AS DECIMAL(18,2)) AS actual_revenue,
       CAST(ROUND(a.actual_units * pr.list_price * a.discount_pct, 2) AS DECIMAL(18,2)) AS trade_spend,
       CAST(ROUND((a.actual_units - b.baseline_units_per_store_day * a.participating_stores
                  * (datediff(a.end_date, a.start_date) + 1)) * (pr.list_price - pr.standard_cost)
                  - a.actual_units * pr.list_price * a.discount_pct, 2) AS DECIMAL(18,2)) AS incremental_margin,
       CAST(ROUND(
         ((a.actual_units - b.baseline_units_per_store_day * a.participating_stores
           * (datediff(a.end_date, a.start_date) + 1)) * (pr.list_price - pr.standard_cost)
          - a.actual_units * pr.list_price * a.discount_pct)
         / NULLIF(a.actual_units * pr.list_price * a.discount_pct, 0), 4
       ) AS DECIMAL(10,4)) AS promotion_roi,
       a.lost_sales_units,
       CAST(ROUND(a.lost_sales_units * pr.list_price * (1 - a.discount_pct), 2) AS DECIMAL(18,2)) AS revenue_at_risk
FROM campaign_actuals a
JOIN nonpromo_baseline b ON a.sku_id = b.sku_id AND a.cluster_id = b.cluster_id
JOIN promoflow.promoflow_silver.products pr ON a.sku_id = pr.sku_id
JOIN promoflow.promoflow_silver.store_clusters c ON a.cluster_id = c.cluster_id;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.executive_kpis
COMMENT 'Single-row Cleany executive scorecard spanning promotion profitability and shelf availability.'
AS
SELECT
  COUNT(*) AS promotion_count,
  CAST(ROUND(SUM(incremental_margin), 2) AS DECIMAL(18,2)) AS total_incremental_margin,
  CAST(ROUND(SUM(trade_spend), 2) AS DECIMAL(18,2)) AS total_trade_spend,
  CAST(ROUND(SUM(incremental_margin) / NULLIF(SUM(trade_spend), 0), 4) AS DECIMAL(10,4)) AS portfolio_promotion_roi,
  CAST(ROUND(AVG(modeled_uplift_rate), 4) AS DECIMAL(10,4)) AS average_modeled_uplift_rate,
  SUM(lost_sales_units) AS promotion_lost_sales_units,
  CAST(ROUND(SUM(revenue_at_risk), 2) AS DECIMAL(18,2)) AS promotion_revenue_at_risk,
  SUM(CASE WHEN promotion_roi > 0 THEN 1 ELSE 0 END) AS profitable_promotion_count,
  CAST(ROUND(AVG(CASE WHEN lost_sales_units = 0 THEN 1.0 ELSE 0.0 END), 4) AS DECIMAL(10,4)) AS campaign_availability_success_rate
FROM promoflow.promoflow_gold.promotion_performance;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.data_quality_kpis
COMMENT 'Evaluator-readable reconciliation and quarantine counts for the two injected quality cases.'
AS
SELECT 'POS_SALES' AS dataset, raw_rows, valid_rows, quarantined_rows, unreconciled_rows
FROM promoflow.promoflow_silver.sales_reconciliation
UNION ALL
SELECT 'INVENTORY_SNAPSHOTS' AS dataset, raw_rows, valid_rows, quarantined_rows, unreconciled_rows
FROM promoflow.promoflow_silver.inventory_reconciliation;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.promotion_explorer
CLUSTER BY (start_date, category, cluster_id)
COMMENT 'Historical promotion explorer. Success is observational: positive modeled incremental margin and ROI with no recorded lost sales; it is not a causal lift claim.'
AS
SELECT
  pp.promotion_id AS promotion_explorer_id,
  pp.promotion_id,
  pp.sku_id,
  pp.product_name,
  pr.category,
  pp.cluster_id,
  pp.cluster_name,
  pp.mechanic,
  pp.discount_pct,
  pp.start_date,
  pp.end_date,
  year(pp.start_date) AS promotion_year,
  quarter(pp.start_date) AS promotion_quarter,
  CASE
    WHEN month(pp.start_date) IN (12, 1, 2) THEN 'WINTER'
    WHEN month(pp.start_date) IN (3, 4, 5) THEN 'SPRING'
    WHEN month(pp.start_date) IN (6, 7, 8) THEN 'SUMMER'
    ELSE 'FALL'
  END AS season,
  pp.baseline_units,
  pp.actual_units,
  pp.incremental_units,
  pp.modeled_uplift_rate,
  pp.actual_revenue,
  pp.trade_spend,
  pp.incremental_margin,
  pp.promotion_roi,
  pp.lost_sales_units,
  pp.revenue_at_risk,
  CASE WHEN pp.lost_sales_units = 0 THEN 'AVAILABLE' ELSE 'LOST_SALES_RECORDED' END AS availability_outcome,
  CASE
    WHEN pp.incremental_margin > 0 AND pp.promotion_roi > 0 AND pp.lost_sales_units = 0
      THEN 'SUCCESSFUL_AND_AVAILABLE'
    WHEN pp.incremental_margin > 0 AND pp.promotion_roi > 0
      THEN 'COMMERCIALLY_SUCCESSFUL_SUPPLY_CONSTRAINED'
    WHEN pp.incremental_units > 0 AND pp.incremental_margin <= 0
      THEN 'VOLUME_GAIN_MARGIN_FAILURE'
    ELSE 'UNDERPERFORMING'
  END AS success_classification,
  'Modeled observational comparison to non-promoted SKU-cluster history; not a causal treatment effect.'
    AS measurement_assumption
FROM promoflow.promoflow_gold.promotion_performance pp
JOIN promoflow.promoflow_silver.products pr ON pp.sku_id = pr.sku_id;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.cpg_event_calendar
CLUSTER BY (event_start_date, category_affinity)
COMMENT 'Governed factual commercial-event calendar sourced from the synthetic Cleany TPM feed. It contains no authored uplift estimate or recommendation rationale.'
AS
SELECT
  concat(event_id, '-', upper(replace(category_affinity, ' ', '_'))) AS event_category_id,
  event_id,
  event_name,
  calendar_as_of_date AS demo_as_of_date,
  event_start_date,
  event_end_date,
  category_affinity,
  lead_time_days,
  event_type,
  market_code,
  retailer_scope,
  planning_status,
  source_published_at,
  source_updated_at,
  source_system,
  source_file_path
FROM promoflow.promoflow_silver.cpg_event_calendar;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.planner_opportunities
CLUSTER BY (event_start_date, category, cluster_id)
COMMENT 'Diversified event-aligned opportunities. Expected economics use daily SKU-cluster model scores scaled to the recommended campaign duration; historical results remain separately labeled evidence, not causal claims.'
AS
WITH winner_evidence AS (
  SELECT
    e.event_category_id,
    e.event_id,
    e.event_name,
    e.event_start_date,
    e.event_end_date,
    e.category_affinity AS category,
    e.lead_time_days,
    e.event_type,
    e.market_code,
    e.retailer_scope,
    x.promotion_id AS evidence_promotion_id,
    x.sku_id,
    x.product_name,
    x.cluster_id,
    x.cluster_name,
    x.mechanic,
    x.discount_pct,
    x.incremental_margin AS historical_incremental_margin,
    x.promotion_roi AS historical_promotion_roi,
    x.modeled_uplift_rate AS historical_modeled_uplift_rate,
    COUNT(*) OVER (
      PARTITION BY e.event_category_id, x.sku_id, x.cluster_id, x.mechanic
    ) AS evidence_count,
    ROW_NUMBER() OVER (
      PARTITION BY e.event_category_id, x.cluster_id, x.sku_id
      ORDER BY x.incremental_margin DESC, x.promotion_roi DESC, x.promotion_id
    ) AS sku_evidence_rank
  FROM promoflow.promoflow_gold.cpg_event_calendar e
  JOIN promoflow.promoflow_gold.promotion_explorer x
    ON e.category_affinity = x.category
  WHERE x.incremental_margin > 0 AND x.promotion_roi > 0
), best_per_sku AS (
  SELECT * FROM winner_evidence WHERE sku_evidence_rank = 1
), diversified AS (
  SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY event_category_id, cluster_id
           ORDER BY historical_incremental_margin DESC, historical_promotion_roi DESC, sku_id
         ) AS opportunity_rank
  FROM best_per_sku
), selected AS (
  SELECT * FROM diversified WHERE opportunity_rank <= 3
), canonical_inputs AS (
  SELECT
    s.*,
    pr.list_price,
    pr.standard_cost,
    datediff(s.event_end_date, s.event_start_date) + 1 AS recommended_duration_days,
    pred.predicted_baseline_units AS predicted_daily_baseline_units,
    pred.predicted_promotion_units AS predicted_daily_promotion_units,
    pred.modeled_uplift_units AS predicted_daily_uplift_units,
    pred.modeled_uplift_pct,
    pred.promotion_id AS prediction_available,
    pred.model_name,
    pred.model_version,
    pred.mlflow_run_id
  FROM selected s
  JOIN promoflow.promoflow_silver.products pr ON s.sku_id = pr.sku_id
  LEFT JOIN promoflow.promoflow_gold.promotion_demand_predictions pred
    ON s.evidence_promotion_id = pred.promotion_id
), canonical_economics AS (
  SELECT
    c.*,
    c.predicted_daily_baseline_units * c.recommended_duration_days AS expected_baseline_units,
    c.predicted_daily_promotion_units * c.recommended_duration_days AS expected_promotion_units,
    c.predicted_daily_uplift_units * c.recommended_duration_days AS expected_modeled_uplift_units,
    c.list_price * (1 - c.discount_pct) AS expected_selling_price,
    c.predicted_daily_promotion_units * c.recommended_duration_days
      * c.list_price * c.discount_pct AS expected_trade_spend,
    c.predicted_daily_promotion_units * c.recommended_duration_days
      * (c.list_price * (1 - c.discount_pct) - c.standard_cost)
      - c.predicted_daily_baseline_units * c.recommended_duration_days
      * (c.list_price - c.standard_cost) AS expected_incremental_margin
  FROM canonical_inputs c
), classified AS (
  SELECT
    e.*,
    e.expected_incremental_margin / NULLIF(e.expected_trade_spend, 0) AS expected_promotion_roi,
    CASE
      WHEN e.prediction_available IS NULL OR e.list_price IS NULL OR e.standard_cost IS NULL
        OR e.recommended_duration_days <= 0 OR e.expected_trade_spend IS NULL
        THEN 'INSUFFICIENT_ECONOMIC_INPUTS'
      WHEN e.expected_incremental_margin > 0
        AND e.expected_incremental_margin / NULLIF(e.expected_trade_spend, 0) > 0
        THEN 'RECOMMEND'
      ELSE 'REVIEW_ECONOMICS'
    END AS economics_status
  FROM canonical_economics e
)
SELECT
  concat(s.event_category_id, '-', s.sku_id, '-', s.cluster_id)
    AS opportunity_id,
  s.event_category_id,
  s.event_id,
  s.event_name,
  s.event_start_date,
  s.event_end_date,
  s.event_start_date AS recommended_start_date,
  s.event_end_date AS recommended_end_date,
  s.recommended_duration_days,
  s.category,
  s.sku_id AS recommended_sku_id,
  s.product_name AS recommended_product_name,
  s.cluster_id,
  s.cluster_name,
  s.mechanic AS recommended_mechanic,
  s.discount_pct AS recommended_discount_pct,
  s.list_price,
  s.standard_cost,
  CAST(s.expected_selling_price AS DECIMAL(10,2)) AS expected_selling_price,
  'DAILY_SKU_CLUSTER' AS prediction_granularity,
  CAST(s.predicted_daily_baseline_units AS DOUBLE) AS predicted_daily_baseline_units,
  CAST(s.predicted_daily_promotion_units AS DOUBLE) AS predicted_daily_promotion_units,
  CAST(s.expected_baseline_units AS DOUBLE) AS expected_baseline_units,
  CAST(s.expected_promotion_units AS DOUBLE) AS expected_promotion_units,
  CAST(s.expected_modeled_uplift_units AS DOUBLE) AS expected_modeled_uplift_units,
  COALESCE(s.modeled_uplift_pct, s.historical_modeled_uplift_rate) AS expected_modeled_uplift_pct,
  CAST(s.expected_trade_spend AS DECIMAL(18,2)) AS expected_trade_spend,
  CAST(s.expected_incremental_margin AS DECIMAL(18,2)) AS expected_incremental_margin,
  CAST(s.expected_promotion_roi AS DECIMAL(12,4)) AS expected_promotion_roi,
  s.economics_status,
  'daily-model-score x recommended-duration; margin = promoted units x (discounted price - cost) - baseline units x (list price - cost)'
    AS economics_method,
  'planner-opportunity-economics-v2' AS calculation_version,
  s.historical_incremental_margin AS historical_incremental_margin_evidence,
  s.historical_promotion_roi AS historical_roi_evidence,
  s.evidence_count,
  CASE
    WHEN s.evidence_count >= 3 AND s.prediction_available IS NOT NULL THEN 'HIGH'
    WHEN s.prediction_available IS NOT NULL THEN 'MEDIUM'
    ELSE 'LOW'
  END AS confidence_band,
  s.lead_time_days,
  s.event_type,
  s.market_code,
  s.retailer_scope,
  concat(
    s.event_name, ' is an approved ', lower(replace(s.event_type, '_', ' ')),
    ' opportunity for ', s.category, '. This candidate reuses a positive-margin historical ',
    s.mechanic, ' configuration for ', s.product_name, ' in ', s.cluster_name,
    '; forward economics use governed price, cost, and daily model scores over the event duration.'
  ) AS recommendation_rationale,
  'Expected uplift is model-based and historical evidence is observational; neither is a causal treatment-effect claim.'
    AS modeling_disclaimer,
  s.evidence_promotion_id,
  s.opportunity_rank AS diversified_rank,
  s.model_name,
  s.model_version,
  s.mlflow_run_id
FROM classified s;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.promotion_feasibility
CLUSTER BY (event_start_date, sku_id, cluster_id)
COMMENT 'Forward promotion availability check. It compares governed event-horizon inventory and planned receipts with baseline commitments, safety stock, and model-scored incremental promotion demand. It contains facts and readiness status only; it does not prescribe supply actions.'
AS
WITH inputs AS (
  SELECT
    o.opportunity_id,
    o.event_id,
    o.event_name,
    o.event_start_date,
    o.event_end_date,
    o.recommended_sku_id AS sku_id,
    o.recommended_product_name AS product_name,
    o.cluster_id,
    o.cluster_name,
    sp.plan_as_of_date,
    sp.source_updated_at,
    sp.source_system,
    sp.source_file_path,
    sp.supply_plan_horizon_start,
    sp.supply_plan_horizon_end,
    sp.projected_opening_inventory_units,
    sp.planned_receipt_units,
    sp.safety_stock_units,
    sp.committed_baseline_units,
    sp.ibp_incremental_demand_plan_units,
    o.expected_modeled_uplift_units AS incremental_promotion_demand_units,
    o.expected_promotion_units,
    o.model_name,
    o.model_version,
    o.mlflow_run_id
  FROM promoflow.promoflow_gold.planner_opportunities o
  LEFT JOIN promoflow.promoflow_silver.forward_supply_plan sp
    ON o.event_id = sp.event_id
   AND o.recommended_sku_id = sp.sku_id
   AND o.cluster_id = sp.cluster_id
   AND o.event_start_date = sp.event_start_date
   AND o.event_end_date = sp.event_end_date
), calculated AS (
  SELECT
    *,
    GREATEST(
      COALESCE(projected_opening_inventory_units, 0) + COALESCE(planned_receipt_units, 0)
        - COALESCE(safety_stock_units, 0)
        - COALESCE(committed_baseline_units, 0),
      0
    ) AS available_for_incremental_promotion_units
  FROM inputs
), measured AS (
  SELECT
    *,
    available_for_incremental_promotion_units
      / NULLIF(incremental_promotion_demand_units, 0) AS promotion_demand_coverage_ratio,
    GREATEST(
      COALESCE(incremental_promotion_demand_units, 0)
        - available_for_incremental_promotion_units,
      0
    ) AS projected_shortfall_units
  FROM calculated
)
SELECT
  opportunity_id AS promotion_feasibility_id,
  opportunity_id,
  event_id,
  event_name,
  event_start_date,
  event_end_date,
  sku_id,
  product_name,
  cluster_id,
  cluster_name,
  plan_as_of_date,
  source_updated_at,
  source_system,
  source_file_path,
  supply_plan_horizon_start,
  supply_plan_horizon_end,
  datediff(event_start_date, plan_as_of_date) AS planning_horizon_days,
  CAST(projected_opening_inventory_units AS BIGINT) AS projected_opening_inventory_units,
  CAST(planned_receipt_units AS BIGINT) AS planned_receipt_units,
  CAST(safety_stock_units AS BIGINT) AS safety_stock_units,
  CAST(committed_baseline_units AS DOUBLE) AS committed_baseline_units,
  CAST(ibp_incremental_demand_plan_units AS DOUBLE) AS ibp_incremental_demand_plan_units,
  CAST(incremental_promotion_demand_units AS DOUBLE) AS incremental_promotion_demand_units,
  CAST(expected_promotion_units AS DOUBLE) AS expected_promotion_units,
  CAST(available_for_incremental_promotion_units AS DOUBLE)
    AS available_for_incremental_promotion_units,
  CAST(promotion_demand_coverage_ratio AS DECIMAL(10,4)) AS promotion_demand_coverage_ratio,
  CAST(projected_shortfall_units AS DOUBLE) AS projected_shortfall_units,
  CASE
    WHEN plan_as_of_date IS NULL OR incremental_promotion_demand_units IS NULL
      OR incremental_promotion_demand_units <= 0 THEN 'REVIEW'
    WHEN promotion_demand_coverage_ratio < 0.90 THEN 'CONSTRAINED'
    WHEN promotion_demand_coverage_ratio < 1.10 THEN 'REVIEW'
    ELSE 'READY'
  END AS readiness_status,
  CASE
    WHEN plan_as_of_date IS NULL THEN 'MISSING_FORWARD_SUPPLY_PLAN'
    WHEN incremental_promotion_demand_units IS NULL OR incremental_promotion_demand_units <= 0
      THEN 'MISSING_OR_NONPOSITIVE_DEMAND_ESTIMATE'
    WHEN promotion_demand_coverage_ratio < 0.90 THEN 'PROJECTED_COVERAGE_BELOW_90_PERCENT'
    WHEN promotion_demand_coverage_ratio < 1.10 THEN 'PROJECTED_COVERAGE_BETWEEN_90_AND_110_PERCENT'
    ELSE 'PROJECTED_COVERAGE_AT_OR_ABOVE_110_PERCENT'
  END AS readiness_reason,
  'available incremental units = projected opening inventory + planned receipts - safety stock - committed baseline demand; coverage = available incremental units / model-scored incremental promotion demand'
    AS feasibility_method,
  'promotion-feasibility-v2' AS calculation_version,
  model_name,
  model_version,
  mlflow_run_id
FROM measured;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.planned_promotions
CLUSTER BY (start_date, plan_status, readiness_status)
COMMENT 'Governed future promotion plans imported from Cleany TPM with derived supply readiness. Source plans contain no authored risk labels or supply actions.'
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')
AS
WITH joined AS (
  SELECT p.*, pr.product_name, pr.list_price, pr.standard_cost, c.cluster_name,
         sp.projected_opening_inventory_units, sp.planned_receipt_units,
         sp.committed_baseline_units, sp.safety_stock_units,
         sp.plan_as_of_date AS supply_plan_as_of_date,
         sp.source_updated_at AS supply_source_updated_at,
         GREATEST(COALESCE(sp.projected_opening_inventory_units, 0)
           + COALESCE(sp.planned_receipt_units, 0)
           - COALESCE(sp.committed_baseline_units, 0)
           - COALESCE(sp.safety_stock_units, 0), 0) AS available_incremental_units
  FROM promoflow.promoflow_silver.imported_promotion_plans p
  JOIN promoflow.promoflow_silver.products pr ON p.sku_id = pr.sku_id
  JOIN promoflow.promoflow_silver.store_clusters c ON p.cluster_id = c.cluster_id
  LEFT JOIN promoflow.promoflow_silver.forward_supply_plan sp
    ON p.event_id = sp.event_id AND p.sku_id = sp.sku_id AND p.cluster_id = sp.cluster_id
   AND p.start_date = sp.event_start_date AND p.end_date = sp.event_end_date
)
SELECT plan_id, event_id, event_name, category, start_date, end_date,
       sku_id, product_name, cluster_id, cluster_name, mechanic, discount_pct,
       planned_incremental_units, plan_status, plan_as_of_date, created_at,
       list_price, standard_cost,
       projected_opening_inventory_units, planned_receipt_units,
       committed_baseline_units, safety_stock_units,
       CAST(available_incremental_units AS BIGINT) AS available_incremental_units,
       CAST(available_incremental_units / NULLIF(planned_incremental_units, 0) AS DECIMAL(10,4)) AS availability_coverage_ratio,
       GREATEST(planned_incremental_units - available_incremental_units, 0) AS projected_shortfall_units,
       CASE
         WHEN supply_plan_as_of_date IS NULL THEN 'REVIEW'
         WHEN available_incremental_units / NULLIF(planned_incremental_units, 0) < 0.90 THEN 'CONSTRAINED'
         WHEN available_incremental_units / NULLIF(planned_incremental_units, 0) < 1.10 THEN 'REVIEW'
         ELSE 'READY'
       END AS readiness_status,
       CASE
         WHEN supply_plan_as_of_date IS NULL THEN 'NO_FORWARD_SUPPLY_PLAN'
         WHEN planned_receipt_units = 0 AND available_incremental_units < planned_incremental_units THEN 'NO_PLANNED_RECEIPT_AND_INVENTORY_SHORTFALL'
         WHEN available_incremental_units / NULLIF(planned_incremental_units, 0) < 0.90 THEN 'PROJECTED_INVENTORY_SHORTFALL'
         WHEN available_incremental_units / NULLIF(planned_incremental_units, 0) < 1.10 THEN 'LIMITED_AVAILABILITY_BUFFER'
         ELSE 'SUPPLY_POSITION_READY'
       END AS risk_reason,
       supply_plan_as_of_date, supply_source_updated_at,
       source_system, source_file_path
FROM joined;
