# Lakebase operational serving

Project `promoflow-planning` supports two patterns:

1. `promoflow_serving.planned_promotions` is a Unity Catalog-to-Lakebase synced table containing 48 imported TPM plans.
2. `promoflow_ops` native Postgres tables persist scenarios, immutable versions, decisions, AI briefs, comparisons, and audit events.

The app snapshots governed economics and availability facts into each scenario version. Inventory is a feasibility check only; there is no supply-action workflow.

`REPLICA IDENTITY FULL` is production-friendly schema hygiene, but reverse Lakehouse Sync is intentionally not configured or claimed.
