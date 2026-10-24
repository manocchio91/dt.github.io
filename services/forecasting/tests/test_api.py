"""Test dell'API con un motore finto (nessun peso necessario).

Il test con il modello reale è in test_real_model.py ed è saltato salvo MDT_REAL_MODEL=1.
"""

from __future__ import annotations

import logging
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import MODELS, QUANTILE_LEVELS, Settings
from app.engine import EngineOutput
from app.main import create_app

TOKEN = "test-token-non-segreto"
M5 = "mistralai/Timestral-5M"


class FakeEngine:
    def __init__(self, ready=True, delay=0.0, crossed=False):
        self.ready, self.delay, self.crossed, self.calls = ready, delay, crossed, 0

    def status(self, model):
        return "pronto" if self.ready else "non configurato"

    def forecast(self, model, context, prediction_length, past, known):
        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        B, V, _ = context.shape
        last = np.nan_to_num(context[..., -1])
        levels = np.array(QUANTILE_LEVELS)
        q = last[..., None, None] + (levels - 0.5)[None, None, None, :] * np.ones((B, V, prediction_length, 1))
        if self.crossed:
            q[..., 3] = -1e6
        return EngineOutput(quantiles=q, median=q[..., 10])


def client(engine=None, **kw):
    s = Settings(token=kw.pop("token", TOKEN), models=(M5,), **kw)
    return TestClient(create_app(s, engine or FakeEngine()))


def body(T=200, H=24, **over):
    b = {
        "schema_version": 1, "model": M5, "revision": MODELS[M5], "frequency": "1h",
        "prediction_length": H, "context": [[[20.0 + (i % 24) * 0.1 for i in range(T)]]],
    }
    b.update(over)
    return b


AUTH = {"authorization": f"Bearer {TOKEN}"}


def test_health_non_espone_dati():
    r = client().get("/health")
    assert r.status_code == 200
    j = r.json()
    assert j["models"][M5] == {"revision": MODELS[M5], "status": "pronto"}
    assert TOKEN not in r.text


def test_previsione_forma_21_quantili_ordinati():
    r = client().post("/v1/forecast", json=body(), headers=AUTH)
    assert r.status_code == 200, r.text
    j = r.json()
    q = np.array(j["quantiles"])
    assert q.shape == (1, 1, 24, 21)
    assert (np.diff(q, axis=-1) >= 0).all()
    assert np.allclose(np.array(j["median"]), q[..., 10])
    assert j["quantile_levels"] == list(QUANTILE_LEVELS)
    assert j["revision"] == MODELS[M5] and j["schema_version"] == 1


@pytest.mark.parametrize("headers,status", [({}, 401), ({"authorization": "Bearer sbagliato"}, 401)])
def test_autenticazione_obbligatoria(headers, status):
    assert client().post("/v1/forecast", json=body(), headers=headers).status_code == status


def test_senza_token_configurato_il_servizio_rifiuta():
    assert client(token=None).post("/v1/forecast", json=body(), headers=AUTH).status_code == 503


def test_motore_non_configurato_nessun_valore_sostitutivo():
    eng = FakeEngine(ready=False)
    r = client(eng).post("/v1/forecast", json=body(), headers=AUTH)
    assert r.status_code == 503
    assert r.json()["detail"] == "Motore Timestral non configurato"
    assert eng.calls == 0


@pytest.mark.parametrize("over,msg", [
    ({"revision": "altra"}, "Revisione"),
    ({"model": "mistralai/Timestral-28M"}, "non ammesso"),
    ({"prediction_length": 500}, "orizzonte"),
    ({"context": [[[1.0] * 10]]}, "lunghezza dello storico"),
    ({"context": [[[1.0] * 199 + [None]]]}, "ultimo valore"),
    ({"context": [[[None, 1.0] * 100]]}, "mancanti"),
    ({"known_covariates": [[[0.0] * 100]]}, "attesa 224"),
    ({"frequency": "15min"}, ""),
    ({"schema_version": 2}, ""),
    ({"extra": 1}, ""),
])
def test_input_non_valido(over, msg):
    r = client().post("/v1/forecast", json=body(**over), headers=AUTH)
    assert r.status_code == 422
    assert msg in r.text


def test_valori_non_finiti_rifiutati():
    raw = '{"schema_version":1,"model":"%s","revision":"%s","frequency":"1h","prediction_length":2,"context":[[[NaN]]]}' % (M5, MODELS[M5])
    r = client().post("/v1/forecast", content=raw, headers={**AUTH, "content-type": "application/json"})
    assert r.status_code == 422


def test_mancanti_ammessi_e_segnalati():
    ctx = [20.0 if i % 9 else None for i in range(199)] + [21.0]
    r = client().post("/v1/forecast", json=body(context=[[ctx]]), headers=AUTH)
    assert r.status_code == 200
    assert "mancanti" in r.json()["warnings"][0]


def test_covariate_note_accettate():
    T, H = 200, 24
    known = [[[float((i % 24) / 24) for i in range(T + H)]]]
    assert client().post("/v1/forecast", json=body(T=T, H=H, known_covariates=known), headers=AUTH).status_code == 200


def test_cache_per_hash_e_riproducibilita():
    eng = FakeEngine()
    c = client(eng)
    a = c.post("/v1/forecast", json=body(input_hash="dal-client"), headers=AUTH).json()
    b = c.post("/v1/forecast", json=body(input_hash="altro"), headers=AUTH).json()
    assert eng.calls == 1
    assert b["cached"] is True and a["quantiles"] == b["quantiles"]
    assert a["input_hash"] == b["input_hash"] != "dal-client"


def test_timeout():
    r = client(FakeEngine(delay=0.5), timeout_s=0.1).post("/v1/forecast", json=body(), headers=AUTH)
    assert r.status_code == 504


def test_output_con_quantili_incrociati_scartato():
    r = client(FakeEngine(crossed=True)).post("/v1/forecast", json=body(), headers=AUTH)
    assert r.status_code == 502


def test_limite_di_concorrenza():
    c = client(FakeEngine(delay=0.4), max_concurrency=1)
    results = []
    t = threading.Thread(target=lambda: results.append(c.post("/v1/forecast", json=body(H=12), headers=AUTH).status_code))
    t.start()
    time.sleep(0.1)
    second = c.post("/v1/forecast", json=body(H=13), headers=AUTH).status_code
    t.join()
    assert results == [200] and second == 429


def test_corpo_troppo_grande():
    big = "x" * 2_100_000
    r = client().post("/v1/forecast", content=big, headers={**AUTH, "content-type": "application/json"})
    assert r.status_code == 413


def test_log_senza_valori_ne_token(caplog):
    caplog.set_level(logging.INFO, logger="mdt.forecasting")
    client().post("/v1/forecast", json=body(context=[[[12345.678] * 200]]), headers=AUTH)
    text = caplog.text
    assert "12345" not in text and TOKEN not in text
    assert "esito=ok" in text
