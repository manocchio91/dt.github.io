# 15 — Previsioni probabilistiche (F31) e integrazione Timestral

> **Stato: Beta da validare.** Dal 25/10/2026 **Timestral-5M è eseguito davvero** in un container
> Docker locale (CPU) e confrontato con le baseline (§13). Il sito pubblico **non** è collegato:
> senza servizio raggiungibile l'interfaccia mostra il messaggio di modello avanzato non
> disponibile e non sostituisce mai la previsione con valori inventati. Nessuna validazione con
> utenti o esperti.

| Livello | Stato |
| --- | --- |
| Implementato | contratto, adapter, baseline, servizio (Docker), vincolo fisico dell’umidità, proxy `forecast-proxy`, tabelle, UI, backtest |
| Testato in locale | sì: test Python (43), `forecast.test.ts`, `supabase/tests/forecast*.test.ts`, `apps/web/src/test/forecast.test.tsx`, `e2e/forecast*.spec.ts`, `e2e/timestral*.spec.ts` |
| Testato su servizio reale | sì, **solo in locale**: container Timestral-5M reale, Supabase di staging, Open-Meteo reale (report `docs/reports/timestral-runtime-2026-10-25.md`) |
| Pubblicato | no (né container né proxy né sito) |
| Validato con utenti | no |
| Validato scientificamente | no: backtest su rianalisi (stime da modello) e una sola verifica di 24 h; servono sensori in campo e storico più lungo |

## 1. Flusso

```
storico (rianalisi / sensori)  →  validazione input (UTC, 1 h, unità, mancanti, leakage)
      →  motore: Timestral (servizio) | baseline (browser)
      →  21 quantili per ora  →  soglie dell'esperto  →  grafico + tabella
      →  decisione umana  →  registrazione nel progetto  →  confronto ex-post
```

Una previsione è **STIMATO DA MODELLO**, mai una misura. Il badge mostra il motore:
`STIMATO DA MODELLO — Timestral 5M [bdd20cf]` solo quando l'output arriva davvero dal servizio
Timestral; per le baseline `STIMATO DA MODELLO — Persistenza stagionale (…)`.

## 2. Architettura

| Componente | Percorso | Ruolo |
| --- | --- | --- |
| Contratto | `packages/domain/src/forecast/types.ts` | `TimeSeriesForecastAdapter`, `ForecastRequest`, `ForecastResult`, 21 livelli `QUANTILE_LEVELS` |
| Validazione | `forecast/validate.ts` | griglia oraria, UTC, unità, limiti, leakage, calendario Europe/Rome con ora legale |
| Baseline | `forecast/baselines.ts` | `NaivePersistenceAdapter`, `SeasonalNaiveAdapter` (24 h), `DemoForecastAdapter` solo SIMULATO |
| Timestral | `forecast/timestral.ts` | `TimestralForecastAdapter` verso il servizio, revisioni bloccate, cache per hash |
| Metriche e backtest | `forecast/metrics.ts`, `forecast/backtest.ts`, `forecast/cases.ts` | MAE, MASE, pinball, WQL, copertura, falsi allarmi/criticità mancate; walk-forward |
| Registro e ex-post | `forecast/record.ts` | `ForecastRecord` nel progetto (`bundle.forecasts`), soglia agronomica, confronto con l'osservazione |
| Servizio | `services/forecasting` | FastAPI CPU, token Bearer, limiti, timeout, concorrenza, cache, log senza dati |
| Database | `supabase/migrations/20261024000006_forecasts.sql` | 7 tabelle con RLS e audit |
| UI | `apps/web/src/pages/ForecastPage.tsx`, `components/ForecastChart.tsx` | sezione **Previsioni** (`/progetti/:id/previsioni`) |

Il modello **non gira nel browser**. Il browser chiama un **proxy autenticato**
(`VITE_FORECAST_URL`, es. Edge Function) con il token di sessione dell'utente; il proxy verifica
utente e organizzazione e aggiunge `FORECAST_SERVICE_TOKEN` verso il servizio. La chiave di
servizio non è mai nel bundle del client. Il proxy non è ancora implementato (B-131).

