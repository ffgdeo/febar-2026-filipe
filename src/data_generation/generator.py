"""Generate Cleany's promotion-to-shelf source data with Spark DataFrame APIs.

The script is serverless-safe: it does not use SparkContext/RDDs, cache/persist,
collect, or driver-side row generation. Large facts are emitted in monthly
partitions so Lakeflow can ingest them incrementally.
"""

from __future__ import annotations

import argparse
import os

try:
    from .config import GenerationConfig
    from .helpers import PORTFOLIO_TARGET_RANGES, expected_dataset_rows, validate_identifier
    from .manifest import build_generation_manifest
except ImportError:  # Spark Python tasks execute this module as a standalone file.
    from config import GenerationConfig
    from helpers import PORTFOLIO_TARGET_RANGES, expected_dataset_rows, validate_identifier
    from manifest import build_generation_manifest


def _bucket(F, seed: int, *columns, modulus: int = 10_000):
    """Deterministic pseudo-random integer expression in [0, modulus)."""
    return F.pmod(F.xxhash64(*columns, F.lit(seed)), F.lit(modulus))


def _id(F, prefix: str, column, width: int):
    return F.concat(F.lit(prefix), F.lpad(column.cast("string"), width, "0"))


def build_products(spark, cfg: GenerationConfig):
    from pyspark.sql import functions as F

    names = F.array(*[F.lit(x) for x in (
        "FreshWave Laundry Liquid", "FreshWave Laundry Pods", "PureBright Powder",
        "Sparkle Dish Liquid", "Sparkle Dishwasher Tabs", "ClearHome Surface Spray",
        "ClearHome Multi-Surface", "SoftNest Fabric Conditioner", "SoftNest Dryer Sheets",
        "CleanGuard Bathroom", "CleanGuard Floor Cleaner", "EcoDrop Concentrate",
    )])
    categories = F.array(*[F.lit(x) for x in (
        "Laundry", "Laundry", "Laundry", "Dish Care", "Dish Care", "Surface Care",
        "Surface Care", "Fabric Care", "Fabric Care", "Surface Care", "Surface Care", "Laundry",
    )])
    prices = F.array(*[F.lit(x) for x in (13.99, 16.49, 11.49, 5.99, 14.99, 6.49, 7.99, 9.99, 7.49, 6.99, 8.49, 12.99)])
    weights = F.array(*[F.lit(x) for x in (5.5, 3.8, 2.9, 2.2, 1.9, 1.6, 1.35, 1.1, 0.9, 0.8, 0.7, 0.55)])
    return spark.range(cfg.products).select(
        F.col("id").cast("int").alias("product_idx"),
        _id(F, "SKU-", F.col("id") + 1, 3).alias("sku_id"),
        F.element_at(names, F.col("id").cast("int") + 1).alias("product_name"),
        F.element_at(categories, F.col("id").cast("int") + 1).alias("category"),
        F.element_at(prices, F.col("id").cast("int") + 1).cast("decimal(8,2)").alias("list_price"),
        F.round(F.element_at(prices, F.col("id").cast("int") + 1) * (0.40 + _bucket(F, cfg.seed, F.col("id"), modulus=600) / 10_000), 2).alias("standard_cost"),
        F.element_at(weights, F.col("id").cast("int") + 1).alias("demand_weight"),
        F.when(F.col("id") < 3, 14).when(F.col("id") < 8, 10).otherwise(7).alias("shelf_units_per_case"),
    )


def build_clusters(spark, cfg: GenerationConfig):
    from pyspark.sql import functions as F

    names = F.array(*[F.lit(x) for x in ("Northeast Urban", "Northeast Suburban", "Midwest", "Southeast", "Southwest", "West Coast")])
    income = F.array(*[F.lit(x) for x in (1.22, 1.08, 0.96, 0.91, 0.98, 1.28)])
    elasticity = F.array(*[F.lit(x) for x in (0.88, 1.02, 1.12, 1.18, 1.08, 0.84)])
    return spark.range(cfg.clusters).select(
        F.col("id").cast("int").alias("cluster_idx"),
        _id(F, "CL-", F.col("id") + 1, 2).alias("cluster_id"),
        F.element_at(names, F.col("id").cast("int") + 1).alias("cluster_name"),
        F.element_at(income, F.col("id").cast("int") + 1).alias("income_index"),
        F.element_at(elasticity, F.col("id").cast("int") + 1).alias("price_elasticity"),
    )


def build_stores(spark, cfg: GenerationConfig):
    from pyspark.sql import functions as F

    cluster_idx = F.pmod(F.col("id") * 5 + F.floor(F.col("id") / 8), F.lit(cfg.clusters)).cast("int")
    dc_idx = F.when(cluster_idx.isin(0, 1, 2), F.lit(0)).otherwise(F.lit(1))
    formats = F.array(F.lit("Supercenter"), F.lit("Supermarket"), F.lit("Neighborhood"))
    return spark.range(cfg.stores).select(
        F.col("id").cast("int").alias("store_idx"),
        _id(F, "STORE-", F.col("id") + 1, 3).alias("store_id"),
        F.concat(F.lit("Cleany Retail Partner #"), F.lpad((F.col("id") + 1).cast("string"), 3, "0")).alias("store_name"),
        cluster_idx.alias("cluster_idx"),
        dc_idx.alias("serving_dc_idx"),
        F.element_at(formats, F.pmod(F.col("id") * 7, F.lit(3)).cast("int") + 1).alias("store_format"),
        (0.72 + _bucket(F, cfg.seed + 1, F.col("id"), modulus=7600) / 10_000).alias("store_demand_index"),
    )


