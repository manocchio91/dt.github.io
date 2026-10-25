# 16 — Acquisizione meteo Open-Meteo → Supabase (F04)

> **Stato: Beta.** Implementato e testato in locale (dominio, database PGlite, logica
> della Edge Function con fixture reali, interfaccia, E2E con Supabase simulato). Smoke test
> **reale** verso Open-Meteo eseguito il 24/10/2026 (urbano e agricolo, risposta valida).
> **Non eseguito su Supabase reale**: migrazione, Edge Function e job pianificato non sono
> stati pubblicati (nessuna credenziale di staging disponibile). Vedi §10.

| Livello | Stato |
| --- | --- |
| Implementato | migrazione, Edge Function `open-meteo-ingest`, modello di pianificazione, pannello UI, adapter per Timestral |
| Testato in locale | `openMeteoForecast.test.ts`, `supabase/tests/weather.test.ts`, `weatherPanel.test.tsx`, `weatherSource.test.ts`, `e2e/weather.spec.ts` |
| Testato su servizio reale | solo Open-Meteo (`node scripts/open-meteo-smoke.mjs`); **non** Supabase |
| Validato con utenti / scientificamente | no |

## 1. Flusso dei dati

```
pg_cron (ogni 3 h) ──pg_net──▶ Edge Function open-meteo-ingest ──▶ Open-Meteo Forecast API
app (Aggiorna dati) ─JWT──────▶        │  valida forma, unità, istanti, intervalli
                                       ▼
          weather_fetch_runs ◀── weather_begin_fetch / complete / fail (solo service role)
          weather_forecast_points (issued_at + valid_at, mai sovrascritti)
          weather_observations (ore passate: analisi Open-Meteo, flag "modellato")
                                       │  RLS per organizzazione
                                       ▼
          GitHub Pages: pannello "Dati meteorologici" (solo lettura + richiesta di aggiornamento)
```

Il frontend **non chiama Open-Meteo per l'acquisizione ufficiale**. Il connettore diretto
preesistente (baseline del Decision Lab, F04 storico) resta invariato.

## 2. Schema (migrazione `20261024000007_weather_ingestion.sql`)

| Tabella | Contenuto | Regole |
| --- | --- | --- |
| `weather_locations` | organizzazione, progetto, nome, ambito `urban`/`agricultural`, lat/lon/quota, fuso `Europe/Rome`, attiva | editor crea/modifica, viewer legge, admin elimina; coordinate validate |
| `weather_fetch_runs` | provider, attivazione (pianificata/manuale), richiesta/completamento, stato, modello richiesto/restituito, cella effettiva, quota, tempo di generazione, emissione, validità, errore, `request_hash` | scritta solo dal service role; indice unico `(location_id, request_hash)` esclusi i tentativi falliti |
| `weather_forecast_points` | `issued_at`, `valid_at`, 9 variabili comuni, ET0, VPD, suolo a 4 temperature e 5 umidità, fonte, modello, `unit_metadata` | solo service role; **mai aggiornate**; unicità `(fetch_run_id, valid_at)` e `(location_id, issued_at, valid_at, model)` |
| `weather_observations` | istante, variabile, valore, unità, fonte (`open_meteo`, `sensore`, `manuale`, `dataset`), flag di qualità | i client inseriscono solo fonti diverse da `open_meteo`; dell'osservazione si modifica solo il flag |

Funzioni: `weather_authorize_manual` (utente, ruolo modifica, limite 10 min),
`weather_begin_fetch`, `weather_complete_fetch`, `weather_fail_fetch`,
`weather_active_locations` (solo service role). Audit in `audit_logs` per località,
acquisizioni e osservazioni.

## 3. Edge Function `open-meteo-ingest`

