"""API HTTP del servizio di previsione.

- GET  /health          stato del servizio e dei modelli (nessun dato)
- POST /v1/forecast     previsione probabilistica (token Bearer obbligatorio)

I log contengono solo hash dell'input, forme, durata ed esito: mai valori delle
serie, coordinate, token o identità degli utenti.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
import time
from collections import OrderedDict

import anyio
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .config import MODELS, QUANTILE_LEVELS, SCHEMA_VERSION, TIMESTRAL_CODE_COMMIT, Settings
from .engine import Engine, EngineUnavailable, TimestralEngine
from .schema import ForecastRequestV1, ForecastResponseV1

log = logging.getLogger("mdt.forecasting")


def _array(m: list | None) -> np.ndarray | None:
    if m is None:
        return None
    return np.array([[[np.nan if x is None else x for x in row] for row in s] for s in m], dtype=np.float64)


def canonical_hash(req: ForecastRequestV1) -> str:
    """Hash calcolato dal server (non si usa quello del client come chiave)."""
    payload = req.model_dump(exclude={"input_hash"})
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_shapes(req: ForecastRequestV1, s: Settings) -> list[str]:
    lim = s.limits
    errors: list[str] = []
    ctx = req.context
    if not (1 <= len(ctx) <= lim.max_series):
        errors.append(f"numero di serie fuori limite (max {lim.max_series})")
        return errors
    T = None
    for series in ctx:
        if not (1 <= len(series) <= lim.max_variates):
            errors.append(f"numero di variate fuori limite (max {lim.max_variates})")
        for row in series:
            T = len(row) if T is None else T
            if len(row) != T:
                errors.append("le variate devono avere la stessa lunghezza")
    T = T or 0
    if T < lim.min_context or T > lim.max_context:
        errors.append(f"lunghezza dello storico {T} fuori dai limiti {lim.min_context}-{lim.max_context}")
    if req.prediction_length > lim.max_horizon:
        errors.append(f"orizzonte {req.prediction_length} oltre il massimo {lim.max_horizon}")
    for series in ctx:
        for row in series:
            if row and row[-1] is None:
                errors.append("l'ultimo valore dello storico è mancante")
            if row and sum(x is None for x in row) / len(row) > 0.3:
                errors.append("troppi valori mancanti nello storico (>30%)")
    for name, cov, expected in (("past_covariates", req.past_covariates, T),
                                ("known_covariates", req.known_covariates, T + req.prediction_length)):
        if cov is None:
            continue
        if len(cov) != len(ctx):
            errors.append(f"{name}: numero di serie diverso dal contesto")
        for series in cov:
            if len(series) > lim.max_covariates:
                errors.append(f"{name}: troppe covariate (max {lim.max_covariates})")
            for row in series:
                if len(row) != expected:
                    errors.append(f"{name}: lunghezza {len(row)}, attesa {expected}")
    return sorted(set(errors))


def check_output(q: np.ndarray, med: np.ndarray, shape: tuple[int, int, int]) -> list[str]:
    B, V, H = shape
    if q.shape != (B, V, H, len(QUANTILE_LEVELS)) or med.shape != (B, V, H):
        return [f"forma inattesa {q.shape}"]
    if not np.isfinite(q).all() or not np.isfinite(med).all():
        return ["valori non finiti nell'output del modello"]
    if (np.diff(q, axis=-1) < -1e-9).any():
        return ["quantili incrociati nell'output del modello"]
    return []


def create_app(settings: Settings | None = None, engine: Engine | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if engine is None:
        real = TimestralEngine(settings.models)
        real.load()
        engine = real
    app = FastAPI(title="MDT forecasting", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
    # semaforo di thread: resta occupato finché l'inferenza termina davvero,
    # anche se la richiesta è già andata in timeout
    slots = threading.BoundedSemaphore(settings.max_concurrency)
    cache: OrderedDict[str, ForecastResponseV1] = OrderedDict()

    def auth(authorization: str | None = Header(default=None)) -> None:
        if not settings.token:
            raise HTTPException(503, "Servizio non configurato: token assente")
        expected = f"Bearer {settings.token}"
        if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(401, "Non autorizzato")

    @app.middleware("http")
    async def body_limit(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and int(length) > settings.limits.max_body_bytes:
            return JSONResponse({"detail": "Richiesta troppo grande"}, status_code=413)
        return await call_next(request)

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "schema_version": SCHEMA_VERSION,
            "code_commit": TIMESTRAL_CODE_COMMIT,
            "auth_configured": bool(settings.token),
            "models": {m: {"revision": MODELS[m], "status": engine.status(m)} for m in settings.models},
        }

    @app.post("/v1/forecast", response_model=ForecastResponseV1, dependencies=[Depends(auth)])
    async def forecast(req: ForecastRequestV1) -> ForecastResponseV1:
        t0 = time.perf_counter()
        if req.model not in settings.models:
            raise HTTPException(422, "Modello non ammesso da questo servizio")
        if req.revision != MODELS[req.model]:
            raise HTTPException(422, "Revisione del modello diversa da quella bloccata")
        errors = validate_shapes(req, settings)
        if errors:
            raise HTTPException(422, "; ".join(errors))
        key = canonical_hash(req)
        if key in cache:
            cache.move_to_end(key)
            log.info("forecast hash=%s cache=hit", key[:12])
            return cache[key].model_copy(update={"cached": True})
        if engine.status(req.model) != "pronto":
            raise HTTPException(503, "Motore Timestral non configurato")
        if not slots.acquire(blocking=False):
            raise HTTPException(429, "Servizio occupato, riprovare")
        ctx = _array(req.context)
        assert ctx is not None
        past, known = _array(req.past_covariates), _array(req.known_covariates)

        def run():
            try:
                return engine.forecast(req.model, ctx, req.prediction_length, past, known)
            finally:
                slots.release()

        try:
            with anyio.fail_after(settings.timeout_s):
                out = await anyio.to_thread.run_sync(run, abandon_on_cancel=True)
        except TimeoutError:
            log.warning("forecast hash=%s esito=timeout", key[:12])
            raise HTTPException(504, "Tempo di inferenza scaduto") from None
        except EngineUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        problems = check_output(out.quantiles, out.median, (ctx.shape[0], ctx.shape[1], req.prediction_length))
        if problems:
            log.error("forecast hash=%s esito=output_non_valido", key[:12])
            raise HTTPException(502, "; ".join(problems))
        warnings = []
        if np.isnan(ctx).any():
            warnings.append("storico con valori mancanti: gestiti dal modello come NaN")
        res = ForecastResponseV1(
            model=req.model, revision=MODELS[req.model], code_commit=TIMESTRAL_CODE_COMMIT,
            quantile_levels=list(QUANTILE_LEVELS), quantiles=out.quantiles.round(6).tolist(),
            median=out.median.round(6).tolist(), inference_ms=round((time.perf_counter() - t0) * 1000),
            warnings=warnings, input_hash=key)
        cache[key] = res
        if len(cache) > settings.cache_size:
            cache.popitem(last=False)
        log.info("forecast hash=%s shape=%s h=%d ms=%d esito=ok", key[:12], ctx.shape, req.prediction_length, res.inference_ms)
        return res

    return app


def _lazy_app() -> FastAPI:  # pragma: no cover - avvio con uvicorn
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    return create_app()


def __getattr__(name: str):  # uvicorn app.main:app
    if name == "app":
        return _lazy_app()
    raise AttributeError(name)
