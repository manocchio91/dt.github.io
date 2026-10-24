# services/forecasting — servizio di inferenza Timestral (Beta da validare)

Servizio Python separato che esegue **Timestral** (Mistral AI) per previsioni
probabilistiche di serie temporali orarie. Lo usa `TimestralForecastAdapter`
(`packages/domain/src/forecast/timestral.ts`) tramite un proxy autenticato.

> Stato: **implementato, non eseguito in questo ambiente** (Python e Docker non
> erano disponibili). I test con motore finto (`tests/test_api.py`) e lo spike
> sul modello reale (`tests/test_real_model.py`) vanno eseguiti come indicato sotto.
> Finché il servizio non è raggiungibile, l'interfaccia mostra
> **"Motore Timestral non configurato"** e non produce valori sostitutivi.

## Licenze (separate)

| Componente | Fonte ufficiale | Licenza | Nel repository? |
| --- | --- | --- | --- |
| Codice Timestral | github.com/mistralai/timestral @ `a534bdbd244d64f3d9d743f46c7bf6fc330ed4ff` | Apache-2.0 | No (dipendenza pip) |
| Pesi Timestral-5M | huggingface.co/mistralai/Timestral-5M @ `bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f` (~21 MB) | Modified MIT | **Mai** |
| Pesi Timestral-28M | huggingface.co/mistralai/Timestral-28M @ `49b26409ac87b5935539a5d8ffe7f397b720db47` (~111 MB) | Modified MIT | **Mai** |
| Questo servizio | questo repository | Apache-2.0 | Sì |

Prima dell'uso in produzione verificare il testo della licenza Modified MIT dei
pesi sulla pagina del modello (obblighi di attribuzione).

## API (schema versione 1)

- `GET /health` → stato, revisioni bloccate, `status` per modello (`pronto` /
  `non configurato` / `pesi non disponibili (...)`). Nessun dato.
- `POST /v1/forecast` con `Authorization: Bearer <FORECAST_SERVICE_TOKEN>`:

```json
{
  "schema_version": 1,
  "model": "mistralai/Timestral-5M",
  "revision": "bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f",
  "frequency": "1h",
  "prediction_length": 24,
  "context": [[[21.3, 20.8, null, 19.9]]],
  "past_covariates": null,
  "known_covariates": [[[0.0, 0.26, 0.5]]]
}
```

`context` ha forma (serie, variate, tempo), `null` = mancante. `known_covariates`
copre storico + orizzonte e contiene **solo** grandezze note in anticipo
(calendario, previsione meteorologica, piano irriguo, evento pianificato).
Risposta: `quantiles` (serie, variate, orizzonte, 21), `median`,
`quantile_levels`, `revision`, `code_commit`, `inference_ms`, `warnings`,
`input_hash` calcolato dal server.

Codici: 401 token errato, 413 corpo troppo grande, 422 input non valido o
revisione diversa, 429 occupato, 502 output del modello non valido (quantili
incrociati, non finiti), 503 **Motore Timestral non configurato**, 504 timeout.

## Limiti e sicurezza

- 1 serie, max 8 variate, storico 72–8760 passi, orizzonte max 168, max 16 covariate, corpo max 2 MB.
- Concorrenza limitata (`FORECAST_MAX_CONCURRENCY`, default 2); il posto resta
  occupato finché l'inferenza termina davvero, anche dopo il timeout.
- Timeout (`FORECAST_TIMEOUT_S`, default 30 s); cache LRU per hash dell'input (`FORECAST_CACHE_SIZE`).
- Confronto del token a tempo costante; senza token configurato tutte le
  richieste di previsione sono rifiutate. Documentazione OpenAPI disattivata.
- I log riportano solo hash abbreviato, forma, orizzonte, durata ed esito.
- Il servizio non deve essere esposto direttamente al browser: va dietro un
  proxy (es. Edge Function Supabase) che verifica la sessione dell'utente e
  l'appartenenza all'organizzazione, poi aggiunge il token di servizio.

## Esecuzione locale

Richiede Python 3.10–3.13 e [uv](https://docs.astral.sh/uv/).

```bash
cd services/forecasting
uv lock                                   # genera uv.lock (da versionare)
uv sync --extra timestral                 # torch CPU + codice Timestral al commit bloccato
uv run pytest                             # test con motore finto
MDT_REAL_MODEL=1 uv run pytest -m real_model    # spike 5M: scarica i pesi nella cache HF
MDT_REAL_MODEL=1 FORECAST_MODELS=mistralai/Timestral-5M,mistralai/Timestral-28M uv run pytest -m real_model
FORECAST_SERVICE_TOKEN=... uv run uvicorn app.main:app --port 8080
```

Container (CPU, utente non root, pesi montati come volume, mai nell'immagine):

```bash
docker build -t mdt-forecasting services/forecasting
docker run --rm -p 8080:8080 -e FORECAST_SERVICE_TOKEN -v mdt-hf:/models mdt-forecasting
```

Con i pesi già in cache, `-e HF_HUB_OFFLINE=1` impedisce accessi di rete.
