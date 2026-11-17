# FE BAR submission answers

## Customer name

Cleany (fictional; all data is synthetic).

## Industry / vertical

Consumer Packaged Goods — household cleaning products, with retail promotion planning.

## What is the business challenge you are solving?

Cleany promotion planners cannot easily connect completed-promotion performance, commercial events, forecast demand, product economics, and inventory plans. This slows planning, makes trade-spend allocation inconsistent, and allows profitable-looking promotions to reach approval without a clear view of projected availability risk.

## How does your Databricks solution address this challenge?

PromoFlow creates an integrated decision journey. Lakeflow ingests and standardizes raw enterprise-style feeds. Unity Catalog governs data and AI assets. MLflow trains and registers a demand-uplift model that scores event/SKU/market opportunities. A Unity Catalog-to-Lakebase synced table serves imported TPM plans, while native Lakebase tables store scenarios, immutable versions, decisions, AI briefs, and audit history. Genie makes governed data queryable in natural language. A Databricks App lets planners analyze history, review upcoming plans and risk, compare scenarios, approve decisions, and invoke a governed Unity Gateway model service for a decision brief.

Inventory is used as approval context only; the solution does not create supply actions. Reverse Lakehouse Sync is intentionally out of scope.

## What AI tools did you use, and what was your workflow? What decisions and trade-offs did you make?

I used Codex as a development teammate for architecture, code, tests, documentation, and iterative UI refinement. I validated each generated artifact against live Databricks execution rather than treating source code as proof. Databricks AI capabilities include an MLflow-registered predictive model, a Genie Agent over governed Gold products, and Unity Gateway for governed narrative generation.

The main trade-offs were to keep financial calculations deterministic while using GenAI only for explanation; treat uplift as predictive rather than causal; use a hybrid lakehouse/Lakebase design; keep inventory as a feasibility constraint instead of automating supply execution; use synthetic data; and omit reverse Lakehouse Sync to avoid an unnecessary preview dependency.

## What are the business outcomes and impact?

The prototype shows how Cleany can concentrate trade investment on positive-margin patterns, reduce research and comparison time, surface inventory shortfalls before approval, and make decisions reproducible. The current decision queue contains 15 imported plans pending approval and 12 constrained plans with 5,205 projected shortfall units. The model exposes 204 profitable future opportunities representing $642K of modeled incremental-margin potential, including $267K across 93 READY opportunities. Historically, 217 promotions recorded $3.0M of revenue at risk from lost sales. The full synthetic history contains 1,200 promotions, $71.5M incremental margin, $30.0M trade spend, 2.38x portfolio ROI, and 24.4% average observational uplift. Historical values are realized synthetic outcomes; future values are modeled potential, not booked savings. A pilot would measure realized margin, trade ROI, forecast error, revenue-at-risk reduction, planner hours, and adoption against prior cycles and a matched control where feasible.