def build_distribution_centers(spark, cfg: GenerationConfig):
    from pyspark.sql import functions as F

    return spark.range(cfg.distribution_centers).select(
        F.col("id").cast("int").alias("dc_idx"),
        _id(F, "DC-", F.col("id") + 1, 2).alias("dc_id"),
        F.when(F.col("id") == 0, "Cleany East DC").otherwise("Cleany West DC").alias("dc_name"),
        F.when(F.col("id") == 0, "Columbus, OH").otherwise("Phoenix, AZ").alias("location"),
        F.when(F.col("id") == 0, 3).otherwise(4).alias("standard_lead_time_days"),
    )


def build_calendar(spark, cfg: GenerationConfig):
    from pyspark.sql import functions as F

    day = F.date_add(F.lit(cfg.start_date.isoformat()).cast("date"), F.col("id").cast("int"))
    return spark.range(cfg.days).select(
        F.col("id").cast("int").alias("day_idx"), day.alias("date")
    ).select(
        "day_idx", "date", F.year("date").alias("year"), F.month("date").alias("month"),
        F.weekofyear("date").alias("week_of_year"), F.dayofweek("date").alias("day_of_week"),
        F.date_format("date", "yyyy-MM").alias("source_month"),
        F.concat(F.lit("batch-"), F.date_format("date", "yyyy-MM")).alias("source_batch_id"),
        F.when(F.month("date").isin(11, 12), 1.24)
         .when(F.month("date").isin(1, 2), 1.08)
         .when(F.month("date").isin(6, 7), 0.94).otherwise(1.0).alias("seasonality_index"),
        F.when((F.month("date") == 11) & (F.dayofmonth("date").between(20, 30)), True)
         .when((F.month("date") == 12) & (F.dayofmonth("date").between(15, 26)), True)
         .otherwise(False).alias("is_peak_holiday"),
    )


def build_cpg_event_calendar(spark, cfg: GenerationConfig):
    """Create a synthetic extract shaped like a commercial planning-system feed.

    The feed deliberately contains only event facts and planning metadata. Uplift,
    economics, and recommendation copy are derived downstream from promotion history
    and model scores; they are not authored into this source dataset.
    """
    from pyspark.sql import functions as F

    event_ids = (
        "EVT-2026-BLACK-FRIDAY", "EVT-2026-BLACK-FRIDAY", "EVT-2026-HOLIDAY",
        "EVT-2026-HOLIDAY", "EVT-2027-NEW-YEAR", "EVT-2027-NEW-YEAR",
        "EVT-2027-SPRING", "EVT-2027-SPRING", "EVT-2027-MOTHERS-DAY",
        "EVT-2027-SUMMER", "EVT-2027-SUMMER", "EVT-2027-BACK-SCHOOL",
        "EVT-2027-BACK-SCHOOL",
    )
    event_names = (
        "Black Friday", "Black Friday", "Holiday Cleaning", "Holiday Cleaning",
        "New Year Reset", "New Year Reset", "Spring Cleaning", "Spring Cleaning",
        "Mother's Day", "Summer Entertaining", "Summer Entertaining",
        "Back to School", "Back to School",
    )
    categories = (
        "Laundry", "Dish Care", "Surface Care", "Dish Care", "Laundry", "Surface Care",
        "Surface Care", "Laundry", "Fabric Care", "Dish Care", "Surface Care",
        "Laundry", "Fabric Care",
    )
    start_offsets = (7, 7, 19, 19, 49, 49, 119, 119, 161, 197, 197, 258, 258)
    end_offsets = (13, 13, 38, 38, 69, 69, 146, 146, 174, 237, 237, 293, 293)
    lead_times = (42, 42, 35, 35, 35, 35, 49, 49, 35, 42, 42, 49, 49)
    event_types = (
        "RETAIL_TENTPOLE", "RETAIL_TENTPOLE", "SEASONAL_OCCASION", "SEASONAL_OCCASION",
        "SEASONAL_OCCASION", "SEASONAL_OCCASION", "CATEGORY_SEASON", "CATEGORY_SEASON",
        "CULTURAL_OCCASION", "SEASONAL_OCCASION", "SEASONAL_OCCASION",
        "RETAIL_TENTPOLE", "RETAIL_TENTPOLE",
    )
    array = lambda values: F.array(*[F.lit(value) for value in values])
    position = F.col("id").cast("int") + 1
    as_of = F.lit(cfg.demo_as_of_date.isoformat()).cast("date")
    return spark.range(len(event_ids)).select(
        F.element_at(array(event_ids), position).alias("event_id"),
        F.element_at(array(event_names), position).alias("event_name"),
        as_of.alias("calendar_as_of_date"),
        F.date_add(as_of, F.element_at(array(start_offsets), position)).alias("event_start_date"),
        F.date_add(as_of, F.element_at(array(end_offsets), position)).alias("event_end_date"),
        F.element_at(array(categories), position).alias("category_affinity"),
        F.element_at(array(lead_times), position).cast("int").alias("lead_time_days"),
        F.element_at(array(event_types), position).alias("event_type"),
        F.lit("US").alias("market_code"),
        F.lit("ALL_STRATEGIC_RETAILERS").alias("retailer_scope"),
        F.lit("APPROVED").alias("planning_status"),
        F.date_sub(as_of, 30).cast("timestamp").alias("source_published_at"),
        as_of.cast("timestamp").alias("source_updated_at"),
        F.lit("Cleany TPM calendar export (synthetic)").alias("source_system"),
    )


