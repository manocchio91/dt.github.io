"""Schema versionato della richiesta e della risposta (versione 1)."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import SCHEMA_VERSION

Matrix3 = list[list[list[float | None]]]


class ForecastRequestV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    model: str
    revision: str
    frequency: Literal["1h"]
    prediction_length: int = Field(ge=1)
    # forma (serie, variate, tempo); null = valore mancante
    context: Matrix3
    past_covariates: Matrix3 | None = None
    # forma (serie, covariate, tempo + orizzonte): solo grandezze realmente note in anticipo
    known_covariates: Matrix3 | None = None
    input_hash: str | None = Field(default=None, max_length=128)

    @field_validator("context", "past_covariates", "known_covariates")
    @classmethod
    def finite_or_null(cls, v: Matrix3 | None) -> Matrix3 | None:
        if v is None:
            return v
        for s in v:
            for row in s:
                for x in row:
                    if x is not None and not math.isfinite(x):
                        raise ValueError("valori non finiti: usare null per i mancanti")
        return v


class ForecastResponseV1(BaseModel):
    schema_version: int = SCHEMA_VERSION
    model: str
    revision: str
    code_commit: str
    quantile_levels: list[float]
    # forma (serie, variate, orizzonte, 21)
    quantiles: list[list[list[list[float]]]]
    median: list[list[list[float]]]
    inference_ms: int
    warnings: list[str]
    input_hash: str
    cached: bool = False
