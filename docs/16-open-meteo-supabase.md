# 16 — Acquisizione meteo Open-Meteo → Supabase (F04)

> **Stato: Beta, attivo sullo staging dal 25/10/2026.** Edge Function pubblicata, segreti e
> Vault configurati, migrazione 0011 con job ogni 3 ore, sito pubblico collegato con la
> publishable key. Dati Open-Meteo **modellati**, non validati con utenti né calibrati con
> sensori. Vedi §12.

| Livello | Stato |
| --- | --- |
| Implementato | migrazioni 0007 e 0011, Edge Function `open-meteo-ingest`, job pg_cron, pannello UI, collegamento del sito con la publishable key, adapter per Timestral (non attivo) |
| Testato in locale | `openMeteoForecast.test.ts`, `supabase/tests/weather.test.ts`, `supabase/tests/schedule0011.test.ts`, `weatherPanel.test.tsx`, `weatherSource.test.ts`, `e2e/weather.spec.ts`, `e2e/header-mobile.spec.ts` |
| Testato su servizio reale | Open-Meteo + Supabase di staging: 22/22 controlli (`scripts/supabase-real/open-meteo-runtime.mjs`, report `docs/reports/open-meteo-runtime-2026-10-25.md`); interfaccia collegata allo staging su build locale e **sul sito pubblico con utenti autenticati** (ruoli, isolamento, acquisizione dalla pagina, persistenza, responsive; §13) |
| Pubblicato | Edge Function e job sullo staging; sito GitHub Pages collegato allo staging |
| Simulato | E2E dell’interfaccia con Supabase simulato; errore di acquisizione simulato sul database reale |
| Validato con utenti / scientificamente | no (B-158, B-162, B-163) |

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
- **Controllo di salute:** `GET` → `{"servizio":"open-meteo-ingest","stato":"attivo"}`, senza dati né configurazione.
- Pubblicata con `--no-verify-jwt` (il job non ha un token utente): l'autenticazione è nella funzione — segreto del job confrontato a tempo costante, oppure token dell'utente verificato dal database (PostgREST) dentro `weather_authorize_manual`. Senza credenziali → 401; chiave pubblica o token contraffatto → 403.
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

Migrazione `20261025000011_open_meteo_schedule.sql`: `pg_cron` ogni 3 ore (`0 */3 * * *`, UTC),
`pg_net` con URL e segreto letti dal **Vault** per nome (`open_meteo_ingest_url`,
`open_meteo_cron_secret`) a ogni esecuzione; senza i due valori il job non chiama nulla. Job unico
(`mdt-open-meteo-ingest`, sostituito se esiste). Nessun segreto né URL nel file. Mai ogni minuto.
Aggiornamento manuale: al massimo una volta ogni 10 minuti per località (server) e ogni ora
produce una sola emissione (idempotenza). Guida di gestione: `supabase/sql/schedule-open-meteo-ingest.sql`.

| Operazione | Comando |
| --- | --- |
| Stato (solo service role) | `select public.weather_schedule_status();` |
| Disabilitare | `select cron.unschedule('mdt-open-meteo-ingest');` |
| Sospendere / riattivare | `update cron.job set active = false|true where jobname = 'mdt-open-meteo-ingest';` |
| Rieseguire ora (stesso meccanismo) | `do $$ begin execute (select command from cron.job where jobname = 'mdt-open-meteo-ingest'); end $$;` |
| Monitorare | `cron.job_run_details`, `net._http_response`, `weather_fetch_runs` (query nella guida) |
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

## 12. Attivazione sullo staging (25/10/2026)

