"""Spike con il modello reale (5M e, se richiesto, 28M). Saltato salvo MDT_REAL_MODEL=1.

Esempio: MDT_REAL_MODEL=1 FORECAST_MODELS=mistralai/Timestral-5M uv run pytest -m real_model
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from app.config import MODELS, QUANTILE_LEVELS
from app.engine import TimestralEngine

pytestmark = [
    pytest.mark.real_model,
    pytest.mark.skipif(os.environ.get("MDT_REAL_MODEL") != "1", reason="pesi Timestral non richiesti"),
]


@pytest.mark.parametrize("model", [m.strip() for m in os.environ.get("FORECAST_MODELS", "mistralai/Timestral-5M").split(",")])
def test_inferenza_reale_cpu(model):
    assert model in MODELS
    eng = TimestralEngine((model,))
    eng.load()
    assert eng.status(model) == "pronto", eng.status(model)
    t = np.arange(24 * 30)
    ctx = (20 + 6 * np.sin(2 * np.pi * (t - 9) / 24))[None, None, :]
    out = eng.forecast(model, ctx, 24, None, None)
    assert out.quantiles.shape == (1, 1, 24, len(QUANTILE_LEVELS))
    assert (np.diff(out.quantiles, axis=-1) >= -1e-9).all()
    # riproducibilità: stesso input, stessa revisione → stesso output
    again = eng.forecast(model, ctx, 24, None, None)
    assert np.allclose(out.quantiles, again.quantiles)
