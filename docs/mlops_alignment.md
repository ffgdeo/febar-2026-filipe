# Pragmatic MLOps alignment

PromoFlow adopts the production patterns that improve trust without importing the full
MLOps Quickstart framework into a time-boxed FE BAR prototype.

## Implemented now

- Deterministic synthetic-data seed, row-count checks, schema hashes, and aggregate data
  fingerprints.
- Versioned, leakage-safe feature and scoring contracts in Unity Catalog.
- Time-based train, validation, and test splits rather than random splitting.
- Seasonal-baseline comparison and an automated promotion gate: candidate WAPE must be
  lower than baseline WAPE.
- Nested MLflow runs for Optuna trials and a separate selected-model run.
- Model signature, input example, test metrics, parameters, and feature list logged to
  MLflow.
- Unity Catalog model registration and a mutable `@prod` alias.
- Batch scoring loads the registered alias rather than the in-memory training object.
- Explicit statement that predicted uplift is modeled, not causal.

## Pattern applicability and evidence

| MLOps Quickstart pattern | PromoFlow decision | Repository or execution evidence |
|---|---|---|
| Reproducible environment | Adopted | Environment v4 and exact MLflow, scikit-learn, XGBoost, Optuna, and pandas versions are pinned in `resources/ml_training.job.yml`. |
| Governed training contract | Adopted at prototype depth | The job parameterizes the three-part Silver input, validates business keys and feature availability, rejects fewer than 200 observations, and guards driver collection at one million rows. |
| Leakage-resistant evaluation | Adopted | `src/ml/train_and_score.py` uses ordered 70/15/15 date windows; the test window is untouched by hyperparameter selection. |
| Candidate versus baseline gate | Adopted | The job fails before registration unless candidate test WAPE is lower than the seasonal median baseline. Refreshed run `920752452002781` passed: 0.0919 versus 0.1903 WAPE. |
| Experiment hierarchy | Adopted | HPO parent run `47007a6e4968469dbf97b1b9487577cb` owns nested Optuna trials; selected run `af9271fbd09844dc9e5cf5474d8449be` records the final parameters and holdout metrics. |
| Governed model registry | Adopted | UC model `promoflow.promoflow_ml.promotion_demand_model`, version 2, is `READY` and addressed through `@prod`; scoring reloads that registered alias. |
| Traceable batch output | Adopted | Gold scores retain model name, version, MLflow run ID, scoring time, and the `modeled_not_causal` interpretation marker. The refreshed run wrote 1,196 rows. |
| Human approval before production promotion | Deferred | Appropriate for a production Cleany rollout; this time-boxed prototype applies the alias automatically only after its quantitative gate. |
| Drift monitoring and retraining triggers | Deferred | Requires post-launch observations and agreed segment-level thresholds; it would be artificial in a synthetic, one-run demonstration. |
| Full CI/CD framework import | Not applicable | The FE BAR evaluates one integrated customer journey. Importing the entire Quickstart framework would add deployment machinery without improving this prototype's decision quality. |

The executed values and stable identifiers above are transcribed in
`docs/execution_evidence/03_ml_training.md`. They are readable submission evidence rather
than claims inferred from source code.

## Audit observations

- The current run is reproducible at the code, dependency, feature-contract, split-boundary,
  parameter, and synthetic-seed levels. A production run should additionally pin the exact
  Delta table version (or commit timestamp) as an MLflow dataset input so rebuilding a model
  never depends on whichever table snapshot is current.
- Aggregate holdout metrics are sufficient for the prototype gate. Production approval must
  also evaluate WAPE and bias by SKU, category, cluster, and promotion mechanic to prevent a
  strong aggregate from hiding a weak business segment.
- `@prod` is deliberately mutable. Every Gold prediction therefore records the immutable
  model version and run ID, preserving auditability after the alias advances.
- The successful execution proves registration and batch consumption of the same artifact;
  no real-time endpoint is warranted because Cleany's scenarios are prepared in batches and
  served operationally from Lakebase.

## Productionization path

For a production Cleany rollout, split training, validation, approval, and deployment into
separate jobs; add model-owner approval before alias promotion; evaluate performance by SKU,
category, region, and promotion mechanic; monitor feature and prediction drift; retain a
champion/challenger history; and trigger retraining from governed data-quality and drift
thresholds. Those controls are documented as the next step rather than simulated in this
prototype.

## Deliberate trade-off

The prototype does not copy the complete MLOps Quickstart repository or add CI/CD components
that do not materially improve the customer demonstration. This keeps the integrated story
focused on promotion decisions and inventory action while showing a credible path from the
validated model to production operations.
