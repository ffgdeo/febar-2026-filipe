from pathlib import Path

ROOT = Path(__file__).parents[2]


def test_imported_plans_are_landed_and_risk_is_derived():
    generator = (ROOT / "src/data_generation/generator.py").read_text()
    bronze = (ROOT / "src/pipeline/01_bronze.sql").read_text()
    silver = (ROOT / "src/pipeline/02_silver.sql").read_text()
    gold = (ROOT / "src/pipeline/03_gold.sql").read_text()

    assert "def build_imported_promotion_plans" in generator
    assert "/landing/imported_promotion_plans" in bronze
    assert "promoflow.promoflow_silver.imported_promotion_plans" in silver
    assert "promoflow.promoflow_gold.planned_promotions" in gold
    assert "NO_PLANNED_RECEIPT_AND_INVENTORY_SHORTFALL" in gold

    source_builder = generator.split("def build_imported_promotion_plans", 1)[1].split("def ", 1)[0]
    assert "risk_status" not in source_builder
    assert "readiness_status" not in source_builder