- **Pianificata:** intestazione `x-cron-secret` = `OPEN_METEO_CRON_SECRET`; body `{"all_active": true}` o `{"location_id": …}`.
- **Manuale:** token dell'utente; `weather_authorize_manual` verifica ruolo e frequenza; poi il service role registra.
- Legge coordinate e ambito dal database, rifiuta coordinate non valide (anche 0,0), chiama
  `https://api.open-meteo.com/v1/forecast` con `timezone=Europe/Rome`, `timeformat=unixtime`
  (istanti assoluti, nessuna ambiguità al cambio d'ora), `wind_speed_unit=ms`, `forecast_days=4`,
  `past_days=1`, `models=best_match`.
- Timeout 10 s per tentativo, al massimo 2 tentativi aggiuntivi (rete, timeout, 5xx, 429) con attesa crescente; 4xx non ripetuti.
- Idempotenza: `request_hash` = SHA-256 di località, coordinate, ambito, modello, variabili e ora di emissione. Stessa ora → `gia_acquisita`, nessuna chiamata a Open-Meteo.
- Riepilogo restituito: stato, ore registrate, osservazioni, emissione, intervallo di validità, cella, avvisi.
- Log: solo id della località e dell'acquisizione, esito, conteggi, codice d'errore.
- Codice: `supabase/functions/open-meteo-ingest/index.ts` (Deno, non eseguito localmente) e `supabase/functions/_shared/weatherIngest.ts` (testato su PGlite). Il parser `openMeteoForecast.ts` è copiato dal dominio con `npm run sync:functions` (un test verifica che sia identico).

Segreti (mai nel repository): `SUPABASE_SERVICE_ROLE_KEY` (fornito da Supabase alla funzione),
`OPEN_METEO_CRON_SECRET` (secret della funzione e Vault), facoltativo `ALLOWED_ORIGIN`
(es. `https://manocchio91.github.io`).

## 4. Frequenza e pianificazione

Modello `supabase/sql/schedule-open-meteo-ingest.sql`: `pg_cron` ogni 3 ore al minuto 7
(`7 */3 * * *`), `pg_net` con URL e segreto letti dal **Vault** (`open_meteo_ingest_url`,
`open_meteo_cron_secret`). Mai ogni minuto. Aggiornamento manuale: al massimo una volta ogni
10 minuti per località (server) e ogni ora produce una sola emissione (idempotenza).

| Operazione | Comando |
| --- | --- |
| Disabilitare | `select cron.unschedule('mdt-open-meteo-ingest');` |
| Sospendere / riattivare | `update cron.job set active = false|true where jobname = 'mdt-open-meteo-ingest';` |
| Rieseguire ora | la `net.http_post` del modello, a mano nell'SQL editor |
| Monitorare | `cron.job_run_details`, `net._http_response`, `weather_fetch_runs` (query nel modello) |
| Escludere una località | `update weather_locations set active = false where id = …;` |

## 5. Variabili e unità

| Variabile | Unità | Ambito |
| --- | --- | --- |
| temperature_2m, apparent_temperature | °C | tutti |
| relative_humidity_2m | % | tutti |
| precipitation | mm | tutti |
| precipitation_probability | % | tutti |
| wind_speed_10m, wind_gusts_10m | m/s | tutti |
| wind_direction_10m | ° | tutti |
| shortwave_radiation | W/m² | tutti |
| et0_fao_evapotranspiration | mm | agricolo |
| vapour_pressure_deficit | kPa | agricolo |
| soil_temperature_0/6/18/54cm | °C | agricolo |
| soil_moisture_0–1/1–3/3–9/9–27/27–81cm | m³/m³ | agricolo |

Una risposta con unità diverse è rifiutata; valori fuori intervallo fisico diventano mancanti con avviso.
Le profondità del suolo non disponibili per una cella generano un avviso, non un errore.

## 6. Origine e limiti spaziali

- Dato **territoriale modellato**: la cella del modello (es. 41,586 / 14,661, quota 700 m per Campobasso) non coincide con il punto richiesto e non rappresenta una piazza o un filare.
- `best_match` sceglie il modello per area e orizzonte: **Open-Meteo non dichiara nella risposta quale modello ha usato**, quindi `model_returned` resta vuoto e l'interfaccia lo dice.
- Open-Meteo non restituisce l'ora del run del modello: `issued_at` è l'ora (UTC, arrotondata) di acquisizione.
- In pagina: “Dato territoriale modellato, non rilevato da sensore locale”; etichetta **DATO OPEN-METEO**, distinta da **MISURATO DA SENSORE**, **STIMATO DA MODELLO** e **SIMULATO**.

## 7. Attribuzione

Obbligatoria e mostrata nel pannello: *Weather data by Open-Meteo.com (CC BY 4.0)*; modelli dei
servizi meteorologici nazionali e ECMWF; per suolo e rianalisi *Copernicus Climate Change Service
(ERA5/ERA5-Land)*. L'uso è entro i limiti della API gratuita non commerciale; per uso commerciale
o volumi elevati serve un piano Open-Meteo dedicato.

## 8. Errori, conservazione e cancellazione

- Un errore (rete, timeout, 4xx/5xx, risposta incompleta o non valida) chiude solo l'acquisizione con `error_code` e messaggio troncato: **i dati validi precedenti non vengono toccati** e la stessa ora può essere ritentata.
- Nell'interfaccia: caricamento, assenza di rete (ultimi dati salvati nel browser, dichiarati), errore, dato non aggiornato (emissione oltre 6 ore), ultimo tentativo fallito.
- Conservazione: previsioni e acquisizioni restano per backtest e confronto ex-post (nessuna scadenza automatica). Si disattiva una località per fermare l'acquisizione; l'eliminazione (solo admin) cancella a cascata il suo storico ed è registrata nell'audit. Una politica di conservazione a tempo è nel backlog (B-143).

## 9. Relazione con Timestral (F31 invariata)

`buildTimestralRequestFromWeather` (`packages/domain/src/forecast/weatherSource.ts`) e
`loadTimestralInput` (`apps/web/src/state/weather.ts`) preparano l'input di Timestral:

- target: misure da sensore se presenti, altrimenti l'analisi Open-Meteo delle ore passate (provenienza dichiarata `sensore` / `open_meteo` / `misto`);
- covariata nota in anticipo: analisi Open-Meteo sul contesto e ultima emissione Open-Meteo sull'orizzonte (`kind: previsione_meteo`), più il calendario;
- nessun valore futuro del target nell'input.

Timestral resta **non attivo** finché il servizio reale non viene eseguito: l'adapter risponde
“Motore Timestral non configurato” (nella modalità guidata: “Il modello avanzato non è ancora disponibile. Puoi consultare la previsione di base.”). I dati Open-Meteo non vengono mai presentati come previsione
Timestral, né il contrario.

## 10. Test su Supabase reale (da eseguire con credenziali di staging)

Aggiunti a [14-piano-test-supabase-reale.md](14-piano-test-supabase-reale.md) (W1–W8) e a
`scripts/supabase-real/verify.mjs`. Passi di pubblicazione:

1. `npx supabase db push` (migrazione 0007);
2. `npx supabase functions deploy open-meteo-ingest`;
3. `npx supabase secrets set OPEN_METEO_CRON_SECRET=… ALLOWED_ORIGIN=https://manocchio91.github.io`;
4. Vault + `schedule-open-meteo-ingest.sql`;
5. `node scripts/supabase-real/verify.mjs` con le variabili d'ambiente di staging.

## 11. Stato sul progetto Supabase di staging (24/10/2026)

| Passo | Stato |
| --- | --- |
| Migrazioni 0001–0009 | **applicate** (`supabase db push --linked`); 0008 ridotta; 0009 sposta PostGIS in `extensions` (25/10/2026, report `docs/reports/supabase-postgis-0009-2026-10-25.md`) |
| Catalogo | 41 tabelle dell'app con RLS e policy, bucket `project-media` privato, trigger su `auth.users`, funzioni di servizio non eseguibili da `authenticated` |
| Accesso anonimo | **44/44 controlli superati** (`scripts/supabase-real/anon-check.mjs`, report in `docs/reports/supabase-anon-check-2026-10-24.md`) |
| Edge Function `open-meteo-ingest`, segreti, job pg_cron | **non pubblicati** |
| Acquisizione reale su Supabase | **non eseguita** |

Problemi aperti dal Security Advisor, non risolvibili con una migrazione perché gli oggetti sono
di PostGIS e appartengono a `supabase_admin` (un tentativo è fallito con
`must be owner of table spatial_ref_sys` ed è stato annullato per intero):

- `public.spatial_ref_sys` senza RLS e, con i privilegi predefiniti, scrivibile da `anon` e
  `authenticated` via API REST: un client potrebbe alterare i sistemi di riferimento usati dai
  calcoli geometrici (nessun dato personale, ma rischio di integrità).
- `public.st_estimatedextent` (SECURITY DEFINER) eseguibile da `anon` e `authenticated`.
- PostGIS installato nello schema `public` (avviso).

Soluzioni possibili, da decidere:
1. **Spostare PostGIS nello schema `extensions`** finché il database è vuoto: migrazione che rimuove
   l'estensione con le colonne geometriche, la reinstalla in `extensions` e ricrea le colonne
   (o reset dello staging con la migrazione 0001 corretta). Risolve tutti e tre i punti.
2. **Chiedere al supporto Supabase** la revoca dei privilegi su `spatial_ref_sys` e `st_estimatedextent`.
3. Accettare temporaneamente il rischio sullo staging (nessun dato reale) e risolvere prima della produzione.

**Aggiornamento 25/10/2026:** con la migrazione 0009 PostGIS è nello schema `extensions`. Il Security Advisor non segnala più errori (0 ERROR, 12 WARN voluti); i problemi su `spatial_ref_sys` e `st_estimatedextent` sono risolti. I test reali hanno però rivelato tre difetti preesistenti (conflitto di versione con SQLSTATE 40001 → HTTP 504 via PostgREST; organizzazioni non eliminabili; utenti proprietari di progetti non eliminabili), descritti nel report della 0009 e da correggere con una nuova migrazione.
