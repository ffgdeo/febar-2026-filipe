# Databricks notebook source
# MAGIC %md
# MAGIC # PromoFlow promotion-aware demand model
# MAGIC
# MAGIC This notebook trains a demand model on historical Cleany observations,
# MAGIC compares it with a seasonal baseline, registers the winning artifact in
# MAGIC Unity Catalog, assigns the `@prod` alias, and batch-scores proposed
# MAGIC promotions. The difference between promotion-on and promotion-off scores
# MAGIC is a **modeled uplift**, not a causal treatment-effect estimate.

# COMMAND ----------

# ruff: noqa: F821

from __future__ import annotations

import json
from datetime import datetime, timezone

import mlflow
import mlflow.sklearn
import numpy as np
import optuna
import pandas as pd
from mlflow.models import infer_signature
from mlflow.tracking import MlflowClient
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBRegressor

try:
    from metrics import regression_metrics
except ImportError:
    from src.ml.metrics import regression_metrics


PARAMETERS = {
    "catalog": "promoflow",
    "feature_schema": "promoflow_silver",
    "feature_table": "promotion_training_features",
    "scoring_table": "promotion_candidates",
    "model_schema": "promoflow_ml",
    "model_name": "promotion_demand_model",
    "output_schema": "promoflow_gold",
    "output_table": "promotion_demand_predictions",
    "experiment_path": "/Users/filipe.deo@databricks.com/promoflow-ai-promotion-demand",
    "trials": "10",
}
for parameter, default in PARAMETERS.items():
    dbutils.widgets.text(parameter, default)
params = {name: dbutils.widgets.get(name).strip() for name in PARAMETERS}

CATALOG = params["catalog"]
TRAINING_TABLE = f"{CATALOG}.{params['feature_schema']}.{params['feature_table']}"
SCORING_TABLE = f"{CATALOG}.{params['feature_schema']}.{params['scoring_table']}"
MODEL_NAME = f"{CATALOG}.{params['model_schema']}.{params['model_name']}"
OUTPUT_TABLE = f"{CATALOG}.{params['output_schema']}.{params['output_table']}"
N_TRIALS = int(params["trials"])

if N_TRIALS < 1 or N_TRIALS > 50:
    raise ValueError("trials must be between 1 and 50")

spark.sql(
    f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{params['model_schema']} "
    "COMMENT 'Governed Unity Catalog models for PromoFlow promotion planning'"
)

# COMMAND ----------
# MAGIC %md
# MAGIC ## Load and validate features
# MAGIC
# MAGIC The pipeline contract is parameterized because the Silver pipeline is an
# MAGIC independent deployable. Aliases below tolerate common naming differences,
# MAGIC while ambiguous or missing business keys fail loudly.

# COMMAND ----------


def resolve_column(columns: set[str], role: str, candidates: tuple[str, ...]) -> str:
    found = [candidate for candidate in candidates if candidate in columns]
    if not found:
        raise ValueError(f"{TRAINING_TABLE} lacks {role}; expected one of {candidates}")
    return found[0]


training_sdf = spark.table(TRAINING_TABLE)
training_columns = set(training_sdf.columns)
date_col = resolve_column(training_columns, "observation date", ("observation_date", "sales_date", "date"))
target_col = resolve_column(training_columns, "unit-demand label", ("units_sold", "demand_units", "units"))
sku_col = resolve_column(training_columns, "SKU key", ("sku_id", "product_id"))
cluster_col = resolve_column(training_columns, "store-cluster key", ("cluster_id", "store_cluster_id"))

