# Cleany PromoFlow
## Put promotion investment behind profitable, executable plans

**FE BAR customer demo — Consumer Packaged Goods**

- One decision journey from promotion history to approved scenario
- Governed predictive demand, transparent economics, and availability context
- Synthetic data; outcome figures are prototype planning estimates

---

# The decision Cleany needs to improve

Promotion planners must choose **what to promote, where, when, and at what discount**.

Today, performance history, commercial calendars, demand forecasts, product economics, and inventory plans are fragmented. The result is slow planning, inconsistent trade allocation, and late discovery of availability risk.

**Target outcome:** fund more positive-margin promotions while identifying inventory constraints before approval.

---

# Value is measured in buyer KPIs

| KPI | Why it matters | Prototype evidence |
|---|---|---|
| Approval backlog | Decisions awaiting action | **15 imported plans pending approval** |
| Availability exposure | Risk before approval | **12 constrained plans / 5,205 shortfall units** |
| Future value pool | Profitable modeled opportunity margin | **$642K total; $267K already READY** |
| Historical revenue at risk | Recorded lost-sales exposure | **$3.0M across 217 promotions** |
| Portfolio ROI | Return on historical trade investment | **2.38x** on $30.0M spend |
| Planning cycle time | Speed from opportunity to decision | One integrated workflow |

Historical figures are realized synthetic outcomes; future figures are modeled potential, not booked savings. The prototype does not claim causal incrementality.

---

# Where each outcome is visible

| Decision question | App surface | Measure |
|---|---|---|
| What requires action now? | **Overview** | Pending approvals, plans at risk, events without plans |
| What value can we pursue? | **Overview + Opportunity Inbox** | $642K modeled margin; $267K READY margin |
| What risk can we protect? | **Overview + Upcoming Promotions** | 5,205 constrained shortfall units; $3.0M historical revenue at risk |
| What worked before? | **Past Promotion Analysis** | Margin, spend, 2.38x ROI, 24.4% observational uplift |
| Which option should we fund? | **Scenario Studio** | Side-by-side incremental margin, ROI, demand, and feasibility |
| Can leaders self-serve? | **Genie** | Governed answers with generated SQL |

**Measurement discipline:** backlog and risk are current facts; opportunity margin is modeled potential; realized impact is measured after execution.

---

# What I will show

1. **Overview** — what needs attention now
2. **Past Promotion Analysis** — what worked and why
3. **Upcoming Promotions** — approval status and inventory risk
4. **Opportunity Inbox** — model-scored event opportunities
5. **Scenario Studio** — compare promotion alternatives
6. **Decision Workspace** — approve with an AI-generated brief
7. **Genie** — ask governed questions in natural language

**Tell-show-tell:** every screen ends with the decision it enables.

---

# One integrated data and AI journey

```text
Enterprise-style raw feeds
        |
Lakeflow Bronze -> Silver -> Gold
        |         Unity Catalog governance
        +------ MLflow demand model
        +------ Genie Agent
        +------ UC -> Lakebase synced TPM plans
                       + native scenarios / decisions / audit
                                      |
                         Databricks App + Unity Gateway
```

The commercial-event calendar is an input feed, not hardcoded business logic. Inventory is decision context, not an automated supply workflow.

---

# From history to a modeled opportunity

Historical analysis combines ROI, margin, trade spend, uplift, mechanic, and lost sales.

Future opportunities combine:

- Commercial event and category affinity
- Registered-model demand score
- Governed list price and unit cost
- Discount and mechanic
- Transparent trade-spend, margin, and ROI formulas
- Confidence and inventory-feasibility signals

Planners can filter by product, market, event, status, and risk rather than interpreting opaque SKU codes.

---

# Operational planning in Lakebase

**Synced from the lakehouse:** 48 imported plans from the fictional TPM feed.

**Native operational state:** scenarios, immutable versions, decisions, generated briefs, comparisons, and audit events.

This hybrid pattern provides governed analytics plus transactional workflow. Reverse Lakehouse Sync is intentionally out of scope; a production extension could publish approved decisions through a supported CDC pattern.

---

# AI adds speed without hiding the math

- **MLflow model:** predicts future demand uplift and records model version.
- **Unity Gateway:** generates a concise decision narrative from governed scenario facts.
- **Genie:** answers portfolio and plan questions over governed Gold tables.
- **Human approval:** planners retain control; AI does not alter price, cost, margin, ROI, or readiness.

Every narrative is decision support and carries source/model metadata. Historical uplift is observational; predicted uplift is not causal.

---

# Evidence the build ran

- 1,200 historical promotion records served live
- 204 modeled opportunities served live
- 51 upcoming app records, including 48 imported TPM plans
- 15 imported plans pending approval; 12 constrained plans with 5,205 shortfall units
- $642K modeled opportunity margin; $267K from 93 READY opportunities
- $3.0M historical revenue at risk across 217 promotions with recorded lost sales
- Lakebase synced table online
- App deployment `01f1e29372d0191caf65751229f68944`: RUNNING / ACTIVE / SUCCEEDED
- Five authenticated API checks: HTTP 200
- Genie conversations completed with generated SQL and statement IDs
- 24 app tests passed; typecheck, build, and Databricks validation passed

---

# Recommended pilot

**Scope:** one category, two retail clusters, one planning cycle.

**Success measures:**

- Planner hours per approved promotion
- Share of spend on positive-margin scenarios
- Promotions approved with unresolved shortfall
- Forecast error and realized uplift by mechanic
- User adoption and decision override rate

**Outcome calculation:** compare pilot versus prior planning cycles and matched non-pilot promotions. Report realized incremental margin, trade-spend ROI, forecast error, revenue-at-risk reduction, and planner hours saved separately—never relabel modeled potential as realized savings.

**Decision requested:** sponsor a time-boxed pilot with RGM, promotion planning, supply planning, and data platform owners.
