# Cleany PromoFlow

PromoFlow is an end-to-end Databricks prototype for fictional CPG company **Cleany**. It helps promotion planners learn from completed promotions, identify profitable event-aligned opportunities, compare scenarios, and approve plans with inventory feasibility visible before commitment.

The business problem is specific: promotion history, demand signals, commercial calendars, product economics, and inventory plans live in separate systems. Planners struggle to answer which promotions worked, what to run next, and whether a commercially attractive plan is operationally feasible.

## Business outcomes

- Focus trade investment on positive-margin promotion patterns.
- Reduce planning cycle time with governed, model-scored recommendations.
- Surface projected inventory shortfalls before approval without automating supply actions.
- Give business users natural-language access to governed data through Genie.

The synthetic portfolio contains 1,200 completed promotions with $71.5M incremental margin, $30.0M trade spend, 2.38x portfolio ROI, and 24.4% average observational uplift. These are prototype estimates, not customer claims or causal measurements.

## Integrated Databricks journey

1. **Lakeflow** ingests synthetic POS, promotion, product, inventory, receipt, TPM plan, and commercial-calendar feeds into Bronze, Silver, and Gold.
2. **Unity Catalog** governs tables, lineage, model assets, and AI access in catalog `promoflow`.
3. **MLflow** trains, registers, and scores a demand-uplift model; Gold exposes 204 opportunities with transparent economics.
4. **Lakebase** serves operational planning. A UC-to-Lakebase synced table provides 48 imported TPM plans; native Postgres tables persist scenarios, versions, decisions, briefs, and audit events.
5. **Unity Gateway** invokes governed model service `promoflow.promoflow_ml.promo_decision_brief` for decision narratives with response metadata.
6. **Genie** answers governed questions over history, plans, opportunities, events, and feasibility.
7. **Databricks Apps** surfaces Overview, Past Promotion Analysis, Upcoming Promotions, Opportunity Inbox, Scenario Studio, Decision Workspace, and Genie.

Reverse Lakehouse Sync is intentionally out of scope. The demo proves lakehouse-to-Lakebase operational serving and Lakebase-native write-back; it does not claim Lakebase-to-Unity-Catalog replication.

## Submission artifacts

- [Final execution evidence](docs/execution_evidence/FINAL_SUBMISSION_EVIDENCE.md)
- [Customer presentation deck](deck/cleany_promoflow_customer_deck.pdf)
- [Presentation source specification](deck/cleany_promoflow_customer_deck.json)
- [Editable Google Slides presentation](https://docs.google.com/presentation/d/1RcG_ZH07umiimmvIHRIJchN6z4XGiuAR5ED6fw0quUE/edit)
- [Roleplay package](docs/roleplay)
- [Architecture](docs/architecture.md)
- [Submission answers](docs/submission_answers.md)

```bash
uv run pytest -q
cd app/promoflow-cleany
pnpm run typecheck
pnpm run test
pnpm run build
```

All data and customer/product names are synthetic.
