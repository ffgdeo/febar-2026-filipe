# Architecture

```text
Synthetic enterprise feeds
POS + promotions + product/cost + inventory/receipts + TPM plans + event calendar
                              |
                              v
Lakeflow: Bronze -> Silver -> Gold, governed by Unity Catalog
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
MLflow demand model                    Genie governed Q&A
204 scored opportunities               history / plans / feasibility
             |
             v
UC -> Lakebase synced table: 48 imported TPM plans
Lakebase native tables: scenarios, versions, decisions, AI briefs, audit
             |
             v
Databricks App + Unity Gateway governed narrative generation
```

## Boundaries

- The lakehouse is the analytical system of record for history, features, forecasts, events, imported plans, and feasibility.
- Lakebase is the operational system of engagement for low-latency browsing and app-authored decision state.
- Inventory and receipts constrain approval with `READY`, `REVIEW`, or `CONSTRAINED`; no supply action is created.
- The event calendar is an input from a fictional TPM/commercial-calendar feed. Gold standardizes it; it does not hardcode events or uplift assumptions.
- Unity Gateway generates explanations, not financial metrics. Economics remain deterministic and auditable.
- Reverse Lakehouse Sync is intentionally excluded. A production extension could publish approved decisions back to the lakehouse.

## Security and identity

Unity Catalog controls tables and model-service access. The app declares SQL, Lakebase, Genie, and model resources. Genie uses the `dashboards.genie` user scope. Server routes expose signed-in identity without logging OAuth tokens. All data is synthetic.
