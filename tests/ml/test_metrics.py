import numpy as np
import pytest

from ml.metrics import bias, mae, regression_metrics, wape


def test_regression_metrics_known_values():
    actual = [100, 200, 300]
    predicted = [110, 180, 330]

    assert mae(actual, predicted) == pytest.approx(20.0)
    assert wape(actual, predicted) == pytest.approx(60 / 600)
    assert bias(actual, predicted) == pytest.approx(20 / 3)


def test_bias_sign_is_positive_for_over_forecast():
    assert bias([10, 20], [12, 24]) == pytest.approx(3.0)
    assert bias([10, 20], [8, 16]) == pytest.approx(-3.0)


def test_metrics_accept_numpy_arrays():
    result = regression_metrics(np.array([1, 2]), np.array([1, 4]))
    assert result == pytest.approx({"wape": 2 / 3, "mae": 1.0, "bias": 1.0})


@pytest.mark.parametrize(
    ("actual", "predicted", "message"),
    [
        ([], [], "at least one"),
        ([1], [1, 2], "same shape"),
        ([0, 0], [1, 2], "undefined"),
        ([1, np.nan], [1, 2], "finite"),
    ],
)
def test_invalid_inputs_raise(actual, predicted, message):
    function = wape if "undefined" in message else regression_metrics
    with pytest.raises(ValueError, match=message):
        function(actual, predicted)
