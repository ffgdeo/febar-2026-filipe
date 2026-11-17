"""Configuration for the Cleany synthetic data generator."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class GenerationConfig:
    """Approved FE BAR dataset dimensions and output location."""

    catalog: str = "promoflow"
    schema: str = "promoflow_raw"
    volume: str = "landing"
    demo_as_of_date: date = date(2026, 11, 16)
    start_date: date = date(2024, 11, 16)
    days: int = 730
    products: int = 12
    stores: int = 48
    clusters: int = 6
    distribution_centers: int = 2
    promotions: int = 1_200
    shipments: int = 30_000
    seed: int = 20_260_216
    bad_data_basis_points: int = 50

    @property
    def fact_rows(self) -> int:
        return self.days * self.stores * self.products

    @property
    def history_end_date(self) -> date:
        """Last observable date: fixed to the day before the demo as-of date."""
        from datetime import timedelta

        return self.demo_as_of_date - timedelta(days=1)

    @property
    def base_path(self) -> str:
        return f"/Volumes/{self.catalog}/{self.schema}/{self.volume}"
