-- PromoFlow Silver: typed, quality-controlled business data and explicit quarantine.

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_silver.pos_sales (
  CONSTRAINT sales_business_key_present EXPECT (sales_record_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT sales_dimensions_present EXPECT (store_id IS NOT NULL AND sku_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT sales_units_nonnegative EXPECT (units_sold >= 0) ON VIOLATION DROP ROW,
  CONSTRAINT sales_price_nonnegative EXPECT (unit_price >= 0 AND gross_revenue >= 0) ON VIOLATION DROP ROW,
  CONSTRAINT sales_payload_parseable EXPECT (_rescued_data IS NULL) ON VIOLATION DROP ROW
)
CLUSTER BY (date, sku_id)
COMMENT 'Validated point-of-sale facts. Invalid rows are retained in pos_sales_quarantine.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT sales_record_id, CAST(date AS DATE) AS date, source_month, source_batch_id,
       store_id, sku_id, promotion_id, CAST(units_sold AS INT) AS units_sold,
       CAST(unit_price AS DECIMAL(10,2)) AS unit_price,
       CAST(gross_revenue AS DECIMAL(14,2)) AS gross_revenue,
       CAST(lost_sales_units AS INT) AS lost_sales_units,
       source_file_path, ingested_at, _rescued_data
FROM STREAM(promoflow.promoflow_bronze.pos_sales);

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_silver.pos_sales_quarantine
COMMENT 'Rejected POS rows with deterministic rejection reasons for remediation and reconciliation.'
AS
SELECT *,
       concat_ws(',',
         CASE WHEN sales_record_id IS NULL THEN 'MISSING_SALES_RECORD_ID' END,
         CASE WHEN store_id IS NULL OR sku_id IS NULL THEN 'MISSING_DIMENSION_KEY' END,
         CASE WHEN units_sold IS NULL THEN 'MISSING_UNITS' WHEN units_sold < 0 THEN 'NEGATIVE_UNITS' END,
         CASE WHEN unit_price IS NULL OR gross_revenue IS NULL THEN 'MISSING_AMOUNT'
              WHEN unit_price < 0 OR gross_revenue < 0 THEN 'NEGATIVE_AMOUNT' END,
         CASE WHEN _rescued_data IS NOT NULL THEN 'UNPARSEABLE_PAYLOAD' END
       ) AS rejection_reason,
       current_timestamp() AS quarantined_at
FROM STREAM(promoflow.promoflow_bronze.pos_sales)
WHERE sales_record_id IS NULL OR store_id IS NULL OR sku_id IS NULL
   OR units_sold IS NULL OR units_sold < 0
   OR unit_price IS NULL OR gross_revenue IS NULL OR unit_price < 0 OR gross_revenue < 0
   OR _rescued_data IS NOT NULL;

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_silver.inventory_snapshots (
  CONSTRAINT inventory_business_key_present EXPECT (inventory_record_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT inventory_dimensions_present EXPECT (store_id IS NOT NULL AND sku_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT inventory_on_hand_nonnegative EXPECT (on_hand_units >= 0) ON VIOLATION DROP ROW,
  CONSTRAINT inventory_quantities_nonnegative EXPECT (safety_stock_units >= 0 AND inbound_units >= 0) ON VIOLATION DROP ROW,
  CONSTRAINT inventory_payload_parseable EXPECT (_rescued_data IS NULL) ON VIOLATION DROP ROW
)
CLUSTER BY (date, sku_id)
COMMENT 'Validated daily inventory facts. Invalid rows are retained in inventory_snapshots_quarantine.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT inventory_record_id, CAST(date AS DATE) AS date, source_month, source_batch_id,
       store_id, sku_id, CAST(on_hand_units AS INT) AS on_hand_units,
       CAST(safety_stock_units AS INT) AS safety_stock_units,
       CAST(inbound_units AS INT) AS inbound_units,
       CAST(stockout_risk_flag AS BOOLEAN) AS stockout_risk_flag,
       source_file_path, ingested_at, _rescued_data
FROM STREAM(promoflow.promoflow_bronze.inventory_snapshots);

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_silver.inventory_snapshots_quarantine
COMMENT 'Rejected inventory rows with deterministic rejection reasons for remediation and reconciliation.'
AS
SELECT *,
       concat_ws(',',
         CASE WHEN inventory_record_id IS NULL THEN 'MISSING_INVENTORY_RECORD_ID' END,
         CASE WHEN store_id IS NULL OR sku_id IS NULL THEN 'MISSING_DIMENSION_KEY' END,
         CASE WHEN on_hand_units IS NULL THEN 'MISSING_ON_HAND'
              WHEN on_hand_units < 0 THEN 'NEGATIVE_ON_HAND' END,
         CASE WHEN safety_stock_units IS NULL OR inbound_units IS NULL THEN 'MISSING_INVENTORY_QUANTITY'
              WHEN safety_stock_units < 0 OR inbound_units < 0 THEN 'NEGATIVE_INVENTORY_QUANTITY' END,
         CASE WHEN _rescued_data IS NOT NULL THEN 'UNPARSEABLE_PAYLOAD' END
       ) AS rejection_reason,
       current_timestamp() AS quarantined_at
FROM STREAM(promoflow.promoflow_bronze.inventory_snapshots)
WHERE inventory_record_id IS NULL OR store_id IS NULL OR sku_id IS NULL
   OR on_hand_units IS NULL OR on_hand_units < 0
   OR safety_stock_units IS NULL OR inbound_units IS NULL
   OR safety_stock_units < 0 OR inbound_units < 0
   OR _rescued_data IS NOT NULL;

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_silver.promotions (
  CONSTRAINT promotion_key_present EXPECT (promotion_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT promotion_dates_valid EXPECT (start_date <= end_date) ON VIOLATION DROP ROW,
  CONSTRAINT promotion_discount_valid EXPECT (discount_pct BETWEEN 0 AND 0.80) ON VIOLATION DROP ROW,
  CONSTRAINT promotion_dimensions_present EXPECT (sku_id IS NOT NULL AND cluster_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT promotion_payload_parseable EXPECT (_rescued_data IS NULL) ON VIOLATION DROP ROW
)
CLUSTER BY (start_date, sku_id)
COMMENT 'Validated promotion campaigns; generator-only outcome labels are intentionally excluded.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT promotion_id, sku_id, cluster_id, CAST(start_date AS DATE) AS start_date,
       CAST(end_date AS DATE) AS end_date, CAST(discount_pct AS DECIMAL(6,4)) AS discount_pct,
       mechanic, incident_code, source_month, source_file_path, ingested_at, _rescued_data
FROM STREAM(promoflow.promoflow_bronze.promotions);

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_silver.shipments (
  CONSTRAINT shipment_key_present EXPECT (shipment_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT shipment_dimensions_present EXPECT (dc_id IS NOT NULL AND store_id IS NOT NULL AND sku_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT shipment_quantity_positive EXPECT (quantity_units > 0) ON VIOLATION DROP ROW,
  CONSTRAINT shipment_dates_valid EXPECT (order_date <= planned_delivery_date AND planned_delivery_date <= actual_delivery_date) ON VIOLATION DROP ROW,
  CONSTRAINT shipment_payload_parseable EXPECT (_rescued_data IS NULL) ON VIOLATION DROP ROW
)
CLUSTER BY (planned_delivery_date, sku_id)
COMMENT 'Validated distribution shipment facts used to assess inbound supply and delay risk.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT shipment_id, source_month, source_batch_id, dc_id, store_id, sku_id,
       CAST(order_date AS DATE) AS order_date,
       CAST(planned_delivery_date AS DATE) AS planned_delivery_date,
       CAST(actual_delivery_date AS DATE) AS actual_delivery_date,
       CAST(quantity_units AS INT) AS quantity_units, CAST(delay_days AS INT) AS delay_days,
       shipment_status, source_file_path, ingested_at, _rescued_data
FROM STREAM(promoflow.promoflow_bronze.shipments);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.products
COMMENT 'Curated product dimension with commercial attributes.'
AS SELECT sku_id, product_name, category, CAST(list_price AS DECIMAL(10,2)) AS list_price,
          CAST(standard_cost AS DECIMAL(10,2)) AS standard_cost,
          CAST(shelf_units_per_case AS INT) AS shelf_units_per_case
FROM promoflow.promoflow_bronze.products
WHERE sku_id IS NOT NULL AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.store_clusters
COMMENT 'Curated store-cluster dimension for commercial and supply analysis.'
AS SELECT cluster_id, cluster_name, CAST(income_index AS DECIMAL(8,4)) AS income_index,
          CAST(price_elasticity AS DECIMAL(8,4)) AS price_elasticity
FROM promoflow.promoflow_bronze.store_clusters
WHERE cluster_id IS NOT NULL AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.stores
COMMENT 'Curated store dimension with cluster and serving-DC assignment.'
AS
SELECT s.store_id, s.store_name, c.cluster_id,
       CASE WHEN CAST(s.serving_dc_idx AS INT) = 0 THEN 'DC-01' ELSE 'DC-02' END AS serving_dc_id,
       s.store_format, CAST(s.store_demand_index AS DECIMAL(8,4)) AS store_demand_index
FROM promoflow.promoflow_bronze.stores s
JOIN promoflow.promoflow_bronze.store_clusters c
  ON CAST(s.cluster_idx AS INT) = CAST(c.cluster_idx AS INT)
WHERE s.store_id IS NOT NULL AND s._rescued_data IS NULL AND c._rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.distribution_centers
COMMENT 'Curated Cleany distribution-center dimension.'
AS SELECT dc_id, dc_name, location, CAST(standard_lead_time_days AS INT) AS standard_lead_time_days
FROM promoflow.promoflow_bronze.distribution_centers
WHERE dc_id IS NOT NULL AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.product_costs
COMMENT 'Curated effective-dated product costs.'
AS SELECT cost_id, sku_id, CAST(effective_from AS DATE) AS effective_from,
          CAST(unit_cost AS DECIMAL(10,2)) AS unit_cost
FROM promoflow.promoflow_bronze.product_costs
WHERE cost_id IS NOT NULL AND sku_id IS NOT NULL AND unit_cost >= 0 AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.cpg_event_calendar
COMMENT 'Validated factual event-category calendar from the synthetic Cleany TPM source feed; no uplift or recommendation fields are supplied by the source.'
AS
SELECT event_id, event_name, CAST(calendar_as_of_date AS DATE) AS calendar_as_of_date,
       CAST(event_start_date AS DATE) AS event_start_date,
       CAST(event_end_date AS DATE) AS event_end_date,
       category_affinity, CAST(lead_time_days AS INT) AS lead_time_days,
       event_type, market_code, retailer_scope, planning_status,
       CAST(source_published_at AS TIMESTAMP) AS source_published_at,
       CAST(source_updated_at AS TIMESTAMP) AS source_updated_at,
       source_system, source_file_path
FROM promoflow.promoflow_bronze.cpg_event_calendar
WHERE event_id IS NOT NULL
  AND event_name IS NOT NULL
  AND category_affinity IS NOT NULL
  AND CAST(event_start_date AS DATE) >= CAST(calendar_as_of_date AS DATE)
  AND CAST(event_end_date AS DATE) >= CAST(event_start_date AS DATE)
  AND CAST(lead_time_days AS INT) > 0
  AND event_type IS NOT NULL
  AND market_code IS NOT NULL
  AND planning_status = 'APPROVED'
  AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.forward_supply_plan
COMMENT 'Validated forward ERP/IBP supply-plan facts at event, SKU, and store-cluster grain. Quantities are source inputs; readiness is calculated downstream.'
AS
SELECT
  supply_plan_id,
  event_id,
  CAST(event_start_date AS DATE) AS event_start_date,
  CAST(event_end_date AS DATE) AS event_end_date,
  sku_id,
  cluster_id,
  CAST(plan_as_of_date AS DATE) AS plan_as_of_date,
  CAST(projected_opening_inventory_units AS BIGINT) AS projected_opening_inventory_units,
  CAST(planned_receipt_units AS BIGINT) AS planned_receipt_units,
  CAST(committed_baseline_units AS BIGINT) AS committed_baseline_units,
  CAST(safety_stock_units AS BIGINT) AS safety_stock_units,
  CAST(ibp_incremental_demand_plan_units AS BIGINT) AS ibp_incremental_demand_plan_units,
  CAST(supply_plan_horizon_start AS DATE) AS supply_plan_horizon_start,
  CAST(supply_plan_horizon_end AS DATE) AS supply_plan_horizon_end,
  CAST(source_updated_at AS TIMESTAMP) AS source_updated_at,
  source_system,
  source_file_path
FROM promoflow.promoflow_bronze.forward_supply_plan
WHERE supply_plan_id IS NOT NULL
  AND event_id IS NOT NULL
  AND sku_id IS NOT NULL
  AND cluster_id IS NOT NULL
  AND CAST(event_start_date AS DATE) >= CAST(plan_as_of_date AS DATE)
  AND CAST(event_end_date AS DATE) >= CAST(event_start_date AS DATE)
  AND CAST(supply_plan_horizon_end AS DATE) >= CAST(supply_plan_horizon_start AS DATE)
  AND CAST(projected_opening_inventory_units AS BIGINT) >= 0
  AND CAST(planned_receipt_units AS BIGINT) >= 0
  AND CAST(committed_baseline_units AS BIGINT) >= 0
  AND CAST(safety_stock_units AS BIGINT) >= 0
  AND CAST(ibp_incremental_demand_plan_units AS BIGINT) >= 0
  AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.imported_promotion_plans
COMMENT 'Validated future promotion commitments from the external Cleany TPM planning system.'
AS
SELECT plan_id, event_id, event_name, category,
       CAST(start_date AS DATE) AS start_date, CAST(end_date AS DATE) AS end_date,
       sku_id, cluster_id, mechanic, CAST(discount_pct AS DECIMAL(6,4)) AS discount_pct,
       CAST(planned_incremental_units AS BIGINT) AS planned_incremental_units,
       plan_status, CAST(plan_as_of_date AS DATE) AS plan_as_of_date,
       CAST(created_at AS TIMESTAMP) AS created_at,
       CAST(source_updated_at AS TIMESTAMP) AS source_updated_at,
       source_system, source_file_path
FROM promoflow.promoflow_bronze.imported_promotion_plans
WHERE plan_id IS NOT NULL AND event_id IS NOT NULL AND sku_id IS NOT NULL AND cluster_id IS NOT NULL
  AND CAST(start_date AS DATE) >= CAST(plan_as_of_date AS DATE)
  AND CAST(end_date AS DATE) >= CAST(start_date AS DATE)
  AND CAST(planned_incremental_units AS BIGINT) > 0
  AND plan_status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
  AND _rescued_data IS NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.sales_reconciliation
COMMENT 'POS quality reconciliation proving Bronze equals valid Silver plus quarantined rows.'
AS
SELECT b.raw_rows, s.valid_rows, q.quarantined_rows,
       b.raw_rows - s.valid_rows - q.quarantined_rows AS unreconciled_rows
FROM (SELECT COUNT(*) AS raw_rows FROM promoflow.promoflow_bronze.pos_sales) b
CROSS JOIN (SELECT COUNT(*) AS valid_rows FROM promoflow.promoflow_silver.pos_sales) s
CROSS JOIN (SELECT COUNT(*) AS quarantined_rows FROM promoflow.promoflow_silver.pos_sales_quarantine) q;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.inventory_reconciliation
COMMENT 'Inventory quality reconciliation proving Bronze equals valid Silver plus quarantined rows.'
AS
SELECT b.raw_rows, i.valid_rows, q.quarantined_rows,
       b.raw_rows - i.valid_rows - q.quarantined_rows AS unreconciled_rows
FROM (SELECT COUNT(*) AS raw_rows FROM promoflow.promoflow_bronze.inventory_snapshots) b
CROSS JOIN (SELECT COUNT(*) AS valid_rows FROM promoflow.promoflow_silver.inventory_snapshots) i
CROSS JOIN (SELECT COUNT(*) AS quarantined_rows FROM promoflow.promoflow_silver.inventory_snapshots_quarantine) q;
