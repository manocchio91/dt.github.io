# Umidità relativa — Timestral-5M grezzo e con vincolo fisico 0–100% (2026-10-25)

**Dati.** Campobasso (area urbana) — estate 2025 — Open-Meteo Historical Weather API (rianalisi ERA5 / ERA5-Land) (rianalisi: stime da modello su cella di griglia, non misure).

**Protocollo.** Walk-forward con origini giornaliere, storico minimo 14 giorni, contesto massimo 28 giorni; stesse origini e stesso input per il risultato grezzo e per quello vincolato (physical_clipping_v1).

| Orizzonte | Origini | MAE (%) grezzo → vincolato | WQL grezzo → vincolato | Copertura 80% grezzo → vincolato | Valori corretti | Massimo grezzo | Quantili esattamente a 100% | Mediane fuori 0–100 | Righe di quantili incrociate | Previsioni con almeno un valore corretto |
|---|---|---|---|---|---|---|---|---|---|---|
| 24 h | 78 | 8,274 → 8,274 | 0,1026 → 0,1026 | 0,748 → 0,748 | 631 / 39312 (1,61%) | 120,3 % | 1,61% | 0 | 0 | 64 / 78 (82,1%) |
| 48 h | 77 | 9,301 → 9,301 | 0,1144 → 0,1143 | 0,774 → 0,774 | 1712 / 77616 (2,21%) | 128,5 % | 2,21% | 0 | 0 | 75 / 77 (97,4%) |
| 72 h | 76 | 9,863 → 9,863 | 0,1205 → 0,1204 | 0,785 → 0,785 | 2819 / 114912 (2,45%) | 130,8 % | 2,45% | 0 | 0 | 76 / 76 (100%) |

Il vincolo **migliora la plausibilità fisica** (nessun valore oltre 100% o sotto 0%) ma **può alterare la calibrazione** degli intervalli probabilistici: i quantili tagliati si accumulano sul limite. Le differenze di MAE, WQL e copertura qui riportate non sono un miglioramento scientifico del modello.

Soluzione da valutare con storico più lungo (backlog): trasformazione limitata dell’umidità prima della previsione (logit/sigmoide) confrontata con questo vincolo successivo.