categorical_candidates = (
    sku_col,
    cluster_col,
    "promotion_mechanic",
    "category",
    "store_format",
    "day_of_week",
)
numeric_candidates = (
    "discount_pct",
    "display_flag",
    "feature_flag",
    "list_price",
    "selling_price",
    "standard_cost",
    "month",
    "week_of_year",
    "holiday_flag",
    "lag_7_units",
    "lag_14_units",
    "rolling_28_avg_units",
    "inventory_on_hand",
    "store_demand_index",
    "price_elasticity",
)
categorical_features = list(dict.fromkeys(c for c in categorical_candidates if c in training_columns))
numeric_features = [c for c in numeric_candidates if c in training_columns]
feature_columns = categorical_features + numeric_features
if len(feature_columns) < 4:
    raise ValueError(
        f"Only {feature_columns} are available; at least four demand features are required"
    )

selected = list(dict.fromkeys([date_col, target_col, sku_col, cluster_col] + feature_columns))
training_pdf = training_sdf.select(*selected).dropna(subset=[date_col, target_col]).toPandas()
if len(training_pdf) < 200:
    raise ValueError(f"Training requires at least 200 observations, found {len(training_pdf)}")
if len(training_pdf) > 1_000_000:
    raise ValueError("Training input exceeds the guarded one-million-row driver limit")

training_pdf[date_col] = pd.to_datetime(training_pdf[date_col])
training_pdf = training_pdf.sort_values(date_col).reset_index(drop=True)
for column in categorical_features:
    training_pdf[column] = training_pdf[column].fillna("UNKNOWN").astype(str)
for column in numeric_features:
    training_pdf[column] = pd.to_numeric(training_pdf[column], errors="coerce").fillna(0.0)
training_pdf[target_col] = pd.to_numeric(training_pdf[target_col], errors="raise").clip(lower=0.0)

dates = np.sort(training_pdf[date_col].dt.normalize().unique())
if len(dates) < 30:
    raise ValueError("A time-based evaluation requires at least 30 distinct dates")
train_boundary = dates[max(1, int(len(dates) * 0.70)) - 1]
validation_boundary = dates[max(2, int(len(dates) * 0.85)) - 1]
train_pdf = training_pdf[training_pdf[date_col].dt.normalize() <= train_boundary].copy()
validation_pdf = training_pdf[
    (training_pdf[date_col].dt.normalize() > train_boundary)
    & (training_pdf[date_col].dt.normalize() <= validation_boundary)
].copy()
test_pdf = training_pdf[training_pdf[date_col].dt.normalize() > validation_boundary].copy()
if min(len(train_pdf), len(validation_pdf), len(test_pdf)) == 0:
    raise ValueError("Time split produced an empty train, validation, or test partition")

X_train, y_train = train_pdf[feature_columns], train_pdf[target_col]
X_validation, y_validation = validation_pdf[feature_columns], validation_pdf[target_col]
X_test, y_test = test_pdf[feature_columns], test_pdf[target_col]

# COMMAND ----------
# MAGIC %md
# MAGIC ## Seasonal baseline and tuned model

# COMMAND ----------

baseline_keys = [sku_col, cluster_col]
if "day_of_week" in feature_columns:
    baseline_keys.append("day_of_week")
baseline_lookup = train_pdf.groupby(baseline_keys, dropna=False)[target_col].median()
global_median = float(train_pdf[target_col].median())


def baseline_predict(frame: pd.DataFrame) -> np.ndarray:
    index = pd.MultiIndex.from_frame(frame[baseline_keys]) if len(baseline_keys) > 1 else frame[baseline_keys[0]]
    values = baseline_lookup.reindex(index).to_numpy(dtype=float)
    return np.nan_to_num(values, nan=global_median)


baseline_validation_metrics = regression_metrics(y_validation, baseline_predict(validation_pdf))
baseline_test_metrics = regression_metrics(y_test, baseline_predict(test_pdf))

preprocessor = ColumnTransformer(
    transformers=[
        ("categories", OneHotEncoder(handle_unknown="ignore"), categorical_features),
        ("numbers", "passthrough", numeric_features),
    ],
    remainder="drop",
)

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(params["experiment_path"])
optuna.logging.set_verbosity(optuna.logging.WARNING)


