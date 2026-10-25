"""Vincoli fisici applicati all'output del modello (misura di sicurezza del prototipo).

Il modello non conosce i limiti fisici delle grandezze (es. umidità relativa 0–100%): i quantili
estremi possono uscirne. Per le sole variate per cui il chiamante dichiara dei limiti, mediana e
quantili vengono riportati entro [min, max] ("physical_clipping_v1") e la correzione viene
dichiarata con metadati di tracciabilità. Non è una validazione del modello: il taglio delle code
può alterare la calibrazione probabilistica degli intervalli.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

METHOD = "physical_clipping_v1"


@dataclass(frozen=True)
class ConstraintReport:
    physical_constraint_applied: bool
    physical_min: float | None
    physical_max: float | None
    adjusted_values_count: int
    total_values: int
    maximum_raw_value: float
    minimum_raw_value: float
    method: str
    adapter_version: str

    def as_dict(self) -> dict:
        return asdict(self)


def apply_physical_bounds(
    quantiles: np.ndarray,
    bounds: list[tuple[float | None, float | None] | None] | None,
    adapter_version: str,
) -> tuple[np.ndarray, np.ndarray, list[dict | None]]:
    """quantiles (B, V, H, Q) → quantili e mediana entro i limiti, più un rapporto per variata.

    Le variate senza limiti dichiarati restano identiche (rapporto None). Il taglio è monotòno,
    quindi l'ordinamento dei quantili si conserva; viene comunque verificato dal chiamante.
    """
    q = np.array(quantiles, dtype=np.float64, copy=True)
    reports: list[dict | None] = []
    V = q.shape[1]
    for v in range(V):
        b = bounds[v] if bounds is not None and v < len(bounds) else None
        if b is None or (b[0] is None and b[1] is None):
            reports.append(None)
            continue
        lo, hi = b
        raw = q[:, v]
        lo_mask = raw < lo if lo is not None else np.zeros_like(raw, dtype=bool)
        hi_mask = raw > hi if hi is not None else np.zeros_like(raw, dtype=bool)
        adjusted = int(lo_mask.sum() + hi_mask.sum())
        report = ConstraintReport(
            physical_constraint_applied=adjusted > 0,
            physical_min=lo,
            physical_max=hi,
            adjusted_values_count=adjusted,
            total_values=int(raw.size),
            maximum_raw_value=round(float(raw.max()), 6),
            minimum_raw_value=round(float(raw.min()), 6),
            method=METHOD,
            adapter_version=adapter_version,
        )
        q[:, v] = np.clip(raw, lo if lo is not None else -np.inf, hi if hi is not None else np.inf)
        reports.append(report.as_dict())
    median_index = q.shape[-1] // 2  # 0.5 è il livello centrale dei 21
    return q, q[..., median_index], reports
