from pathlib import Path


GOLD_SQL = Path("src/pipeline/03_gold.sql").read_text()


def _feasibility_sql() -> str:
    marker = "CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.promotion_feasibility"
    return GOLD_SQL.split(marker, 1)[1]


def test_promotion_feasibility_is_a_forward_fact_product():
    sql = _feasibility_sql()

    assert "promoflow.promoflow_gold.planner_opportunities" in sql
    assert "promoflow.promoflow_silver.forward_supply_plan" in sql
    assert "projected_opening_inventory_units" in sql
    assert "planned_receipt_units" in sql
    assert "committed_baseline_units" in sql
    assert "incremental_promotion_demand_units" in sql
    assert "plan_as_of_date" in sql
    assert "source_updated_at" in sql


def test_promotion_feasibility_has_only_readiness_statuses_not_actions():
    sql = _feasibility_sql()

    for status in ("'READY'", "'REVIEW'", "'CONSTRAINED'"):
        assert status in sql

    assert "recommended_action" not in sql
    assert "REPLENISH_OR_TRANSFER" not in sql
    assert "CREATE_TASK" not in sql


def test_forward_supply_plan_is_landed_and_governed_without_authored_status():
    bronze_sql = Path("src/pipeline/01_bronze.sql").read_text()
    silver_sql = Path("src/pipeline/02_silver.sql").read_text()
    generator = Path("src/data_generation/generator.py").read_text()

    assert "/landing/forward_supply_plan" in bronze_sql
    assert "promoflow.promoflow_silver.forward_supply_plan" in silver_sql
    assert "projected_opening_inventory_units" in silver_sql
    assert "planned_receipt_units" in silver_sql
    assert "source_updated_at" in silver_sql
    source_builder = generator.split("def build_forward_supply_plan", 1)[1].split(
        "def build_costs", 1
    )[0]
    assert "readiness_status" not in source_builder
    assert "CONSTRAINED" not in source_builder
    assert "READY" not in source_builder


def test_planner_opportunities_no_longer_reuses_historical_supply_actions():
    planner_sql = GOLD_SQL.split(
        "CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.planner_opportunities",
        1,
    )[1].split(
        "CREATE OR REFRESH MATERIALIZED VIEW promoflow.promoflow_gold.promotion_feasibility",
        1,
    )[0]

    assert "inventory_readiness" not in planner_sql
    assert "supply_action" not in planner_sql
    assert "historical_inventory_gap_units" not in planner_sql
