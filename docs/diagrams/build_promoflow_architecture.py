import sys

SKILL_ROOT = "/Users/filipe.deo/.codex/plugins/cache/isaac-sync-fe-vibe/fe-specialized-agents/1.1.0/skills/drawio-diagram"
sys.path.insert(0, f"{SKILL_ROOT}/scripts")

from generate_drawio import DrawioBuilder, load_icons


OUTPUT = "docs/diagrams/cleany_promoflow_architecture.drawio"

icons = load_icons()
b = DrawioBuilder(width=1600, height=900, icons_cache=icons)

b.add_title(
    45,
    20,
    1510,
    "Cleany PromoFlow — governed promotion decision architecture",
    "From fragmented commercial and supply signals to profitable, executable promotion decisions",
)
b.add_banner(45, 95, 1510, "DATA AND DECISION FLOW  →")

# Layer 1: source systems
sources = b.add_container(45, 135, 235, 525, "Enterprise data sources", "sources")
pos = b.add_node(22, 55, 190, 72, "POS sales &\nhistorical promotions", "purple", icon_name="delta_table", parent=sources)
product = b.add_node(22, 147, 190, 72, "Product, price\n& unit cost", "purple", icon_name="delta_table", parent=sources)
inventory = b.add_node(22, 239, 190, 72, "Inventory &\ninbound receipts", "purple", icon_name="delta_table", parent=sources)
plans = b.add_node(22, 331, 190, 72, "Imported TPM\npromotion plans", "purple", icon_name="delta_table", parent=sources)
events = b.add_node(22, 423, 190, 72, "Commercial\nevent calendar", "purple", icon_name="delta_table", parent=sources)

# Layer 2: lakehouse data engineering
foundation = b.add_container(310, 135, 285, 525, "Governed lakehouse", "medallion")
lakeflow = b.add_node(27, 58, 230, 78, "Lakeflow\nBronze → Silver → Gold", "blue", icon_name="spark", parent=foundation)
delta = b.add_node(27, 166, 230, 85, "Delta Lake tables\nHistory • events • feasibility", "gold", icon_name="delta_lake", parent=foundation)
uc = b.add_node(27, 286, 230, 85, "Unity Catalog\nGovernance, lineage & access", "gov", icon_name="unity_catalog", parent=foundation)
features = b.add_node(27, 406, 230, 72, "Governed features\n& decision metrics", "silver", icon_name="delta_table", parent=foundation)

# Layer 3: intelligence
intelligence = b.add_container(625, 135, 270, 525, "Decision intelligence", "aiml")
mlflow = b.add_node(25, 72, 220, 92, "MLflow\nDemand, uplift & margin scoring", "orange", icon_name="mlflow", parent=intelligence)
opportunities = b.add_node(25, 200, 220, 88, "Scored opportunities\nProfitability + readiness", "gold", icon_name="ai", parent=intelligence)
genie = b.add_node(25, 332, 220, 82, "Genie\nNatural-language analysis", "teal", icon_name="ai", parent=intelligence)
gateway = b.add_node(25, 430, 220, 70, "Unity Gateway\nGrounded decision briefs", "orange", icon_name="ai", parent=intelligence)

# Layer 4: operational serving and workflow
operations = b.add_container(925, 135, 300, 525, "Operational planning", "compute")
synced = b.add_node(28, 65, 244, 88, "Lakebase synced table\nImported TPM plans", "yellow", icon_name="postgresql", parent=operations)
native = b.add_node(28, 188, 244, 100, "Lakebase native tables\nScenarios • versions • approvals\nAI briefs • audit", "yellow", icon_name="postgresql", parent=operations)
app = b.add_node(28, 332, 244, 120, "Databricks App\nPortfolio overview\nScenario comparison\nAvailability-aware approval", "green", icon_name="apps_services", parent=operations)

# Layer 5: decision makers and outcomes
users = b.add_container(1255, 135, 300, 525, "Business decisions", "consumption")
rgm = b.add_node(30, 67, 240, 76, "Revenue Growth\nManagement", "green", icon_name="databricks", parent=users)
planner = b.add_node(30, 169, 240, 76, "Promotion\nplanning", "green", icon_name="databricks", parent=users)
supply = b.add_node(30, 271, 240, 76, "Supply feasibility\nreview", "green", icon_name="databricks", parent=users)
outcome = b.add_node(30, 391, 240, 92, "Profitable, executable\npromotion decisions", "compute_green", icon_name="ai", parent=users)

# Primary left-to-right flow.
b.add_edge(pos, lakeflow, "", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.25)
b.add_edge(product, lakeflow, "", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.4)
b.add_edge(inventory, lakeflow, "", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.55)
b.add_edge(plans, lakeflow, "", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.7)
b.add_edge(events, lakeflow, "", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.85)

b.add_edge(lakeflow, delta, "clean & standardize", exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)
b.add_edge(delta, features, "curated facts", exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)
b.add_edge(uc, delta, "governs", dashed=True, exit_x=0.5, exit_y=0, entry_x=0.5, entry_y=1)

b.add_edge(features, mlflow, "train & score", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
b.add_edge(mlflow, opportunities, "daily predictions", exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)
b.add_edge(features, genie, "governed analytics", exit_x=1, exit_y=0.72, entry_x=0, entry_y=0.5)

b.add_edge(delta, synced, "Lakehouse Sync", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
b.add_edge(opportunities, native, "prioritized scenarios", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.35)
b.add_edge(native, app, "operational state", stroke_width=2.2, exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)
b.add_edge(synced, app, "imported plans", exit_x=0.8, exit_y=1, entry_x=0.2, entry_y=0)
b.add_edge(genie, app, "portfolio Q&A", dashed=True, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.55)
b.add_edge(gateway, app, "grounded narrative", dashed=True, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.82)

b.add_edge(app, rgm, "margin & ROI", exit_x=1, exit_y=0.25, entry_x=0, entry_y=0.5)
b.add_edge(app, planner, "compare & approve", stroke_width=2.2, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
b.add_edge(app, supply, "availability context", exit_x=1, exit_y=0.75, entry_x=0, entry_y=0.5)
b.add_edge(rgm, outcome, "", exit_x=0.5, exit_y=1, entry_x=0.2, entry_y=0)
b.add_edge(planner, outcome, "", exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)
b.add_edge(supply, outcome, "", exit_x=0.5, exit_y=1, entry_x=0.8, entry_y=0)

# Cross-cutting message and explicit scope boundary.
b.add_note(
    45,
    695,
    1510,
    86,
    "Unity Catalog governs data, lineage, permissions, model access and AI usage across the journey.  "
    "Inventory and receipts inform READY / REVIEW / CONSTRAINED decisions; the prototype does not create supply-chain actions.",
    color="#FFF7ED",
    border_color="#FF6B35",
)
b.add_text(
    45,
    805,
    1510,
    34,
    "Implemented prototype scope • Synthetic Cleany data • No reverse sync or automated supply execution",
    font_size=11,
    font_color="#546E7A",
    italic=True,
)

b.save(OUTPUT)
b.print_validation(strict=True)
print(OUTPUT)
