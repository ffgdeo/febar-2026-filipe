# Objection handling

## Business stakeholder

**“What is the quantified value?”**
The prototype demonstrates the value levers, not a customer commitment: planning hours, trade-spend allocation, incremental margin, and lost sales avoided. I would baseline those measures in discovery and run a controlled category pilot before extrapolating.

**“Why should I trust the uplift?”**
Historical uplift is observational and future uplift is predictive, not causal. Decisions show confidence, model version, and transparent economics. A production pilot should add holdouts or causal measurement where retailer execution permits.

**“Will this automate planners away?”**
No. AI prioritizes evidence and drafts a brief. The planner controls scenario inputs and approval; governed financial calculations remain deterministic.

**“What is time to value?”**
The pilot scope is deliberately narrow: one category, two clusters, one planning cycle. Existing POS, TPM, product, and inventory extracts can map to the demonstrated contracts.

## Technical stakeholder

**“Where does the data come from?”**
POS/syndicated sales, TPM promotion history and plans, ERP/MDM product economics, ERP/WMS inventory and receipts, IBP/OMS commitments, and TPM/retailer event calendars. The demo uses synthetic equivalents with lineage.

**“Why Lakebase as well as the lakehouse?”**
Unity Catalog is the governed analytical system of record. Lakebase provides low-latency operational reads and transactional scenario/decision state. Imported plans sync from UC; native tables handle write-back.

**“Why no reverse sync?”**
It is not required to prove the planning workflow and would add preview dependency. Production can publish approved decisions through an approved CDC/sync pattern after architecture review.

**“How is security handled?”**
Unity Catalog controls governed tables and model service. App resources declare permissions; Genie uses user scope. Tokens are not committed or logged, and the demo contains no customer data.

**“What happens when the model or AI is wrong?”**
Deterministic economics and feasibility remain visible, scenarios are versioned, decisions are audited, and the human approves. Generated narratives are labeled decision support and store model/prompt metadata.
