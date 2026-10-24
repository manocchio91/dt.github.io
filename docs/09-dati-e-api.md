# 09 — Dati e API: realmente disponibili vs demo

## Realmente disponibili (senza credenziali)

| Fonte | Uso | Endpoint | Classe dato | Licenza / termini | Stato M0 |
|---|---|---|---|---|---|
| OpenStreetMap tile | cartografia di base | `tile.openstreetmap.org` | — | ODbL, attribuzione obbligatoria, policy uso tile (basso traffico) | Operativa |
| Open-Meteo Historical | baseline meteo (T aria 2 m, UR, precipitazione, vento 10 m, radiazione) | `archive-api.open-meteo.com/v1/archive` | **STIMATO DA MODELLO** (rianalisi ERA5/ERA5-Land e modelli) — non è un sensore locale | CC BY 4.0, uso non commerciale gratuito | Beta |
| Open-Meteo Forecast | previsione e umidità/temperatura suolo per strato | `api.open-meteo.com/v1/forecast` | **PREVISIONE** / **STIMATO DA MODELLO** con profondità | CC BY 4.0 | Beta |
| GeoJSON utente | AOI e parcelle | file locale | INSERITO DALL'UTENTE | — | Operativa |
| CSV misure utente | verifica ex-post | file locale | MISURATO (se sensore dichiarato) | — | Operativa |

## Disponibili ma non collegati in M0

| Fonte | Motivo | Milestone |
|---|---|---|
| Nominatim (geocodifica) | richiede User-Agent identificativo e rispetto rate limit 1 req/s; va instradato via proxy | M1 |
| NASA POWER | serie agroclimatiche; utile per confronto, ridondante con Open-Meteo in M0 | M1 |
| Sensor.Community | provenienza eterogenea, richiede QA/QC per sensore | M1 |
| Supabase/PostGIS | credenziali assenti | M1 |

## Non disponibili — resteranno DEMO finché non forniti

| Elemento | Cosa serve | Comportamento attuale |
|---|---|---|
| Modello microclimatico urbano validato | modello documentato (es. ENVI-met, SOLWEIG, o regressione locale calibrata) + revisore | `demo-urban-illustrative` con coefficienti DEMO dichiarati |
| UTCI / WBGT | Tmrt, vento a quota pedone, radiazione locale | DATO MANCANTE con spiegazione |
| Temperatura superficiale osservata | prodotto satellitare (Landsat LST / ECOSTRESS) con data, risoluzione, nuvolosità | baseline seed SIMULATA |
| Copernicus / Sentinel-2 | dataset, credenziali, prodotto e risoluzione definiti | Roadmap (F06) |
| Sensori di campo vigneto | produttore, seriale, profondità, calibrazione | DATO MANCANTE, abbassa la fiducia |
| Soglie agronomiche validate (stress termico, idrico) per cultivar | validazione agronomica | soglie DEMO modificabili, marcate "da validare" |
| Costi parametrici di intervento | prezzari regionali (es. prezzario Regione Molise) | costi DEMO con intervallo |
| Geometrie ufficiali Piazza Vittorio Emanuele II e vigneto | rilievo / catasto | geometrie approssimate DEMO |
| Asset istituzionali (MIM, Ca' Foscari, ITS 4.0, ITS D.E.Mo.S.) | file ufficiali | non inclusi |