| Passo | Stato |
| --- | --- |
| Verifiche preliminari | migrazioni 0001–0010 allineate; database senza utenti, organizzazioni, progetti, località; Security Advisor 0 errori; controllo anonimo 47/47; istantanea logica (catalogo, conteggi, dati) fuori dal repository |
| Edge Function | `open-meteo-ingest` versione 1, `verify_jwt: false`; health 200; senza credenziali 401; segreto errato 401; chiave pubblica 403; token contraffatto 403; CORS solo `https://manocchio91.github.io` |
| Segreti | `OPEN_METEO_CRON_SECRET` nuovo (casuale, 64 caratteri) nei Supabase Secrets e nel Vault; `ALLOWED_ORIGIN`; URL della funzione nel Vault. Nessun valore nel repository o nei log |
| Acquisizioni reali | urbano (Campobasso) e agricolo (Molise): 79 ore ciascuno, cella 41,5861/14,6614 a 700 m e 41,8036/14,9055 a 427 m; tutte le variabili presenti e plausibili, unità corrette; ET0, VPD, temperatura e umidità del suolo a tutte le profondità per l’agricolo |
| Idempotenza e limiti | stessa ora → `gia_acquisita`, nessun duplicato; secondo aggiornamento manuale entro 10 minuti → 429; località inattiva esclusa (409 se richiesta) |
| Permessi | lettore 403 sull’aggiornamento; altra organizzazione 404 e 0 righe; nessun client scrive dati `open_meteo`; previsioni immutabili; errore simulato senza perdita dei dati validi; nessuna previsione Timestral |
| Job | migrazione 0011 applicata: un job attivo `0 */3 * * *` (UTC), comando con valori dal Vault e senza URL; invocazione controllata con lo stesso comando → HTTP 200, località attive già acquisite, nessun duplicato |
| Auth | Site URL `https://manocchio91.github.io/dt.github.io/`, redirect `https://manocchio91.github.io/dt.github.io/**` (unica modifica alla configurazione) |
| Sito | GitHub Actions con `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (variabili pubbliche); controllo del bundle che blocca la pubblicazione se compare una chiave segreta |

Dati temporanei della verifica: prefisso `MDT_RUNTIME_TEST_<timestamp>`, creati con le procedure
normali ed eliminati con `delete_organization` e Auth Admin, con rilettura dei conteggi.
Rischi residui: dato territoriale modellato (non sensore), soglie dimostrative, nessuna
validazione con utenti, Timestral non attivo, conservazione dei dati senza scadenza (B-162–B-166).

## 13. Chiusura controllata e test autenticato sul sito pubblico (25/10/2026)

Verifica eseguita su `https://manocchio91.github.io/dt.github.io/` con utenti e organizzazioni
temporanei (prefisso `MDT_PUBLIC_TEST_<timestamp>`, creati con Auth Admin e `create_organization`;
progetti e località creati dal sito). Gli accessi sono stati inseriti dal responsabile nel
browser; il resto del percorso è stato eseguito con clic reali.

| Verifica | Esito |
| --- | --- |
| Editor | organizzazione scelta; guida in 6 domande per urbano e agricolo; progetti salvati su Supabase; punto di acquisizione creato; “Aggiorna dati” → 77 ore per ciascun progetto (cella urbana 41,5861/14,6614 a 700 m, agricola 41,8036/14,9055 a 429 m); sintesi in parole semplici con dettagli chiusi; ET0, VPD e suolo solo nei dettagli; limite di 10 minuti visibile |
| Lettore | vede i dati, nessun pulsante di modifica; dal server: aggiornamento 403, nuova località 403, salvataggio 42501, modifica 0 righe |
| Esterno | nessun progetto del Comune nell’elenco; link diretto → “Progetto non trovato”; 0 righe in progetti, documenti e tabelle meteo; aggiornamento 404 |
| Persistenza | dopo ricaricamento e dopo uscita e nuovo accesso i progetti e i dati restano |
| Rete e chiavi | il browser chiama solo Supabase (REST e Edge Function), mai `api.open-meteo.com`; bundle senza secret key né JWT (13 file); sessione con ruolo `authenticated` |
| Responsive e tastiera | 320, 375, 390, 768 px senza scorrimento orizzontale (24 controlli); a 375 px focus visibile e dettagli apribili con Invio |
| Contenuti | nessun dato Timestral; nessuna prescrizione automatica (l’irrigazione compare solo come alternativa “non valutabile senza verifica”, decisa dall’agronomo) |
| Pulizia | 4 utenti, 2 organizzazioni, 2 progetti, 2 località, 2 acquisizioni, 154 previsioni, 516 osservazioni eliminati; rilettura globale: 0 righe di dati e 0 righe di audit con il prefisso |

**Stato del job dopo la pulizia:** attivo (`0 */3 * * *`), ma senza località attive: è *attivo ma
fermo sui dati* finché un utente autenticato non crea un progetto con un punto di acquisizione.
Un’esecuzione con lo stesso comando del job risponde HTTP 200 con
`{"results":[],"completate":0,"errori":0}`: l’assenza di località è un’esecuzione valida, non un errore.
