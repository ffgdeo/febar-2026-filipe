-- PromoFlow Bronze: lossless ingestion from Cleany's governed landing volume.
-- Incremental sources use Auto Loader; small reference snapshots use materialized views.

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_bronze.pos_sales
COMMENT 'Raw incremental point-of-sale records from Cleany retail partners, including intentionally injected quality cases.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT *,
       _metadata.file_path AS source_file_path,
       current_timestamp() AS ingested_at
FROM STREAM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/pos_sales',
  format => 'parquet',
  schemaEvolutionMode => 'addNewColumns',
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_bronze.inventory_snapshots
COMMENT 'Raw incremental store-SKU inventory snapshots, including intentionally injected quality cases.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT *,
       _metadata.file_path AS source_file_path,
       current_timestamp() AS ingested_at
FROM STREAM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/inventory_snapshots',
  format => 'parquet',
  schemaEvolutionMode => 'addNewColumns',
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_bronze.promotions
COMMENT 'Raw incremental promotion campaigns by SKU and store cluster.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT *,
       _metadata.file_path AS source_file_path,
       current_timestamp() AS ingested_at
FROM STREAM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/promotions',
  format => 'parquet',
  schemaEvolutionMode => 'addNewColumns',
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH STREAMING TABLE promoflow.promoflow_bronze.shipments
COMMENT 'Raw incremental distribution-center shipment lines for Cleany retail stores.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'delta.enableRowTracking' = 'true'
)
AS
SELECT *,
       _metadata.file_path AS source_file_path,
       current_timestamp() AS ingested_at
FROM STREAM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/shipments',
  format => 'parquet',
  schemaEvolutionMode => 'addNewColumns',
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.products
COMMENT 'Raw product master snapshot for Cleany home and laundry care SKUs.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/products',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.store_clusters
COMMENT 'Raw store-cluster master snapshot with commercial response attributes.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/store_clusters',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.stores
COMMENT 'Raw retail-store master snapshot and serving distribution-center assignment.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/stores',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.distribution_centers
COMMENT 'Raw Cleany distribution-center master snapshot.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/distribution_centers',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.calendar
COMMENT 'Raw two-year business calendar used for demand and promotion analysis.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/calendar',
  format => 'parquet',
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.cpg_event_calendar
COMMENT 'Raw Cleany commercial planning calendar supplied as a governed landing dataset.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/cpg_event_calendar',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.forward_supply_plan
COMMENT 'Raw event-horizon ERP/IBP supply plan extract containing projected inventory, planned receipts, baseline commitments, and safety stock; no readiness status or action is supplied by the source.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/forward_supply_plan',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.imported_promotion_plans
COMMENT 'Raw promotion plans exported from Cleany TPM. The source contains plan commitments and workflow state, not derived risk or recommendation labels.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/imported_promotion_plans',
  format => 'json',
  inferColumnTypes => true,
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_bronze.product_costs
COMMENT 'Raw effective-dated standard unit costs by SKU.'
AS SELECT *, _metadata.file_path AS source_file_path
FROM read_files(
  '/Volumes/promoflow/promoflow_raw/landing/product_costs',
  format => 'parquet',
  rescuedDataColumn => '_rescued_data'
);