def build_model(model_params: dict) -> Pipeline:
    return Pipeline(
        steps=[
            ("prepare", preprocessor),
            (
                "regressor",
                XGBRegressor(
                    objective="reg:squarederror",
                    random_state=2026,
                    n_jobs=-1,
                    **model_params,
                ),
            ),
        ]
    )


with mlflow.start_run(run_name="promotion-demand-hpo") as parent_run:
    mlflow.log_params(
        {
            "training_table": TRAINING_TABLE,
            "time_split_train_end": str(pd.Timestamp(train_boundary).date()),
            "time_split_validation_end": str(pd.Timestamp(validation_boundary).date()),
            "feature_count": len(feature_columns),
            "uplift_interpretation": "modeled_not_causal",
        }
    )
    mlflow.log_metrics({f"baseline_validation_{k}": v for k, v in baseline_validation_metrics.items()})

    def objective(trial: optuna.Trial) -> float:
        trial_params = {
            "n_estimators": trial.suggest_int("n_estimators", 150, 450, step=50),
            "max_depth": trial.suggest_int("max_depth", 3, 8),
            "learning_rate": trial.suggest_float("learning_rate", 0.02, 0.20, log=True),
            "subsample": trial.suggest_float("subsample", 0.70, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.70, 1.0),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 8),
        }
        with mlflow.start_run(run_name=f"trial-{trial.number:02d}", nested=True):
            trial_model = build_model(trial_params).fit(X_train, y_train)
            trial_metrics = regression_metrics(y_validation, trial_model.predict(X_validation))
            mlflow.log_params(trial_params)
            mlflow.log_metrics({f"validation_{k}": v for k, v in trial_metrics.items()})
        return trial_metrics["wape"]

    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=2026))
    study.optimize(objective, n_trials=N_TRIALS)
    mlflow.log_metric("best_validation_wape", float(study.best_value))
    hpo_parent_run_id = parent_run.info.run_id

# Retrain the selected hyperparameters on train + validation, then perform the
# one untouched test evaluation used for the promotion gate.
train_validation_pdf = pd.concat([train_pdf, validation_pdf], ignore_index=True)
final_model = build_model(study.best_params).fit(
    train_validation_pdf[feature_columns], train_validation_pdf[target_col]
)
test_predictions = np.maximum(final_model.predict(X_test), 0.0)
model_test_metrics = regression_metrics(y_test, test_predictions)
if model_test_metrics["wape"] >= baseline_test_metrics["wape"]:
    raise RuntimeError(
        "Promotion gate failed: model test WAPE "
        f"{model_test_metrics['wape']:.4f} did not beat baseline "
        f"{baseline_test_metrics['wape']:.4f}"
    )

# COMMAND ----------
# MAGIC %md
# MAGIC ## Register in Unity Catalog and assign `@prod`

# COMMAND ----------

with mlflow.start_run(run_name="promotion-demand-selected") as selected_run:
    mlflow.log_params(study.best_params)
    mlflow.log_params(
        {
            "training_rows": len(train_validation_pdf),
            "test_rows": len(test_pdf),
            "features": json.dumps(feature_columns),
            "hpo_parent_run_id": hpo_parent_run_id,
            "promotion_gate": "model_wape_lt_seasonal_baseline",
        }
    )
    mlflow.log_metrics({f"test_{k}": v for k, v in model_test_metrics.items()})
    mlflow.log_metrics({f"baseline_test_{k}": v for k, v in baseline_test_metrics.items()})
    input_example = train_validation_pdf[feature_columns].head(5)
    signature = infer_signature(input_example, final_model.predict(input_example))
    model_info = mlflow.sklearn.log_model(
        sk_model=final_model,
        name="model",
        signature=signature,
        input_example=input_example,
    )
    selected_run_id = selected_run.info.run_id

registered = mlflow.register_model(model_uri=model_info.model_uri, name=MODEL_NAME, await_registration_for=300)
model_version = str(registered.version)
client = MlflowClient(registry_uri="databricks-uc")
client.set_registered_model_alias(MODEL_NAME, "prod", model_version)
client.set_model_version_tag(MODEL_NAME, model_version, "uplift_interpretation", "modeled_not_causal")

