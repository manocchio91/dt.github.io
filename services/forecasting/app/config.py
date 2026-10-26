"""Configurazione da variabili d'ambiente. Nessun segreto ha un valore predefinito."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# Modelli ammessi e revisioni bloccate dei pesi (Hugging Face, licenza Modified MIT).
# Devono coincidere con TIMESTRAL_MODELS in packages/domain/src/forecast/timestral.ts.
MODELS: dict[str, str] = {
    "mistralai/Timestral-5M": "bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f",
    "mistralai/Timestral-28M": "49b26409ac87b5935539a5d8ffe7f397b720db47",
}
TIMESTRAL_CODE_COMMIT = "a534bdbd244d64f3d9d743f46c7bf6fc330ed4ff"
SCHEMA_VERSION = 1
# versione dell'adattatore (servizio + post-elaborazione), registrata con ogni previsione
ADAPTER_VERSION = "mdt-forecasting 0.2.0"
QUANTILE_LEVELS = (0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
                   0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99)


@dataclass(frozen=True)
class Limits:
    max_series: int = 1
    max_variates: int = 8
    min_context: int = 72
    max_context: int = 8760
    max_horizon: int = 168
    max_covariates: int = 16
    max_body_bytes: int = 2_000_000


@dataclass(frozen=True)
class Settings:
    token: str | None
    models: tuple[str, ...]
    timeout_s: float = 30.0
    max_concurrency: int = 2
    cache_size: int = 128
    limits: Limits = field(default_factory=Limits)

    @staticmethod
    def from_env() -> "Settings":
        wanted = tuple(m.strip() for m in os.environ.get("FORECAST_MODELS", "mistralai/Timestral-5M").split(",") if m.strip())
        unknown = [m for m in wanted if m not in MODELS]
        if unknown:
            raise ValueError(f"Modelli non ammessi: {unknown}")
        return Settings(
            token=os.environ.get("FORECAST_SERVICE_TOKEN") or None,
            models=wanted,
            timeout_s=float(os.environ.get("FORECAST_TIMEOUT_S", "30")),
            max_concurrency=int(os.environ.get("FORECAST_MAX_CONCURRENCY", "2")),
            cache_size=int(os.environ.get("FORECAST_CACHE_SIZE", "128")),
        )
