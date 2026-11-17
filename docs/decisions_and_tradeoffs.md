# Decisions and trade-offs

- **Promotion planning, not supply execution.** Inventory and inbound supply remain feasibility facts, but the app creates no supply tasks.
- **Hybrid lakehouse and Lakebase.** History and scoring stay in Unity Catalog; imported TPM plans sync into Lakebase; app-authored decisions use native Postgres transactions.
- **No reverse Lakehouse Sync.** It is intentionally out of scope, reducing preview dependency. Production analytics could later ingest approved decisions through a supported CDC pattern.
- **Deterministic economics, generative explanation.** Price, cost, demand, margin, trade spend, ROI, and feasibility are governed calculations. Unity Gateway explains but cannot change them.
- **Predictive, not causal.** Historical uplift is observational and future uplift is model-predicted.
- **MLOps-aligned, not a full template.** Training, evaluation, registration, versioned scoring, and run evidence are included; CI/CD and challenger automation are production extensions.
- **Synthetic realism.** Generated records demonstrate scale and edge cases without customer data.