# COMMAND ----------
# MAGIC %md
# MAGIC ## Batch-score proposed promotions into Gold

# COMMAND ----------

scoring_sdf = spark.table(SCORING_TABLE)
missing_features = sorted(set(feature_columns) - set(scoring_sdf.columns))
if missing_features:
    raise ValueError(f"{SCORING_TABLE} lacks model features: {missing_features}")

identifier_candidates = [
    c for c in ("scenario_id", "promotion_id", sku_col, cluster_col, "start_date", "end_date")
    if c in scoring_sdf.columns
]
scoring_pdf = scoring_sdf.select(*list(dict.fromkeys(identifier_candidates + feature_columns))).toPandas()
if scoring_pdf.empty:
    raise ValueError(f"{SCORING_TABLE} contains no promotion candidates")
for column in categorical_features:
    scoring_pdf[column] = scoring_pdf[column].fillna("UNKNOWN").astype(str)
for column in numeric_features:
    scoring_pdf[column] = pd.to_numeric(scoring_pdf[column], errors="coerce").fillna(0.0)

# Load through the movable alias so batch scoring proves that downstream users
# consume the exact registered artifact, rather than an in-memory lookalike.
production_model = mlflow.pyfunc.load_model(f"models:/{MODEL_NAME}@prod")
promotion_units = np.maximum(
    np.asarray(production_model.predict(scoring_pdf[feature_columns])).reshape(-1), 0.0
)
counterfactual_pdf = scoring_pdf[feature_columns].copy()
if "discount_pct" in counterfactual_pdf:
    counterfactual_pdf["discount_pct"] = 0.0
if "promotion_mechanic" in counterfactual_pdf:
    counterfactual_pdf["promotion_mechanic"] = "NONE"
for flag in ("display_flag", "feature_flag"):
    if flag in counterfactual_pdf:
        counterfactual_pdf[flag] = 0.0
if "selling_price" in counterfactual_pdf and "list_price" in counterfactual_pdf:
    counterfactual_pdf["selling_price"] = counterfactual_pdf["list_price"]
baseline_units = np.maximum(
    np.asarray(production_model.predict(counterfactual_pdf)).reshape(-1), 0.0
)

output_pdf = scoring_pdf[identifier_candidates].copy()
output_pdf["predicted_promotion_units"] = promotion_units
output_pdf["predicted_baseline_units"] = baseline_units
output_pdf["modeled_uplift_units"] = promotion_units - baseline_units
output_pdf["modeled_uplift_pct"] = np.where(
    baseline_units > 0,
    (promotion_units - baseline_units) / baseline_units,
    np.nan,
)
output_pdf["model_name"] = MODEL_NAME
output_pdf["model_version"] = model_version
output_pdf["mlflow_run_id"] = selected_run_id
output_pdf["uplift_interpretation"] = "modeled_not_causal"
output_pdf["scored_at_utc"] = datetime.now(timezone.utc).replace(tzinfo=None)

spark.createDataFrame(output_pdf).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    OUTPUT_TABLE
)

result = {
    "status": "SUCCESS",
    "training_table": TRAINING_TABLE,
    "scoring_table": SCORING_TABLE,
    "output_table": OUTPUT_TABLE,
    "mlflow_run_id": selected_run_id,
    "hpo_parent_run_id": hpo_parent_run_id,
    "registered_model": MODEL_NAME,
    "model_version": model_version,
    "model_alias": "prod",
    "metrics": {
        "model_test": model_test_metrics,
        "seasonal_baseline_test": baseline_test_metrics,
    },
    "rows": {
        "train_validation": int(len(train_validation_pdf)),
        "test": int(len(test_pdf)),
        "scored": int(len(output_pdf)),
    },
    "uplift_interpretation": "modeled_not_causal",
}
dbutils.notebook.exit(json.dumps(result, sort_keys=True))