## 3. Schema di scambio (versione 1)

Richiesta `POST /v1/forecast`: `schema_version`, `model`, `revision`, `frequency: "1h"`,
`prediction_length`, `context` (serie, variate, tempo; `null` = mancante), `past_covariates`,
`known_covariates` (storico + orizzonte; solo calendario, previsione meteo, piano irriguo,
evento pianificato), `input_hash`.
Risposta: `quantiles` (serie, variate, orizzonte, 21), `median`, `quantile_levels`, `revision`,
`code_commit`, `inference_ms`, `warnings`, `input_hash` del server, `cached`.
L'adapter scarta risposte con schema diverso, revisione diversa, quantili incrociati o non finiti.
Dettagli ed errori: [services/forecasting/README.md](../services/forecasting/README.md).

## 4. Guida al servizio e spike 5M / 28M

1. Installare Python 3.10–3.13 e `uv`.
2. `cd services/forecasting && uv lock && uv sync --extra timestral` (torch CPU, codice Timestral al commit `a534bdb`).
3. `uv run pytest`: test dell'API con motore finto.
4. `MDT_REAL_MODEL=1 uv run pytest -m real_model`: scarica i pesi 5M (~21 MB) dalla fonte ufficiale nella cache Hugging Face, verifica forma, ordinamento e riproducibilità su CPU.
5. Ripetere con `FORECAST_MODELS=mistralai/Timestral-5M,mistralai/Timestral-28M` per il confronto (28M ~111 MB).
6. Avviare il servizio con `FORECAST_SERVICE_TOKEN` in un file d'ambiente locale escluso da Git, poi
   `FORECAST_SERVICE_URL=http://127.0.0.1:8080 FORECAST_SERVICE_TOKEN=… npx vite-node scripts/backtest.ts`
   per aggiungere Timestral al backtest.

I pesi non entrano mai nel repository (`.gitignore`: `*.safetensors`, cache dei modelli) né nell'immagine Docker.

## 5. Licenze

| Elemento | Licenza | Nota |
| --- | --- | --- |
| Codice Timestral | Apache-2.0 | dipendenza pip bloccata a commit |
| Pesi Timestral-5M / 28M | Modified MIT (Hugging Face) | scaricati alla revisione dichiarata; verificare gli obblighi di attribuzione prima della produzione |
| Dati di rianalisi | CC BY 4.0 (Open-Meteo, ERA5/ERA5-Land) | citati nella lineage |
| Servizio e app | codice del progetto | — |

## 6. Modello di sicurezza

- Token di servizio solo lato server; confronto a tempo costante; senza token il servizio rifiuta.
- Limiti: 1 serie, ≤ 8 variate, storico 72–8760 h, orizzonte ≤ 168 h, ≤ 16 covariate, corpo ≤ 2 MB; 429 se occupato, 504 al timeout.
- Log: hash abbreviato, forma, durata, esito. Mai valori, coordinate, token, identità.
- Database: un'esecuzione Timestral si registra **solo dal ruolo di servizio** (trigger), quindi un client non può presentare come "Timestral" valori calcolati altrove; esecuzioni e output immutabili dopo la conclusione; soglie versionate; isolamento per organizzazione; audit di esecuzioni, soglie, avvisi e backtest.

## 7. Lineage di ogni previsione

`forecastLineage()` registra: dataset, fonte, endpoint, licenza, coordinate della cella, variabile,
unità, frequenza, periodo, % mancanti, flag di qualità, covariate, modello e revisione, data di
esecuzione, orizzonte, classe del dato, chi l'ha avviata. Più l'hash dell'input. Tutto finisce in
`bundle.forecasts` e quindi nell'export del dossier (con hash del progetto verificato al reimport).

## 8. Come leggere i quantili