def build_forward_supply_plan(spark, cfg: GenerationConfig, event_calendar, products, clusters):
    """Create an event-horizon extract shaped like an ERP/IBP supply plan.

    Quantities are synthetic planning facts, not readiness labels. Gold compares the
    planned supply position with the independently model-scored promotion demand.
    Production replaces this extract with ERP inventory/receipts and IBP or OMS
    baseline commitments at the same event/SKU/market grain.
    """
    from pyspark.sql import functions as F

    duration_days = F.datediff("event_end_date", "event_start_date") + 1
    # Eight stores per cluster in the approved demo dimensions. This demand plan is
    # independently calibrated from product velocity, not from downstream ML scores.
    baseline_commitment = F.round(
        F.lit(2.35) * F.col("demand_weight") * F.lit(cfg.stores / cfg.clusters)
        * duration_days * F.lit(1.08)
    )
    planned_incremental_demand = F.round(baseline_commitment * F.lit(0.70))
    supply_band = _bucket(
        F, cfg.seed + 31, "event_id", "sku_id", "cluster_id", modulus=100
    )
    capacity_factor = (
        F.when(supply_band < 22, F.lit(0.55))
        .when(supply_band < 48, F.lit(1.00))
        .otherwise(F.lit(1.65))
    )
    planned_incremental_capacity = F.round(planned_incremental_demand * capacity_factor)
    safety_stock = F.round(baseline_commitment * F.lit(0.15))
    opening_inventory = F.round(
        baseline_commitment + safety_stock + planned_incremental_capacity * F.lit(0.35)
    )
    planned_receipts = planned_incremental_capacity - F.round(
        planned_incremental_capacity * F.lit(0.35)
    )
    planned_receipts = F.when(supply_band < 10, F.lit(0)).otherwise(planned_receipts)

    return (
        event_calendar.alias("e")
        .join(
            products.alias("p"),
            F.col("e.category_affinity") == F.col("p.category"),
        )
        .crossJoin(clusters.alias("c"))
        .select(
            F.concat_ws("-", "e.event_id", "p.sku_id", "c.cluster_id").alias("supply_plan_id"),
            F.col("e.event_id"),
            F.col("e.event_start_date"),
            F.col("e.event_end_date"),
            F.col("p.sku_id"),
            F.col("c.cluster_id"),
            F.lit(cfg.demo_as_of_date.isoformat()).cast("date").alias("plan_as_of_date"),
            opening_inventory.cast("int").alias("projected_opening_inventory_units"),
            planned_receipts.cast("int").alias("planned_receipt_units"),
            baseline_commitment.cast("int").alias("committed_baseline_units"),
            safety_stock.cast("int").alias("safety_stock_units"),
            planned_incremental_demand.cast("int").alias("ibp_incremental_demand_plan_units"),
            F.date_sub(F.col("e.event_start_date"), F.col("e.lead_time_days")).alias("supply_plan_horizon_start"),
            F.col("e.event_end_date").alias("supply_plan_horizon_end"),
            F.lit(cfg.demo_as_of_date.isoformat()).cast("timestamp").alias("source_updated_at"),
            F.lit("Cleany ERP/IBP supply plan export (synthetic)").alias("source_system"),
        )
    )


def build_imported_promotion_plans(spark, cfg: GenerationConfig, event_calendar, products, clusters):
    """Create a synthetic extract shaped like Cleany's external TPM plan feed.

    The source contains planner commitments and workflow state only. Availability
    risk, economics, and recommendations are derived downstream from governed
    supply, product, and model products.
    """
    from pyspark.sql import functions as F

    candidates = (
        event_calendar.alias("e")
        .join(products.alias("p"), F.col("e.category_affinity") == F.col("p.category"))
        .crossJoin(clusters.alias("c"))
        .withColumn("selection_bucket", _bucket(F, cfg.seed + 41, "e.event_id", "p.sku_id", "c.cluster_id"))
        .orderBy("selection_bucket", "e.event_start_date", "p.sku_id", "c.cluster_id")
        .limit(48)
    )
    workflow_bucket = _bucket(F, cfg.seed + 42, "e.event_id", "p.sku_id", "c.cluster_id", modulus=100)
    mechanic_bucket = _bucket(F, cfg.seed + 43, "e.event_id", "p.sku_id", "c.cluster_id", modulus=4)
    duration_days = F.datediff("e.event_end_date", "e.event_start_date") + 1
    planned_incremental_units = F.round(
        F.lit(2.35) * F.col("p.demand_weight") * F.lit(cfg.stores / cfg.clusters)
        * duration_days * (F.lit(0.45) + workflow_bucket / F.lit(250.0))
    )
    return candidates.select(
        F.concat_ws("-", F.lit("TPM"), "e.event_id", "p.sku_id", "c.cluster_id").alias("plan_id"),
        F.col("e.event_id"), F.col("e.event_name"), F.col("e.category_affinity").alias("category"),
        F.col("e.event_start_date").alias("start_date"), F.col("e.event_end_date").alias("end_date"),
        F.col("p.sku_id"), F.col("c.cluster_id"),
        F.when(mechanic_bucket == 0, "TPR").when(mechanic_bucket == 1, "FEATURE")
         .when(mechanic_bucket == 2, "DISPLAY").otherwise("FEATURE_DISPLAY").alias("mechanic"),
        (F.lit(0.08) + workflow_bucket / F.lit(1000.0)).cast("decimal(6,4)").alias("discount_pct"),
        planned_incremental_units.cast("int").alias("planned_incremental_units"),
        F.when(workflow_bucket < 62, "APPROVED").when(workflow_bucket < 88, "PENDING_APPROVAL")
         .otherwise("DRAFT").alias("plan_status"),
        F.lit(cfg.demo_as_of_date.isoformat()).cast("date").alias("plan_as_of_date"),
        F.date_sub(F.lit(cfg.demo_as_of_date.isoformat()).cast("date"), 21).cast("timestamp").alias("created_at"),
        F.lit(cfg.demo_as_of_date.isoformat()).cast("timestamp").alias("source_updated_at"),
        F.lit("Cleany TPM promotion-plan export (synthetic)").alias("source_system"),
    )


