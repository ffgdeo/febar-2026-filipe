"""Serverless-safe landing manifest construction.

The data fingerprint is an explainable, order-independent aggregate over a
canonical row representation: columns sorted by name -> JSON -> CRC32, followed
by ``row_count:sum(crc32):min(crc32):max(crc32)``. It is intended to detect
accidental data drift reproducibly; it is not a cryptographic proof of file
identity. The separate schema fingerprint is SHA-256 over canonical schema JSON.
No rows are brought to the driver.
"""

from __future__ import annotations

try:
    from .helpers import schema_fingerprint
except ImportError:  # Databricks Spark Python task standalone execution.
    from helpers import schema_fingerprint


DATA_FINGERPRINT_SEMANTICS = (
    "v1: sorted columns encoded as Spark JSON; unsigned CRC32 per row; "
    "fingerprint=count:sum:min:max; order-independent drift check, not file checksum"
)
SCHEMA_FINGERPRINT_SEMANTICS = (
    "v1: SHA-256 of name-sorted JSON fields containing name,type,nullable"
)


def _schema_fields(df) -> list[tuple[str, str, bool]]:
    return [
        (field.name, field.dataType.simpleString(), field.nullable)
        for field in df.schema.fields
    ]


def dataset_manifest_row(
    df, *, dataset: str, path: str, expected_rows: int, seed: int,
    demo_as_of_date: str, history_start_date: str, history_end_date: str,
):
    """Build a one-row Spark DataFrame of counts and deterministic fingerprints."""
    from pyspark.sql import functions as F

    ordered_columns = sorted(df.columns)
    row_json = F.to_json(F.struct(*[F.col(name) for name in ordered_columns]))
    row_crc = F.crc32(row_json).cast("decimal(20,0)")
    aggregate = df.agg(
        F.count(F.lit(1)).alias("observed_row_count"),
        F.coalesce(F.sum(row_crc), F.lit(0)).alias("crc_sum"),
        F.coalesce(F.min(row_crc), F.lit(0)).alias("crc_min"),
        F.coalesce(F.max(row_crc), F.lit(0)).alias("crc_max"),
    )
    return aggregate.select(
        F.lit(dataset).alias("dataset"),
        F.lit(path).alias("dataset_path"),
        F.lit(seed).cast("long").alias("seed"),
        F.lit(demo_as_of_date).cast("date").alias("demo_as_of_date"),
        F.lit(history_start_date).cast("date").alias("history_start_date"),
        F.lit(history_end_date).cast("date").alias("history_end_date"),
        F.lit("promotion_economics_v2").alias("generation_calibration_version"),
        F.current_timestamp().alias("generation_timestamp_utc"),
        F.lit(expected_rows).cast("long").alias("expected_row_count"),
        F.col("observed_row_count").cast("long"),
        (F.col("observed_row_count") == F.lit(expected_rows)).alias("row_count_matches_expected"),
        F.concat_ws(
            ":", "observed_row_count",
            F.col("crc_sum").cast("string"),
            F.col("crc_min").cast("string"),
            F.col("crc_max").cast("string"),
        ).alias("data_fingerprint"),
        F.lit(DATA_FINGERPRINT_SEMANTICS).alias("data_fingerprint_semantics"),
        F.lit(schema_fingerprint(_schema_fields(df))).alias("schema_fingerprint_sha256"),
        F.lit(SCHEMA_FINGERPRINT_SEMANTICS).alias("schema_fingerprint_semantics"),
    )


def build_generation_manifest(
    datasets, *, expected_rows: dict[str, int], seed: int,
    demo_as_of_date: str, history_start_date: str, history_end_date: str,
):
    """Union one-row manifest aggregates for ``(name, path, DataFrame)`` tuples."""
    manifest = None
    for name, path, df in datasets:
        row = dataset_manifest_row(
            df, dataset=name, path=path, expected_rows=expected_rows[name], seed=seed,
            demo_as_of_date=demo_as_of_date, history_start_date=history_start_date,
            history_end_date=history_end_date,
        )
        manifest = row if manifest is None else manifest.unionByName(row)
    if manifest is None:
        raise ValueError("at least one dataset is required")
    return manifest
