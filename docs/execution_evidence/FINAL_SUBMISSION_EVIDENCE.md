# Final submission evidence — Cleany PromoFlow

Captured 2026-11-17 with Databricks profile `febar`. All records are synthetic.

## End-to-end execution

| Stage | Evidence |
|---|---|
| Lakeflow | Bronze/Silver/Gold materialized POS, promotion, product, inventory/receipts, TPM plans, and calendar feeds: 1,200 completed promotions, 48 imported future plans, 204 opportunities. |
| Unity Catalog | Governed catalog `promoflow` contains Gold products, registered model assets, and governed AI service. |
| ML / MLflow | Demand-uplift model was trained, evaluated, registered, versioned, and used for scoring. |
| Lakebase | Project `promoflow-planning`; synced table `promoflow_serving.planned_promotions` online with 48 rows; native `promoflow_ops` tables persist decisions. |
| Unity Gateway | Model service `promoflow.promoflow_ml.promo_decision_brief` generates narratives with prompt/model/response metadata. |
| Genie | Space `01f1e1d21180156faa5560a01158c566`; etag `c2acd60001b448a858d87cfecb12d991d756096433691d1bb69cd4f6251f1b77`. |
| App | Deployment `01f1e29372d0191caf65751229f68944`: `SUCCEEDED`; app `RUNNING`; compute `ACTIVE`. |

## Live app verification

```text
/api/whoami                   HTTP 200
/api/overview                 HTTP 200, 51 upcoming records
/api/promotion-history        HTTP 200, 1,200 records
/api/upcoming-promotions      HTTP 200, 51 records
/api/workbench/opportunities  HTTP 200, 204 records
```

The live Overview reported 51 upcoming records, 18 submitted/pending approvals (15 imported plus 3 app-authored), 22 plans requiring review or constrained, 7,930.28 total shortfall units across constrained imported and app-authored plans, $642,397.21 modeled opportunity margin, $267,100.08 READY opportunity margin, and $3,005,912.44 historical revenue at risk.

App: https://promoflow-cleany-7474658488596447.aws.databricksapps.com

## Genie execution evidence

### Historical portfolio

Conversation `01f1e291622c1f5fbade4fe57202f1ac`; message `01f1e291623a102ba8fa5974ad26c4a2`; statement `01f1e291-6777-1ea8-8571-39c54487d5cf`; `COMPLETED`.

Result: 1,200 promotions; incremental margin 71,533,009.38; trade spend 30,027,677.10; portfolio ROI 2.3822358667; average observational uplift 24.37048708 percentage points.

### Upcoming approvals and availability

Conversation `01f1e2910212102398161ae268ae7dee`; message `01f1e291021d186facd97365361c60e6`; statement `01f1e291-0b73-1e3f-8d31-c790123850bf`; `COMPLETED`, 13 rows.

Result included 20 APPROVED/READY, 9 PENDING_APPROVAL/READY, and 8 APPROVED/CONSTRAINED plans. APPROVED/CONSTRAINED carried 3,267 shortfall units and Genie identified plans with no receipts plus shortfall.

### Profitable but constrained opportunities

Conversation `01f1e291020f1fe4be8f2ca6fd6ed6fc`; message `01f1e291021b1cd2b78ae271ebddc1a0`; statement `01f1e291-0a2d-164d-825e-5e1c5600c9ad`; `COMPLETED`, 20 rows.

The answer joined opportunities to feasibility on `opportunity_id` and returned positive-margin, positive-ROI, constrained candidates with product, market, event, margin, ROI, and shortfall.

## Validation

```text
App Vitest suite:           24 passed
Python unit/contract suite: 25 passed
TypeScript typecheck:       passed
Production build:           passed
Databricks Apps validate:   all checks passed
Authenticated live APIs:    5/5 passed
```

The final checklist reruns the Python suite and bundle validation before commit.

## Scope truthfulness

Historical uplift is observational; future uplift is predicted; neither is causal. Inventory supports feasibility only. Unity Catalog-to-Lakebase sync and native Lakebase write-back are demonstrated. Reverse Lakehouse Sync is intentionally out of scope and not claimed.

## Outcome measurement query

Genie One conversation `c762c408a50748f388b45399cebf32b6` grounded the executive KPIs in governed tables. It returned 15 imported plans pending approval, 12 constrained future plans, 5,205 projected shortfall units, $642,397 modeled incremental margin across 204 profitable opportunities, $267,100 modeled margin across 93 READY opportunities, and $3,005,912 historical revenue at risk across 217 promotions with recorded lost sales.

These measures are deliberately separated: backlog and shortfall are current planning facts; historical revenue at risk is a realized synthetic observation; opportunity margin is modeled future potential and is not claimed as savings.