def build_costs(spark, cfg: GenerationConfig, products):
    from pyspark.sql import functions as F

    rows = spark.range(cfg.products * 4).select(
        F.pmod(F.col("id"), F.lit(cfg.products)).cast("int").alias("product_idx"),
        F.floor(F.col("id") / cfg.products).cast("int").alias("period_idx"),
    )
    return rows.join(products.select("product_idx", "sku_id", "standard_cost"), "product_idx").select(
        _id(F, "COST-", F.col("product_idx") * 4 + F.col("period_idx") + 1, 4).alias("cost_id"),
        "sku_id",
        F.add_months(F.lit(cfg.start_date.isoformat()).cast("date"), F.col("period_idx") * 6).alias("effective_from"),
        F.round(F.col("standard_cost") * (1 + F.col("period_idx") * 0.012), 2).alias("unit_cost"),
    )


def build_promotions(spark, cfg: GenerationConfig, products, clusters):
    from pyspark.sql import functions as F

    base = spark.range(cfg.promotions).select(
        F.col("id").cast("int").alias("promotion_idx"),
        F.pmod(F.col("id"), F.lit(cfg.products)).cast("int").alias("product_idx_base"),
        F.pmod(F.floor(F.col("id") / cfg.products), F.lit(cfg.clusters)).cast("int").alias("cluster_idx_base"),
    )
    # Four fixed campaigns guarantee the evaluator-facing incidents; remaining rows are distributed.
    base = base.select(
        "promotion_idx",
        F.when(F.col("promotion_idx").isin(0, 2), 0)
         .when(F.col("promotion_idx") == 1, 5).when(F.col("promotion_idx") == 3, 6)
         .otherwise(F.col("product_idx_base")).alias("product_idx"),
        F.when(F.col("promotion_idx") == 0, 3).when(F.col("promotion_idx") == 1, 4)
         .when(F.col("promotion_idx") == 2, 0).when(F.col("promotion_idx") == 3, 2)
         .otherwise(F.col("cluster_idx_base")).alias("cluster_idx"),
    )
    offset = F.when(F.col("promotion_idx") == 0, 500).when(F.col("promotion_idx") == 1, 390) \
        .when(F.col("promotion_idx") == 2, 280).when(F.col("promotion_idx") == 3, 610) \
        .otherwise(
            F.floor(F.col("promotion_idx") / (cfg.products * cfg.clusters)) * 42
            + _bucket(F, cfg.seed + 3, "product_idx", "cluster_idx", modulus=26)
        )
    # Cohorts are intentionally time-shaped: profitable learning history first,
    # then constrained/weak/deep-discount cohorts. This retains negative months
    # without changing the deterministic 60/18/12/10 portfolio design.
    profile_band = F.floor(F.col("promotion_idx") / (cfg.products * cfg.clusters))
    discount = F.when(F.col("promotion_idx") == 1, 0.40) \
        .when(profile_band < 10, 0.10 + _bucket(F, cfg.seed + 40, F.col("promotion_idx"), modulus=700) / 10_000) \
        .when(profile_band < 13, 0.10 + _bucket(F, cfg.seed + 41, F.col("promotion_idx"), modulus=500) / 10_000) \
        .when(profile_band < 15, 0.08 + _bucket(F, cfg.seed + 42, F.col("promotion_idx"), modulus=400) / 10_000) \
        .otherwise(0.35 + _bucket(F, cfg.seed + 43, F.col("promotion_idx"), modulus=900) / 10_000)
    mechanic = F.when(F.col("promotion_idx") == 0, "FEATURE_DISPLAY") \
        .when(F.col("promotion_idx") == 1, "DISCOUNT") \
        .when(F.col("promotion_idx") == 2, "FEATURE_DISPLAY") \
        .when(F.col("promotion_idx") == 3, "DISCOUNT") \
        .otherwise(F.when(profile_band >= 13, "DISCOUNT")
                   .when(_bucket(F, cfg.seed + 5, F.col("promotion_idx"), modulus=100) < 48, "DISCOUNT")
                   .when(_bucket(F, cfg.seed + 5, F.col("promotion_idx"), modulus=100) < 77, "DISPLAY")
                   .otherwise("FEATURE_DISPLAY"))
    promo = base.select(
        "promotion_idx", "product_idx", "cluster_idx", offset.cast("int").alias("start_offset"),
        (7 + _bucket(F, cfg.seed + 6, F.col("promotion_idx"), modulus=8)).cast("int").alias("duration_days"),
        discount.alias("discount_pct"), mechanic.alias("mechanic"),
        F.when(F.col("promotion_idx") == 0, "SUPPLY_CONSTRAINED")
         .when(F.col("promotion_idx") == 1, "MARGIN_DESTRUCTIVE")
         .when(F.col("promotion_idx") == 2, "TRANSFER_RESCUE")
         .when(F.col("promotion_idx") == 3, "POST_PROMOTION_EXCESS")
         .when(profile_band < 10, "PROFITABLE")
         .when(profile_band < 13, "SUPPLY_CONSTRAINED")
         .when(profile_band < 15, "INEFFECTIVE")
         .otherwise("MARGIN_DESTRUCTIVE").alias("synthetic_profile"),
        F.when(F.col("promotion_idx") == 0, "SOUTHEAST_LAUNDRY_STOCKOUT")
         .when(F.col("promotion_idx") == 1, "MARGIN_DESTRUCTIVE_SURFACE_DISCOUNT")
         .when(F.col("promotion_idx") == 2, "NORTHEAST_TRANSFER_RESCUE")
         .when(F.col("promotion_idx") == 3, "POST_PROMOTION_EXCESS")
         .otherwise(F.lit(None)).alias("incident_code"),
    )
    return promo.join(products.select("product_idx", "sku_id"), "product_idx").join(
        clusters.select("cluster_idx", "cluster_id"), "cluster_idx"
    ).select(
        _id(F, "PROMO-", F.col("promotion_idx") + 1, 5).alias("promotion_id"),
        "promotion_idx", "sku_id", "product_idx", "cluster_id", "cluster_idx",
        F.date_add(F.lit(cfg.start_date.isoformat()).cast("date"), F.col("start_offset")).alias("start_date"),
        F.date_add(F.lit(cfg.start_date.isoformat()).cast("date"), F.col("start_offset") + F.col("duration_days") - 1).alias("end_date"),
        "discount_pct", "mechanic", "synthetic_profile", "incident_code",
        F.date_format(F.date_add(F.lit(cfg.start_date.isoformat()).cast("date"), F.col("start_offset")), "yyyy-MM").alias("source_month"),
    )