- La **mediana** (quantile 0,50) è il valore centrale: metà degli esiti attesi sta sotto e metà sopra.
- L'**intervallo 80%** (q0,10–q0,90) dovrebbe contenere l'osservazione 8 volte su 10 *se il modello è ben calibrato*. Il backtest misura la copertura effettiva (es. 75% per la persistenza stagionale urbana).
- La **probabilità di superare una soglia** si interpola dai 21 quantili. Non è una "affidabilità" del modello, che l'interfaccia non mostra mai.

## 9. Previsione ≠ simulazione di interventi

La previsione descrive come evolveranno le condizioni **senza** cambiamenti. Non stima l'effetto di
alberi, depavimentazione o schermature: quello si valuta con gli scenari del Decision Lab (con le
loro incertezze). Nel vigneto la previsione non è una misura in campo: va verificata e discussa con
l'agronomo prima di intervenire (testo obbligatorio in pagina).

## 10. Procedura di backtest

`npx vite-node scripts/backtest.ts`:

- origini giornaliere, storico minimo 14 giorni, contesto 28 giorni;
- input fino all'origine compresa, covariate solo di calendario; il codice verifica che lo storico finisca prima del primo istante valutato;
- casi separati urbano/agricolo (`forecast/cases.ts`); soglie dimostrative dichiarate;
- output: `packages/domain/src/forecast/data/backtest_summary.json` (usato dalla UI, verificato dai test) e `docs/reports/backtest-previsioni-<data>.md`.

**Regola di promozione.** Timestral resta Beta finché, per ciascun contesto separatamente, non batte
le baseline su MAE e WQL, non ha copertura vicina a quella nominale e non è confrontato con
osservazioni in campo e validato con utenti ed esperti. I benchmark pubblici di Mistral non valgono
come prova sul Molise.

## 11. Limiti scientifici

- Serie di rianalisi su celle di alcuni km: non rappresentano piazze o filari.
- Una sola cella per il vigneto: le zone differiscono solo per la soglia agronomica, non per la previsione.
- Umidità del suolo molto liscia: MASE gonfiato, usare MAE/WQL/copertura.
- Soglie dimostrative: le soglie vere le fissano tecnico comunale e agronomo (tabella `forecast_thresholds`).
- Nessun dato di sensori in campo nei test: il confronto ex-post usa la rianalisi successiva.

## 12. Test su Supabase reale (F31)

Aggiunte alla checklist di [14-piano-test-supabase-reale.md](14-piano-test-supabase-reale.md):
F1 registrazione baseline da editor; F2 rifiuto di un'esecuzione Timestral da client; F3 esecuzione
Timestral dal ruolo di servizio; F4 immutabilità dopo conclusione; F5 isolamento tra organizzazioni;
F6 soglie versionate; F7 avvisi con ex-post; F8 audit visibile solo all'admin.

## 13. Esecuzione reale in Docker (25/10/2026)

**Modello:** `mistralai/Timestral-5M` @ `bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f` (pesi 20 MB, licenza
Modified MIT, nessuna accettazione manuale richiesta), codice `timestral` @ `a534bdb` (Apache-2.0).
Il 28M resta un'opzione di confronto: non scaricato né avviato.

