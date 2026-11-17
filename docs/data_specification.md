# Data specification

All inputs are synthetic representations of common CPG enterprise feeds.

| Domain | Production analogue | Grain / purpose |
|---|---|---|
| POS sales | Retailer POS / syndicated data | Daily SKU, store cluster, units, revenue |
| Promotion history | TPM system | Promotion, SKU, market, dates, mechanic, discount |
| Product economics | ERP / product MDM | SKU list price and unit cost; governed, not planner-editable |
| Inventory and receipts | ERP/WMS plus purchase orders | SKU, market, as-of date, on-hand and inbound |
| Commercial events | TPM calendar, retailer calendars, syndicated calendar provider | Event, dates, category affinity and source |
| Future plans | TPM export | Planned promotion, SKU, market, event, status, discount, demand |
| Baseline commitments | IBP/OMS | Baseline demand and committed units over event horizon |

The generator creates raw files through an explicit manifest. Lakeflow preserves source path, ingest timestamp, and business keys in Bronze; validates types and keys in Silver; and produces governed decision products in Gold.

Key Gold products are `promotion_explorer`, `cpg_event_calendar`, `planner_opportunities`, `promotion_feasibility`, and `planned_promotions`.

Historical `modeled_uplift_rate` is stored in percentage points. Future `expected_modeled_uplift_pct` is stored as a decimal rate. Both are documented to avoid presentation errors. Uplift is observational/predictive, not causal.

Feasibility compares projected opening inventory plus receipts against committed baseline demand, safety stock, and incremental promotion demand. It produces factual `READY`, `REVIEW`, or `CONSTRAINED` states and never prescribes a supply action.