def _daily_promotion(spark, promotions):
    from pyspark.sql import functions as F

    return promotions.select(
        "promotion_id", "promotion_idx", "product_idx", "cluster_idx", "discount_pct", "mechanic", "synthetic_profile", "incident_code",
        F.explode(F.sequence("start_date", "end_date")).alias("date"),
    ).groupBy("product_idx", "cluster_idx", "date").agg(
        F.max_by("promotion_id", "discount_pct").alias("promotion_id"),
        F.max("discount_pct").alias("discount_pct"),
        F.max_by("mechanic", "discount_pct").alias("mechanic"),
        F.max_by("synthetic_profile", "discount_pct").alias("synthetic_profile"),
        F.max_by("incident_code", F.when(F.col("incident_code").isNotNull(), 1).otherwise(0)).alias("incident_code"),
    )


def build_daily_facts(spark, cfg: GenerationConfig, products, stores, clusters, calendar, promotions):
    from pyspark.sql import functions as F

    grid = spark.range(cfg.fact_rows, numPartitions=16).select(
        F.floor(F.col("id") / (cfg.stores * cfg.products)).cast("int").alias("day_idx"),
        F.pmod(F.floor(F.col("id") / cfg.products), F.lit(cfg.stores)).cast("int").alias("store_idx"),
        F.pmod(F.col("id"), F.lit(cfg.products)).cast("int").alias("product_idx"),
    )
    frame = grid.join(calendar, "day_idx").join(stores, "store_idx").join(products, "product_idx").join(
        clusters.select("cluster_idx", "cluster_id", "cluster_name", "price_elasticity"), "cluster_idx"
    ).join(_daily_promotion(spark, promotions), ["product_idx", "cluster_idx", "date"], "left")

    weekday = F.when(F.col("day_of_week").isin(1, 7), 1.12).otherwise(1.0)
    trend = 1 + F.col("day_idx") * 0.00018
    noise = 0.84 + _bucket(F, cfg.seed + 10, "day_idx", "store_idx", "product_idx", modulus=3300) / 10_000
    baseline = 2.35 * F.col("demand_weight") * F.col("store_demand_index") * F.col("seasonality_index") * weekday * trend * noise
    mechanic_effect = F.when(F.col("mechanic") == "FEATURE_DISPLAY", 0.34).when(F.col("mechanic") == "DISPLAY", 0.18).otherwise(0.05)
    commercial_uplift = F.col("discount_pct") * F.col("price_elasticity") * 2.6 + mechanic_effect
    promo_uplift = F.when(F.col("synthetic_profile").isin("INEFFECTIVE", "POST_PROMOTION_EXCESS"), -0.10) \
        .when(F.col("synthetic_profile") == "MARGIN_DESTRUCTIVE", F.greatest(commercial_uplift, F.lit(0.58))) \
        .when(F.col("synthetic_profile") == "SUPPLY_CONSTRAINED", F.greatest(commercial_uplift, F.lit(0.85))) \
        .when(F.col("synthetic_profile").isin("PROFITABLE", "TRANSFER_RESCUE"), F.greatest(commercial_uplift, F.lit(0.65))) \
        .when(F.col("promotion_id").isNotNull(), commercial_uplift).otherwise(0.0)
    latent = F.greatest(F.lit(0), F.round(baseline * (1 + promo_uplift))).cast("int")
    inventory_noise = 1.25 + _bucket(F, cfg.seed + 11, "day_idx", "store_idx", "product_idx", modulus=12500) / 10_000
    available = F.round(baseline * inventory_noise + 4).cast("int")
    available = F.when(F.col("incident_code") == "SOUTHEAST_LAUNDRY_STOCKOUT", F.round(latent * 0.86)) \
        .when(
            F.col("synthetic_profile") == "SUPPLY_CONSTRAINED",
            F.greatest(F.lit(0), F.least(latent - 1, F.round(latent * 0.94))),
        ) \
        .when(F.col("incident_code") == "NORTHEAST_TRANSFER_RESCUE", F.round(latent * 1.12)) \
        .when(F.col("incident_code") == "POST_PROMOTION_EXCESS", F.round(latent * 2.25)) \
        .when(F.col("promotion_id").isNotNull(), F.round(latent * 1.12)).otherwise(available).cast("int")
    bad = _bucket(F, cfg.seed + 12, "day_idx", "store_idx", "product_idx") < cfg.bad_data_basis_points
    common = frame.select(
        "date", "source_month", "source_batch_id", "day_idx", "store_idx", "store_id", "cluster_id", "serving_dc_idx",
        "product_idx", "sku_id", "list_price", "standard_cost", "promotion_id", "discount_pct", "mechanic", "incident_code",
        baseline.alias("true_baseline_units"), promo_uplift.alias("true_promotion_uplift"), latent.alias("latent_demand_units"),
        available.alias("valid_available_units"), bad.alias("is_injected_bad_record"),
    )
    sales = common.select(
        _id(F, "SALE-", F.col("day_idx") * cfg.stores * cfg.products + F.col("store_idx") * cfg.products + F.col("product_idx") + 1, 9).alias("sales_record_id"),
        "date", "source_month", "source_batch_id", "store_id", "sku_id", "promotion_id",
        F.when(
            F.col("is_injected_bad_record"),
            -F.greatest(
                F.lit(1),
                F.least(F.col("latent_demand_units"), F.col("valid_available_units")),
            ),
        )
        .otherwise(F.least(F.col("latent_demand_units"), F.col("valid_available_units")))
        .cast("int")
        .alias("units_sold"),
        F.round(F.col("list_price") * (1 - F.coalesce("discount_pct", F.lit(0.0))), 2).alias("unit_price"),
        F.round(
            F.least(F.col("latent_demand_units"), F.col("valid_available_units"))
            * F.col("list_price")
            * (1 - F.coalesce(F.col("discount_pct"), F.lit(0.0))),
            2,
        ).alias("gross_revenue"),
        F.greatest(F.col("latent_demand_units") - F.col("valid_available_units"), F.lit(0)).cast("int").alias("lost_sales_units"),
        "is_injected_bad_record", F.when(F.col("is_injected_bad_record"), "NEGATIVE_UNITS").otherwise("VALID").alias("source_record_status"),
    )
    inventory = common.select(
        _id(F, "INV-", F.col("day_idx") * cfg.stores * cfg.products + F.col("store_idx") * cfg.products + F.col("product_idx") + 1, 9).alias("inventory_record_id"),
        "date", "source_month", "source_batch_id", "store_id", "sku_id",
        F.when(
            F.col("is_injected_bad_record"),
            -F.greatest(F.lit(1), F.col("valid_available_units")),
        )
        .otherwise(F.col("valid_available_units"))
        .cast("int")
        .alias("on_hand_units"),
        F.round(F.col("true_baseline_units") * 3.0 + 6).cast("int").alias("safety_stock_units"),
        F.when(F.col("incident_code") == "SOUTHEAST_LAUNDRY_STOCKOUT", 0)
         .otherwise(F.round(F.col("true_baseline_units") * 0.55)).cast("int").alias("inbound_units"),
        (F.col("valid_available_units") < F.col("latent_demand_units")).alias("stockout_risk_flag"),
        "is_injected_bad_record", F.when(F.col("is_injected_bad_record"), "NEGATIVE_ON_HAND").otherwise("VALID").alias("source_record_status"),
    )
    return sales, inventory


