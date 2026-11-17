"""Pure helpers shared by generation and local tests."""

import hashlib
import json
import re
from datetime import date, timedelta

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

PORTFOLIO_TARGET_RANGES = {
    "successful_available_pct": (0.58, 0.67),
    "supply_constrained_pct": (0.13, 0.22),
    "underperforming_pct": (0.08, 0.17),
    "margin_failure_pct": (0.06, 0.14),
}


def validate_identifier(value: str) -> str:
    """Validate a Unity Catalog identifier before interpolation in DDL."""
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Unsafe Unity Catalog identifier: {value!r}")
    return value


def stable_bucket(*values: object, modulus: int = 10_000, seed: int = 0) -> int:
    """Return a process-independent deterministic bucket for unit-testable sampling."""
    if modulus <= 0:
        raise ValueError("modulus must be positive")
    payload = "|".join((str(seed), *(str(value) for value in values))).encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big") % modulus


def expected_fact_rows(days: int, stores: int, products: int) -> int:
    if min(days, stores, products) <= 0:
        raise ValueError("dimensions must be positive")
    return days * stores * products


def end_date(start: date, days: int) -> date:
    if days <= 0:
        raise ValueError("days must be positive")
    return start + timedelta(days=days - 1)


def canonical_schema_payload(fields: list[tuple[str, str, bool]]) -> str:
    """Return the canonical JSON representation used by schema fingerprints.

    Fields are sorted by name so a harmless projection-order change does not alter
    the fingerprint. Types are Spark ``simpleString`` values and ``nullable`` is
    retained because it affects what downstream ingestion may accept.
    """
    normalized = [
        {"name": name, "type": data_type, "nullable": nullable}
        for name, data_type, nullable in sorted(fields, key=lambda field: field[0])
    ]
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def schema_fingerprint(fields: list[tuple[str, str, bool]]) -> str:
    """Return a SHA-256 fingerprint for a canonical logical schema."""
    return hashlib.sha256(canonical_schema_payload(fields).encode()).hexdigest()


def expected_dataset_rows(
    *, days: int, stores: int, products: int, clusters: int,
    distribution_centers: int, promotions: int, shipments: int,
) -> dict[str, int]:
    """Expected rows for every landing dataset produced by the generator."""
    fact_rows = expected_fact_rows(days, stores, products)
    return {
        "products": products,
        "store_clusters": clusters,
        "stores": stores,
        "distribution_centers": distribution_centers,
        "calendar": days,
        "cpg_event_calendar": 13,
        "forward_supply_plan": 252,
        "imported_promotion_plans": 48,
        "product_costs": products * 4,
        "promotions": promotions,
        "pos_sales": fact_rows,
        "inventory_snapshots": fact_rows,
        "shipments": shipments,
        "synthetic_truth": promotions,
    }


def portfolio_metrics_are_valid(
    metrics: dict[str, float | int], *, minimum_agreement: float = 0.90
) -> bool:
    """Pure equivalent of the Spark portfolio gate, for fast unit validation."""
    mix_valid = all(
        low <= float(metrics[name]) <= high
        for name, (low, high) in PORTFOLIO_TARGET_RANGES.items()
    )
    return (
        mix_valid
        and float(metrics["profile_economics_agreement_pct"]) >= minimum_agreement
        and int(metrics["positive_margin_months"]) > int(metrics["observed_months"]) / 2
        and int(metrics["negative_margin_months"]) >= 1
    )
