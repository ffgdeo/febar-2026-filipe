"""Pure regression metrics used by the PromoFlow training notebook."""

from __future__ import annotations

import numpy as np


def _arrays(actual, predicted) -> tuple[np.ndarray, np.ndarray]:
    """Return validated, finite one-dimensional float arrays."""
    y_true = np.asarray(actual, dtype=float).reshape(-1)
    y_pred = np.asarray(predicted, dtype=float).reshape(-1)
    if y_true.size == 0:
        raise ValueError("metrics require at least one observation")
    if y_true.shape != y_pred.shape:
        raise ValueError("actual and predicted must have the same shape")
    if not (np.isfinite(y_true).all() and np.isfinite(y_pred).all()):
        raise ValueError("actual and predicted must contain only finite values")
    return y_true, y_pred


def mae(actual, predicted) -> float:
    """Mean absolute error in units."""
    y_true, y_pred = _arrays(actual, predicted)
    return float(np.mean(np.abs(y_true - y_pred)))


def wape(actual, predicted) -> float:
    """Weighted absolute percentage error.

    The denominator uses absolute actuals so this remains well-defined for any
    signed target. A zero aggregate actual is intentionally rejected rather
    than silently returning a misleading percentage.
    """
    y_true, y_pred = _arrays(actual, predicted)
    denominator = float(np.sum(np.abs(y_true)))
    if denominator == 0:
        raise ValueError("WAPE is undefined when all actual values are zero")
    return float(np.sum(np.abs(y_true - y_pred)) / denominator)


def bias(actual, predicted) -> float:
    """Signed forecast bias in units; positive means over-forecasting."""
    y_true, y_pred = _arrays(actual, predicted)
    return float(np.mean(y_pred - y_true))


def regression_metrics(actual, predicted) -> dict[str, float]:
    """Return the standard evaluator-facing metric set."""
    return {
        "wape": wape(actual, predicted),
        "mae": mae(actual, predicted),
        "bias": bias(actual, predicted),
    }