def build_shipments(spark, cfg: GenerationConfig, products, stores, calendar):
    from pyspark.sql import functions as F

    rows = spark.range(cfg.shipments, numPartitions=8).select(
        F.col("id").cast("int").alias("shipment_idx"),
        F.pmod(F.col("id") * 17, F.lit(cfg.stores)).cast("int").alias("store_idx"),
        F.pmod(F.col("id") * 7 + F.floor(F.col("id") / cfg.stores), F.lit(cfg.products)).cast("int").alias("product_idx"),
        F.pmod(F.col("id") * 13 + _bucket(F, cfg.seed + 20, F.col("id"), modulus=19), F.lit(cfg.days)).cast("int").alias("day_idx"),
    ).join(stores.select("store_idx", "store_id", "serving_dc_idx"), "store_idx").join(
        products.select("product_idx", "sku_id", "demand_weight"), "product_idx"
    ).join(calendar.select("day_idx", "date", "source_month", "source_batch_id"), "day_idx")
    delay = F.when((F.col("day_idx").between(492, 505)) & (F.col("serving_dc_idx") == 1), 5) \
        .otherwise(F.when(_bucket(F, cfg.seed + 21, "shipment_idx", modulus=100) < 9,
                          1 + _bucket(F, cfg.seed + 22, "shipment_idx", modulus=4)).otherwise(0))
    qty = F.round(18 + F.col("demand_weight") * (8 + _bucket(F, cfg.seed + 23, "shipment_idx", modulus=1200) / 100)).cast("int")
    return rows.select(
        _id(F, "SHIP-", F.col("shipment_idx") + 1, 7).alias("shipment_id"), "source_month", "source_batch_id",
        _id(F, "DC-", F.col("serving_dc_idx") + 1, 2).alias("dc_id"), "store_id", "sku_id",
        F.date_sub("date", 3).alias("order_date"), F.col("date").alias("planned_delivery_date"),
        F.date_add("date", delay.cast("int")).alias("actual_delivery_date"), qty.alias("quantity_units"),
        delay.cast("int").alias("delay_days"), F.when(delay > 0, "DELAYED").otherwise("DELIVERED").alias("shipment_status"),
    )


def build_synthetic_truth(promotions):
    from pyspark.sql import functions as F

    mechanic = F.when(F.col("mechanic") == "FEATURE_DISPLAY", 0.34).when(F.col("mechanic") == "DISPLAY", 0.18).otherwise(0.05)
    uplift = F.col("discount_pct") * 2.75 + mechanic
    return promotions.select(
        "promotion_id", "sku_id", "cluster_id", "incident_code",
        F.round(uplift, 4).alias("true_uplift_rate"),
        F.round(900 * uplift).cast("int").alias("true_incremental_units_unconstrained"),
        (F.col("synthetic_profile") == "SUPPLY_CONSTRAINED").alias("true_supply_constrained_flag"),
        (F.col("synthetic_profile") == "MARGIN_DESTRUCTIVE").alias("true_margin_destructive_flag"),
        F.when(F.col("synthetic_profile") == "SUPPLY_CONSTRAINED", "SUCCESSFUL_DEMAND_CONSTRAINED_SUPPLY")
         .when(F.col("synthetic_profile") == "MARGIN_DESTRUCTIVE", "VOLUME_SUCCESS_MARGIN_FAILURE")
         .when(F.col("synthetic_profile").isin("INEFFECTIVE", "POST_PROMOTION_EXCESS"), "INEFFECTIVE")
         .otherwise("PROFITABLE").alias("true_outcome"),
        F.lit("Synthetic ground truth; never exposed as a model feature").alias("usage_warning"),
    )


