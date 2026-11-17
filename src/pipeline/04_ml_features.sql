-- PromoFlow ML contract: leakage-safe daily demand observations and scenario candidates.
-- Synthetic truth is intentionally neither read nor joined anywhere in this file.

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.promotion_training_features
CLUSTER BY (observation_date, sku_id, cluster_id)
COMMENT 'Daily SKU-cluster demand features. Every lag and rolling feature uses only observations strictly before observation_date.'
AS
WITH daily_demand AS (
  SELECT
    s.date AS observation_date,
    s.sku_id,
    st.cluster_id,
    SUM(s.units_sold) AS units_sold,
    COALESCE(MAX(p.discount_pct), CAST(0 AS DECIMAL(6,4))) AS discount_pct,
    COALESCE(MAX(p.mechanic), 'NONE') AS promotion_mechanic,
    MAX(CASE WHEN p.mechanic IN ('DISPLAY', 'FEATURE_DISPLAY') THEN 1 ELSE 0 END) AS display_flag,
    MAX(CASE WHEN p.mechanic = 'FEATURE_DISPLAY' THEN 1 ELSE 0 END) AS feature_flag,
    AVG(s.unit_price) AS selling_price,
    AVG(st.store_demand_index) AS store_demand_index
  FROM promoflow.promoflow_silver.pos_sales s
  JOIN promoflow.promoflow_silver.stores st ON s.store_id = st.store_id
  LEFT JOIN promoflow.promoflow_silver.promotions p ON s.promotion_id = p.promotion_id
  GROUP BY s.date, s.sku_id, st.cluster_id
), lagged AS (
  SELECT
    d.*,
    LAG(d.units_sold, 7) OVER (
      PARTITION BY d.sku_id, d.cluster_id ORDER BY d.observation_date
    ) AS lag_7_units,
    LAG(d.units_sold, 14) OVER (
      PARTITION BY d.sku_id, d.cluster_id ORDER BY d.observation_date
    ) AS lag_14_units,
    AVG(CAST(d.units_sold AS DECIMAL(18,4))) OVER (
      PARTITION BY d.sku_id, d.cluster_id
      ORDER BY d.observation_date
      ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING
    ) AS rolling_28_avg_units
  FROM daily_demand d
)
SELECT
  l.observation_date,
  CAST(l.units_sold AS DOUBLE) AS units_sold,
  l.sku_id,
  l.cluster_id,
  l.promotion_mechanic,
  pr.category,
  CAST(dayofweek(l.observation_date) AS STRING) AS day_of_week,
  CAST(l.discount_pct AS DOUBLE) AS discount_pct,
  CAST(l.display_flag AS DOUBLE) AS display_flag,
  CAST(l.feature_flag AS DOUBLE) AS feature_flag,
  CAST(pr.list_price AS DOUBLE) AS list_price,
  CAST(l.selling_price AS DOUBLE) AS selling_price,
  CAST(pr.standard_cost AS DOUBLE) AS standard_cost,
  CAST(month(l.observation_date) AS DOUBLE) AS month,
  CAST(weekofyear(l.observation_date) AS DOUBLE) AS week_of_year,
  CAST(CASE
    WHEN month(l.observation_date) = 11 AND dayofmonth(l.observation_date) BETWEEN 20 AND 30 THEN 1
    WHEN month(l.observation_date) = 12 AND dayofmonth(l.observation_date) BETWEEN 15 AND 26 THEN 1
    ELSE 0
  END AS DOUBLE) AS holiday_flag,
  CAST(l.lag_7_units AS DOUBLE) AS lag_7_units,
  CAST(l.lag_14_units AS DOUBLE) AS lag_14_units,
  CAST(l.rolling_28_avg_units AS DOUBLE) AS rolling_28_avg_units,
  CAST(l.store_demand_index AS DOUBLE) AS store_demand_index,
  CAST(sc.price_elasticity AS DOUBLE) AS price_elasticity
FROM lagged l
JOIN promoflow.promoflow_silver.products pr ON l.sku_id = pr.sku_id
JOIN promoflow.promoflow_silver.store_clusters sc ON l.cluster_id = sc.cluster_id
WHERE l.rolling_28_avg_units IS NOT NULL;

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_silver.promotion_candidates
CLUSTER BY (observation_date, sku_id, cluster_id)
COMMENT 'Historical promotion configurations prepared for reproducible scenario scoring; the units_sold label is deliberately excluded.'
AS
SELECT
  concat('HIST-', p.promotion_id) AS scenario_id,
  p.promotion_id,
  p.start_date AS observation_date,
  p.start_date,
  p.end_date,
  p.sku_id,
  p.cluster_id,
  p.mechanic AS promotion_mechanic,
  f.category,
  CAST(dayofweek(p.start_date) AS STRING) AS day_of_week,
  CAST(p.discount_pct AS DOUBLE) AS discount_pct,
  CAST(CASE WHEN p.mechanic IN ('DISPLAY', 'FEATURE_DISPLAY') THEN 1 ELSE 0 END AS DOUBLE) AS display_flag,
  CAST(CASE WHEN p.mechanic = 'FEATURE_DISPLAY' THEN 1 ELSE 0 END AS DOUBLE) AS feature_flag,
  f.list_price,
  CAST(f.list_price * (1 - CAST(p.discount_pct AS DOUBLE)) AS DOUBLE) AS selling_price,
  f.standard_cost,
  CAST(month(p.start_date) AS DOUBLE) AS month,
  CAST(weekofyear(p.start_date) AS DOUBLE) AS week_of_year,
  CAST(CASE
    WHEN month(p.start_date) = 11 AND dayofmonth(p.start_date) BETWEEN 20 AND 30 THEN 1
    WHEN month(p.start_date) = 12 AND dayofmonth(p.start_date) BETWEEN 15 AND 26 THEN 1
    ELSE 0
  END AS DOUBLE) AS holiday_flag,
  f.lag_7_units,
  f.lag_14_units,
  f.rolling_28_avg_units,
  f.store_demand_index,
  f.price_elasticity
FROM promoflow.promoflow_silver.promotions p
JOIN promoflow.promoflow_silver.promotion_training_features f
  ON p.sku_id = f.sku_id
 AND p.cluster_id = f.cluster_id
 AND p.start_date = f.observation_date;
