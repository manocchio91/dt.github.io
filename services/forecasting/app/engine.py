"""Motori di inferenza. Il motore Timestral reale si carica solo se codice e pesi
sono disponibili; altrimenti il servizio risponde 503 "Motore Timestral non
configurato" e non produce MAI valori sostitutivi."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .config import MODELS, QUANTILE_LEVELS


@dataclass
class EngineOutput:
    quantiles: np.ndarray  # (B, V, H, 21)
    median: np.ndarray  # (B, V, H)


class Engine(Protocol):
    def status(self, model: str) -> str: ...
    def forecast(self, model: str, context: np.ndarray, prediction_length: int,
                 past: np.ndarray | None, known: np.ndarray | None) -> EngineOutput: ...


class EngineUnavailable(RuntimeError):
    pass


class TimestralEngine:
    """Carica TimestralForecaster alla revisione bloccata, una volta per modello."""

    def __init__(self, models: tuple[str, ...], device: str = "cpu") -> None:
        self._wanted = models
        self._device = device
        self._loaded: dict[str, object] = {}
        self._errors: dict[str, str] = {}
        self._lock = threading.Lock()

    def load(self) -> None:
        try:
            from timestral import TimestralForecaster  # type: ignore[import-not-found]
        except ImportError:
            for m in self._wanted:
                self._errors[m] = "pacchetto timestral non installato"
            return
        for m in self._wanted:
            try:
                self._loaded[m] = TimestralForecaster.from_pretrained(m, revision=MODELS[m], device=self._device)
            except Exception as exc:  # noqa: BLE001 - riportato come stato, senza dati personali
                self._errors[m] = f"pesi non disponibili ({type(exc).__name__})"

    def status(self, model: str) -> str:
        if model in self._loaded:
            return "pronto"
        return self._errors.get(model, "non configurato")

    def forecast(self, model, context, prediction_length, past, known) -> EngineOutput:
        fc = self._loaded.get(model)
        if fc is None:
            raise EngineUnavailable("Motore Timestral non configurato")
        with self._lock:  # un'inferenza alla volta per istanza del modello
            out = fc.forecast(  # type: ignore[attr-defined]
                context,
                prediction_length=prediction_length,
                past_covariates=past,
                known_covariates=known,
            )
        levels = tuple(round(float(x), 4) for x in out.quantile_levels)
        if levels != QUANTILE_LEVELS:
            raise EngineUnavailable("livelli dei quantili inattesi dal modello")
        return EngineOutput(quantiles=np.asarray(out.quantiles, dtype=np.float64),
                            median=np.asarray(out.median, dtype=np.float64))