def build_portfolio_validation(sales, stores, products, promotions):
    """Reproduce Gold economics and return a one-row portfolio acceptance gate.

    This intentionally mirrors ``promotion_performance`` rather than trusting the
    generator's labels. Invalid injected sales are excluded as they are by Silver.
    """
    from pyspark.sql import functions as F

    valid_sales = sales.filter(~F.col("is_injected_bad_record")).join(
        stores.select("store_id", "cluster_idx"), "store_id"
    )
    baseline = valid_sales.filter(F.col("promotion_id").isNull()).groupBy(
        "sku_id", "cluster_idx"
    ).agg(F.avg("units_sold").alias("baseline_units_per_store_day"))
    actuals = promotions.alias("p").join(
        stores.select("store_id", "cluster_idx").alias("st"), "cluster_idx"
    ).join(
        valid_sales.alias("s"),
        (F.col("s.promotion_id") == F.col("p.promotion_id"))
        & (F.col("s.store_id") == F.col("st.store_id")),
        "left",
    ).groupBy(
        "p.promotion_id", "p.sku_id", "p.cluster_idx", "p.start_date", "p.end_date",
        "p.discount_pct", "p.synthetic_profile",
    ).agg(
        F.countDistinct("st.store_id").alias("participating_stores"),
        F.sum("s.units_sold").alias("actual_units"),
        F.sum("s.lost_sales_units").alias("lost_sales_units"),
    )
    economics = actuals.join(baseline, ["sku_id", "cluster_idx"]).join(
        products.select("sku_id", "list_price", "standard_cost"), "sku_id"
    ).withColumn(
        "baseline_units",
        F.col("baseline_units_per_store_day") * F.col("participating_stores")
        * (F.datediff("end_date", "start_date") + 1),
    ).withColumn(
        "incremental_units", F.col("actual_units") - F.col("baseline_units")
    ).withColumn(
        "incremental_margin",
        F.col("incremental_units") * (F.col("list_price") - F.col("standard_cost"))
        - F.col("actual_units") * F.col("list_price") * F.col("discount_pct"),
    ).withColumn(
        "computed_classification",
        F.when(
            (F.col("incremental_margin") > 0) & (F.col("lost_sales_units") == 0),
            "SUCCESSFUL_AND_AVAILABLE",
        ).when(
            F.col("incremental_margin") > 0,
            "COMMERCIALLY_SUCCESSFUL_SUPPLY_CONSTRAINED",
        ).when(
            F.col("incremental_units") > 0,
            "VOLUME_GAIN_MARGIN_FAILURE",
        ).otherwise("UNDERPERFORMING"),
    ).withColumn(
        "expected_classification",
        F.when(
            F.col("synthetic_profile").isin("PROFITABLE", "TRANSFER_RESCUE"),
            "SUCCESSFUL_AND_AVAILABLE",
        ).when(
            F.col("synthetic_profile") == "SUPPLY_CONSTRAINED",
            "COMMERCIALLY_SUCCESSFUL_SUPPLY_CONSTRAINED",
        ).when(
            F.col("synthetic_profile") == "MARGIN_DESTRUCTIVE",
            "VOLUME_GAIN_MARGIN_FAILURE",
        ).otherwise("UNDERPERFORMING"),
    )
    portfolio = economics.agg(
        F.count("*").alias("promotion_count"),
        F.avg((F.col("computed_classification") == "SUCCESSFUL_AND_AVAILABLE").cast("double")).alias("successful_available_pct"),
        F.avg((F.col("computed_classification") == "COMMERCIALLY_SUCCESSFUL_SUPPLY_CONSTRAINED").cast("double")).alias("supply_constrained_pct"),
        F.avg((F.col("computed_classification") == "UNDERPERFORMING").cast("double")).alias("underperforming_pct"),
        F.avg((F.col("computed_classification") == "VOLUME_GAIN_MARGIN_FAILURE").cast("double")).alias("margin_failure_pct"),
        F.avg((F.col("computed_classification") == F.col("expected_classification")).cast("double")).alias("profile_economics_agreement_pct"),
    )
    monthly = economics.groupBy(F.date_format("start_date", "yyyy-MM").alias("month")).agg(
        F.sum("incremental_margin").alias("monthly_incremental_margin")
    ).agg(
        F.count("*").alias("observed_months"),
        F.sum((F.col("monthly_incremental_margin") > 0).cast("int")).alias("positive_margin_months"),
        F.sum((F.col("monthly_incremental_margin") < 0).cast("int")).alias("negative_margin_months"),
    )
    summary = portfolio.crossJoin(monthly).withColumn(
        "validation_passed",
        F.col("successful_available_pct").between(
            *PORTFOLIO_TARGET_RANGES["successful_available_pct"]
        )
        & F.col("supply_constrained_pct").between(
            *PORTFOLIO_TARGET_RANGES["supply_constrained_pct"]
        )
        & F.col("underperforming_pct").between(
            *PORTFOLIO_TARGET_RANGES["underperforming_pct"]
        )
        & F.col("margin_failure_pct").between(
            *PORTFOLIO_TARGET_RANGES["margin_failure_pct"]
        )
        & (F.col("profile_economics_agreement_pct") >= 0.90)
        & (F.col("positive_margin_months") > F.col("observed_months") / 2)
        & (F.col("negative_margin_months") >= 1),
    )
    return economics, summary


