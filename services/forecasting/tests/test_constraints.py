"""Vincolo fisico "physical_clipping_v1": funzione e API, sui tre orizzonti 24, 48 e 72 ore."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import ADAPTER_VERSION, MODELS, QUANTILE_LEVELS, Settings
from app.constraints import METHOD, apply_physical_bounds
from app.engine import EngineOutput
from app.main import create_app

TOKEN = "test-token-non-segreto"
M5 = "mistralai/Timestral-5M"
AUTH = {"authorization": f"Bearer {TOKEN}"}
LEVELS = np.array(QUANTILE_LEVELS)
HORIZONS = [24, 48, 72]


def wide_quantiles(H: int, centers: list[float], spread: float) -> np.ndarray:
    """(1, V, H, 21) ordinati; la fascia si allarga con l'orizzonte come nelle previsioni reali."""
    widen = np.linspace(1.0, 2.0, H)[None, :, None]
    return np.stack([c + (LEVELS - 0.5)[None, None, :] * spread * widen for c in centers], axis=1)[0][None]


@pytest.mark.parametrize("H", HORIZONS)
def test_sopra_100_riportati_a_100_e_sotto_0_riportati_a_0(H):
    q = wide_quantiles(H, [95.0, 5.0], spread=40.0)  # umidità alta e bassa: code oltre i limiti
    raw_over = int((q > 100).sum())
    raw_under = int((q < 0).sum())
    out, med, rep = apply_physical_bounds(q, [(0.0, 100.0), (0.0, 100.0)], ADAPTER_VERSION)
    assert out.max() <= 100 and out.min() >= 0
    assert (med >= 0).all() and (med <= 100).all()
    assert (np.diff(out, axis=-1) >= -1e-12).all()  # ordinamento conservato
    assert rep[0]["adjusted_values_count"] + rep[1]["adjusted_values_count"] == raw_over + raw_under
    assert rep[0]["maximum_raw_value"] == pytest.approx(q[0, 0].max(), abs=1e-6)
    assert rep[1]["minimum_raw_value"] == pytest.approx(q[0, 1].min(), abs=1e-6)


@pytest.mark.parametrize("H", HORIZONS)
def test_valori_validi_invariati_e_nessun_vincolo_applicato(H):
    q = wide_quantiles(H, [60.0], spread=10.0)
    out, med, rep = apply_physical_bounds(q, [(0.0, 100.0)], ADAPTER_VERSION)
    assert np.array_equal(out, q)
    assert np.array_equal(med, q[..., 10])
    assert rep[0]["physical_constraint_applied"] is False and rep[0]["adjusted_values_count"] == 0


@pytest.mark.parametrize("H", HORIZONS)
def test_altre_variabili_mai_toccate(H):
    q = wide_quantiles(H, [97.0, -3.0, 1500.0], spread=40.0)  # umidità, temperatura negativa, radiazione alta
    out, _, rep = apply_physical_bounds(q, [(0.0, 100.0), None, None], ADAPTER_VERSION)
    assert rep[1] is None and rep[2] is None
    assert np.array_equal(out[:, 1:], q[:, 1:])


def test_metadati_di_provenienza_completi():
    q = wide_quantiles(24, [98.0], spread=30.0)
    _, _, rep = apply_physical_bounds(q, [(0.0, 100.0)], ADAPTER_VERSION)
    r = rep[0]
    assert set(r) == {"physical_constraint_applied", "physical_min", "physical_max", "adjusted_values_count", "total_values", "maximum_raw_value", "minimum_raw_value", "method", "adapter_version"}
    assert r["physical_constraint_applied"] is True
    assert (r["physical_min"], r["physical_max"], r["method"], r["adapter_version"]) == (0.0, 100.0, METHOD, ADAPTER_VERSION)
    assert r["total_values"] == 24 * 21
    assert r["adjusted_values_count"] == int((q > 100).sum())


class BoundaryEngine:
    """Motore finto con umidità (variata 0) che sfora 100 e temperatura (variata 1) libera."""

    def __init__(self, spread=40.0):
        self.spread = spread

    def status(self, model):
        return "pronto"

    def forecast(self, model, context, prediction_length, past, known):
        q = wide_quantiles(prediction_length, [92.0, 12.0], self.spread)
        return EngineOutput(quantiles=q, median=q[..., 10])


def client(engine):
    return TestClient(create_app(Settings(token=TOKEN, models=(M5,)), engine))


def body(H, bounds="umidita"):
    b = {
        "schema_version": 1, "model": M5, "revision": MODELS[M5], "frequency": "1h", "prediction_length": H,
        "context": [[[70.0 + (i % 24) for i in range(200)], [10.0 + (i % 24) * 0.3 for i in range(200)]]],
    }
    if bounds == "umidita":
        b["physical_bounds"] = [[0, 100], None]
    elif bounds is not None:
        b["physical_bounds"] = bounds
    return b


@pytest.mark.parametrize("H", HORIZONS)
def test_api_nessun_valore_grezzo_fuori_limite_esce_dal_servizio(H):
    r = client(BoundaryEngine()).post("/v1/forecast", json=body(H), headers=AUTH)
    assert r.status_code == 200
    j = r.json()
    hum = np.array(j["quantiles"])[0, 0]
    assert hum.max() <= 100 and hum.min() >= 0
    assert (np.array(j["median"])[0, 0] <= 100).all()
    assert (np.diff(np.array(j["quantiles"]), axis=-1) >= -1e-9).all()
    c = j["constraints"]
    assert c[0]["physical_constraint_applied"] is True and c[0]["method"] == METHOD and c[0]["maximum_raw_value"] > 100
    assert c[1] is None
    assert j["adapter_version"] == ADAPTER_VERSION
    assert any("limiti fisici" in w for w in j["warnings"])
    # la temperatura non è vincolata: identica all'output del modello
    expected_t = wide_quantiles(H, [92.0, 12.0], 40.0)[0, 1]
    assert np.allclose(np.array(j["quantiles"])[0, 1], expected_t, atol=1e-6)


def test_api_senza_limiti_dichiarati_output_invariato():
    j = client(BoundaryEngine()).post("/v1/forecast", json=body(24, bounds=None), headers=AUTH).json()
    assert np.array(j["quantiles"])[0, 0].max() > 100  # nessun taglio implicito: il chiamante decide i limiti
    assert j["constraints"] == [None, None]


@pytest.mark.parametrize("bad", [[[0, 100]], [[100, 0], None], [[0, float("inf")], None]])
def test_api_limiti_non_validi_rifiutati(bad):
    raw = body(24, bounds=None)
    raw["physical_bounds"] = bad
    if any(b and any(x == float("inf") for x in b) for b in bad):
        import json
        payload = json.dumps(raw).replace("Infinity", "1e999")
        r = client(BoundaryEngine()).post("/v1/forecast", content=payload, headers={**AUTH, "content-type": "application/json"})
    else:
        r = client(BoundaryEngine()).post("/v1/forecast", json=raw, headers=AUTH)
    assert r.status_code == 422