**Container** (`services/forecasting/Dockerfile`, build in due fasi): immagine runtime 1,42 GB (torch
2.7.0 solo CPU), utente non root, senza git né uv, dipendenze bloccate da `uv.lock`, pesi nel volume
Docker `mdt-hf` (mai nell'immagine), health check, arresto controllato.

```bash
docker build --target runtime -t mdt-forecasting:local services/forecasting
docker run -d --name mdt-forecasting -p 127.0.0.1:8080:8080 --env-file <file locale con FORECAST_SERVICE_TOKEN> \
  -v mdt-hf:/models --memory 2g --cpus 2 --read-only --tmpfs /tmp --security-opt no-new-privileges --cap-drop ALL mdt-forecasting:local
```

| Misura (CPU, 2 core, limite 2 GB) | Valore |
| --- | --- |
| Avvio con download dei pesi / riavvio offline dalla cache | 19 s / 9 s |
| Prima previsione / successive / dalla cache | 688 ms / 115–258 ms / 67 ms |
| RAM a riposo / picco | 296 / 314 MiB |
| Arresto controllato | 2,1 s |
| Senza pesi e senza rete | 503 “Motore Timestral non configurato”, nessun valore |

**Backtest walk-forward** (rianalisi Open-Meteo, estate 2025; `docs/reports/backtest-previsioni-2026-10-25.md`):
Timestral-5M ha MAE e WQL più bassi delle baseline nei tre casi (urbano temperatura 24 h: MAE 1,39
contro 1,73 °C della persistenza stagionale; agricolo umidità del suolo 72 h: 0,003 contro 0,004;
agricolo temperatura 48 h: 1,83 contro 2,43 °C) ma la copertura dell'intervallo 80% è sotto il
nominale in 2 casi su 3 (0,74–0,76). Dati modellati, non misure: non è una validazione.

**Vincolo fisico dell'umidità** (`physical_clipping_v1`, decisione del responsabile): il modello non
conosce il limite 0–100% e le code alte lo superano (fino a 130,8% nel backtest). Il proxy stabilisce
i limiti lato server, il servizio riporta mediana e quantili entro 0–100, verifica di nuovo
l'ordinamento e restituisce i metadati (vincolo applicato, valori corretti, minimo e massimo grezzo,
metodo, versione dell'adattatore), che il proxy verifica e registra nella provenienza con modello e
revisione. Il browser non corregge nulla: scarta una risposta fuori limite.
Effetto (`docs/reports/backtest-umidita-vincolo-2026-10-25.md`): valori corretti 1,6–2,5%, quasi tutti
nei quantili 95% e 99%; previsioni con almeno una correzione 82–100%; fascia 80% fuori limite nel
2,5–2,7% delle ore; mediane mai toccate; MAE e copertura 80% invariati, WQL quasi invariato.
**Il vincolo migliora la plausibilità fisica ma può alterare la calibrazione degli intervalli: non è un
miglioramento scientifico.** Alternativa da valutare: trasformazione logit/sigmoide (B-172).

**Test reale su Supabase di staging** (`docs/reports/timestral-runtime-2026-10-25.md`, 20/20):
previsioni urbana (6 variabili) e agricola (8 variabili) registrate tramite il proxy con stato,
modello, revisione, hash, provenienza, località, 21 quantili e metadati del vincolo; lettore 403,
esterno 404 e nessuna lettura, nessun client registra previsioni Timestral, esecuzioni immutabili,
errore isolato, container spento → messaggio semplice e risultati precedenti intatti. Storico: la
Edge Function conserva ~24 h, sotto il minimo di 72 h; il test integra 7 giorni della stessa cella
dall'API Open-Meteo (verificati sulle ore in comune). Verifica a posteriori su una sola origine di
24 h: Timestral migliore delle baseline su umidità e precipitazione, **peggiore della persistenza
sulla temperatura** (MAE 3,2 contro 1,8 °C), intervalli troppo stretti su temperatura e suolo.
**Test tecnico completato; accuratezza non ancora validabile per insufficienza dello storico.**

**Interfaccia:** nessuna nuova pagina né voce di menu. Con un risultato reale il badge è
“STIMATO DA MODELLO — Timestral-5M”; nella guidata, solo se il vincolo è stato applicato, la nota
“L’intervallo è stato riportato entro i limiti fisici dell’umidità, da 0% a 100%.”; nell’approfondimento
tecnico vincolo, valori corretti, massimo grezzo, metodo e avviso di calibrazione. Servizio
configurato ma spento: “Il modello avanzato non è disponibile. Puoi continuare con la previsione di base.”

**Solo in locale:** container, proxy (eseguito come modulo nel test), collegamento. **Pronto per il
cloud:** immagine, Edge Function `forecast-proxy` (serve un servizio Timestral ospitato, B-175).