def _write(df, path: str, *, fmt: str = "parquet", partition_by: str | None = None):
    writer = df.write.mode("overwrite")
    if partition_by:
        writer = writer.partitionBy(partition_by)
    writer.format(fmt).save(path)


def generate(spark, cfg: GenerationConfig) -> None:
    """Create infrastructure, then write masters before dependent facts."""
    catalog = validate_identifier(cfg.catalog)
    schema = validate_identifier(cfg.schema)
    volume = validate_identifier(cfg.volume)
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}`")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS `{catalog}`.`{schema}`.`{volume}`")

    products = build_products(spark, cfg)
    clusters = build_clusters(spark, cfg)
    stores = build_stores(spark, cfg)
    dcs = build_distribution_centers(spark, cfg)
    calendar = build_calendar(spark, cfg)
    event_calendar = build_cpg_event_calendar(spark, cfg)
    forward_supply_plan = build_forward_supply_plan(
        spark, cfg, event_calendar, products, clusters
    )
    imported_promotion_plans = build_imported_promotion_plans(
        spark, cfg, event_calendar, products, clusters
    )
    costs = build_costs(spark, cfg, products)
    promotions = build_promotions(spark, cfg, products, clusters)
    sales, inventory = build_daily_facts(spark, cfg, products, stores, clusters, calendar, promotions)
    shipments = build_shipments(spark, cfg, products, stores, calendar)
    truth = build_synthetic_truth(promotions)

    economics, validation = build_portfolio_validation(sales, stores, products, promotions)
    validation.show(truncate=False)
    if validation.filter("NOT validation_passed").count():
        raise ValueError(
            "Generated promotion portfolio failed economics/distribution acceptance gates"
        )

    for name, df, fmt in (
        ("products", products, "json"), ("store_clusters", clusters, "json"),
        ("stores", stores, "json"), ("distribution_centers", dcs, "json"),
        ("calendar", calendar, "parquet"), ("cpg_event_calendar", event_calendar, "json"),
        ("forward_supply_plan", forward_supply_plan, "json"),
        ("imported_promotion_plans", imported_promotion_plans, "json"),
        ("product_costs", costs, "parquet"),
    ):
        _write(df, f"{cfg.base_path}/{name}", fmt=fmt)
    _write(promotions, f"{cfg.base_path}/promotions", partition_by="source_month")
    _write(sales, f"{cfg.base_path}/pos_sales", partition_by="source_month")
    _write(inventory, f"{cfg.base_path}/inventory_snapshots", partition_by="source_month")
    _write(shipments, f"{cfg.base_path}/shipments", partition_by="source_month")
    _write(truth, f"{cfg.base_path}/synthetic_truth")
    _write(validation, f"{cfg.base_path}/_portfolio_validation", fmt="json")
    _write(economics, f"{cfg.base_path}/_promotion_economics_validation")

    # Re-read physical landing outputs so observed counts/fingerprints describe
    # what was actually committed rather than only the upstream logical plans.
    dataset_formats = (
        ("products", "json"), ("store_clusters", "json"), ("stores", "json"),
        ("distribution_centers", "json"), ("calendar", "parquet"),
        ("cpg_event_calendar", "json"), ("forward_supply_plan", "json"),
        ("imported_promotion_plans", "json"),
        ("product_costs", "parquet"), ("promotions", "parquet"),
        ("pos_sales", "parquet"), ("inventory_snapshots", "parquet"),
        ("shipments", "parquet"), ("synthetic_truth", "parquet"),
    )
    landed = [
        (name, f"{cfg.base_path}/{name}", spark.read.format(fmt).load(f"{cfg.base_path}/{name}"))
        for name, fmt in dataset_formats
    ]
    expected = expected_dataset_rows(
        days=cfg.days, stores=cfg.stores, products=cfg.products,
        clusters=cfg.clusters, distribution_centers=cfg.distribution_centers,
        promotions=cfg.promotions, shipments=cfg.shipments,
    )
    manifest = build_generation_manifest(
        landed, expected_rows=expected, seed=cfg.seed,
        demo_as_of_date=cfg.demo_as_of_date.isoformat(),
        history_start_date=cfg.start_date.isoformat(),
        history_end_date=cfg.history_end_date.isoformat(),
    )
    _write(manifest, f"{cfg.base_path}/_generation_manifest", fmt="json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default="promoflow")
    parser.add_argument("--raw-schema", "--schema", dest="schema", default="promoflow_raw")
    parser.add_argument("--raw-volume", "--volume", dest="volume", default="landing")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--inject-bad-data", choices=("true", "false"), default="true")
    parser.add_argument("--bad-data-rate", type=float, default=0.005)
    parser.add_argument("--profile", default="febar")
    args = parser.parse_args()
    if not 0 <= args.bad_data_rate <= 1:
        parser.error("--bad-data-rate must be between 0 and 1")

    if os.getenv("DATABRICKS_RUNTIME_VERSION"):
        from pyspark.sql import SparkSession

        spark = SparkSession.builder.getOrCreate()
    else:
        from databricks.connect import DatabricksSession

        spark = DatabricksSession.builder.profile(args.profile).serverless(True).getOrCreate()

    bad_data_basis_points = (
        round(args.bad_data_rate * 10_000) if args.inject_bad_data == "true" else 0
    )
    generate(
        spark,
        GenerationConfig(
            catalog=args.catalog,
            schema=args.schema,
            volume=args.volume,
            seed=args.seed,
            bad_data_basis_points=bad_data_basis_points,
        ),
    )


if __name__ == "__main__":
    main()
