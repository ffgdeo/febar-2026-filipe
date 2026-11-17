from datetime import date

import pytest

from data_generation.config import GenerationConfig
from data_generation.helpers import (
    canonical_schema_payload,
    end_date,
    expected_dataset_rows,
    expected_fact_rows,
    portfolio_metrics_are_valid,
    schema_fingerprint,
    stable_bucket,
    validate_identifier,
)


def test_approved_dimensions_produce_expected_fact_count():
    cfg = GenerationConfig()
    assert cfg.fact_rows == 420_480
    assert expected_fact_rows(cfg.days, cfg.stores, cfg.products) == 420_480
    assert cfg.demo_as_of_date == date(2026, 11, 16)
    assert cfg.start_date == date(2024, 11, 16)
    assert cfg.history_end_date == date(2026, 11, 15)
    assert end_date(cfg.start_date, cfg.days) == cfg.history_end_date


def test_stable_bucket_is_reproducible_and_bounded():
    first = stable_bucket("SKU-001", "STORE-003", "2025-01-10", seed=42)
    assert first == stable_bucket("SKU-001", "STORE-003", "2025-01-10", seed=42)
    assert 0 <= first < 10_000
    assert first != stable_bucket("SKU-002", "STORE-003", "2025-01-10", seed=42)


@pytest.mark.parametrize("value", ["promoflow", "promoflow_raw", "landing_2026"])
def test_valid_identifier(value):
    assert validate_identifier(value) == value


@pytest.mark.parametrize("value", ["bad-name", "schema.table", "x`; DROP TABLE y", ""])
def test_invalid_identifier(value):
    with pytest.raises(ValueError):
        validate_identifier(value)


def test_invalid_dimensions_and_modulus_are_rejected():
    with pytest.raises(ValueError):
        expected_fact_rows(0, 48, 12)
    with pytest.raises(ValueError):
        stable_bucket("x", modulus=0)


def test_schema_fingerprint_is_canonical_and_sensitive_to_semantics():
    fields = [("sku_id", "string", False), ("units", "int", True)]
    reversed_fields = list(reversed(fields))
    assert canonical_schema_payload(fields) == canonical_schema_payload(reversed_fields)
    assert schema_fingerprint(fields) == schema_fingerprint(reversed_fields)
    assert schema_fingerprint(fields) != schema_fingerprint(
        [("sku_id", "string", False), ("units", "bigint", True)]
    )
    assert schema_fingerprint(fields) != schema_fingerprint(
        [("sku_id", "string", False), ("units", "int", False)]
    )


def test_expected_dataset_rows_covers_every_landing_output():
    rows = expected_dataset_rows(
        days=730, stores=48, products=12, clusters=6,
        distribution_centers=2, promotions=1_200, shipments=30_000,
    )
    assert rows == {
        "products": 12,
        "store_clusters": 6,
        "stores": 48,
        "distribution_centers": 2,
        "calendar": 730,
        "cpg_event_calendar": 13,
        "forward_supply_plan": 252,
        "imported_promotion_plans": 48,
        "product_costs": 48,
        "promotions": 1_200,
        "pos_sales": 420_480,
        "inventory_snapshots": 420_480,
        "shipments": 30_000,
        "synthetic_truth": 1_200,
    }


def test_portfolio_validation_requires_mix_agreement_and_monthly_shape():
    valid = {
        "successful_available_pct": 0.62,
        "supply_constrained_pct": 0.17,
        "underperforming_pct": 0.12,
        "margin_failure_pct": 0.09,
        "profile_economics_agreement_pct": 0.96,
        "observed_months": 24,
        "positive_margin_months": 18,
        "negative_margin_months": 6,
    }
    assert portfolio_metrics_are_valid(valid)
    assert not portfolio_metrics_are_valid({**valid, "successful_available_pct": 0.75})
    assert not portfolio_metrics_are_valid({**valid, "negative_margin_months": 0})
    assert not portfolio_metrics_are_valid({**valid, "profile_economics_agreement_pct": 0.80})
