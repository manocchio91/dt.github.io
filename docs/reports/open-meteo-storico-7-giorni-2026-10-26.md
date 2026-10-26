# Storico Open-Meteo di 7 giorni — verifica sullo staging (2026-10-26)

Progetto Supabase di TEST (riferimento omesso). Nessuna credenziale in questo file.

## Recupero dallo staging

- Migrazione `20261026000012_weather_history_backfill` (applicata il 26/10 da un PC poi bloccato, mai
  pubblicata su GitHub): ricostruita dalle 7 istruzioni registrate in
  `supabase_migrations.schema_migrations`; `supabase db push --dry-run` la considera già applicata.
- Edge Function `open-meteo-ingest` versione 4 (pubblicata il 26/10 alle 09:37): sorgente scaricata e
  versionata senza modifiche (3 file identici byte per byte alla versione pubblicata). Nessuna nuova
  pubblicazione necessaria: il codice del repository coincide con la versione attiva.
- Migrazione `20261026000013_weather_history_provenance` (nuova, non distruttiva) applicata dopo il
  backup dello schema (fuori dal repository) e il `--dry-run`.

## Verifica reale (`scripts/supabase-real/weather-history-runtime.mjs`, prefisso `MDT_SEVENDAYS_TEST_20261026144450`)

| Controllo | Esito | Evidenza |
|---|---|---|
| Recupero iniziale alla creazione della località (urbano, agricolo) | ✔ | prima acquisizione 1–2 s dopo la creazione, avviata dal trigger del server, senza attendere il job |
| Storico di 7 giorni | ✔ | 168/168 ore valide, 168 continue, 0 lacune, 81 ore future, dal 17/10 23:00 UTC al 26/10 13:00 UTC |
| Ore salvate | ✔ | 207 ore passate per variabile (past_days=8) |
| Variabili urbane | ✔ | 9: temperatura, umidità relativa, temperatura percepita, precipitazioni, probabilità di precipitazione, vento, direzione, raffiche, radiazione |
| Variabili agricole | ✔ | 20: le 9 urbane + ET0, VPD, temperatura del suolo (4 profondità), umidità del suolo (5 profondità) |
| Duplicati | ✔ | 0 su 1.863 righe (urbano) e 4.140 (agricolo); 0 in tutta la tabella a fine test |
| Provenienza | ✔ | ogni riga collegata all'acquisizione (cella 41.586/14.661 quota 700 m urbano, 41.804/14.906 quota 427 m agricolo, modello best_match) |
| Storico e previsione separati | ✔ | storico sempre prima dell'emissione, previsioni dall'emissione in poi |
| Job delle 3 ore (15:00 UTC) | ✔ | esecuzione `succeeded`; 1 sola ora nuova per località, nessun duplicato |
| Aggiornamento manuale nella stessa ora | ✔ | “già acquisita”: nessuna nuova acquisizione, nessuna chiamata a Open-Meteo |
| Lettura | ✔ | legge lo stato dello storico, aggiornamento rifiutato (403) |
| Organizzazione esterna | ✔ | stato, storico e località non visibili (404) |
| Anonimo | ✔ | nessun accesso a stato e storico |

Controllo anonimo (`anon-check.mjs`, esteso a `weather_history_status` e `delete_organization`):
49/49. Security Advisor: 0 errori; avvisi intenzionali, tra cui la nuova funzione
`weather_history_status` (security definer con controllo del ruolo).

## Pulizia (dati temporanei)

Eliminati con `delete_organization` (ruolo di servizio, conferma del nome) e Auth Admin, solo per i
prefissi di prova `MDT_BACKFILL_TEST_20261026083749` (dati lasciati dal PC bloccato),
`MDT_SEVENDAYS_TEST_20261026144450` e `MDT_TIMESTRAL_TEST_20261026145726`: 6 organizzazioni, 11 utenti
di prova, 7 progetti, 7 località con acquisizioni, storico e previsioni. Prima della pulizia: 0
organizzazioni e 0 utenti estranei ai prefissi, nessun file nello storage.

Conteggi riletti dal database dopo la pulizia: organizzazioni 0, utenti 0, progetti 0, località 0,
acquisizioni 0, previsioni meteo 0, storico 0, previsioni Timestral 0, media 0, oggetti nello storage
0; catalogo dei modelli 4, bucket `project-media`, job `mdt-open-meteo-ingest` attivo ogni 3 ore
(senza località non elabora dati), trigger di prima acquisizione attivo. Le 25.595 righe di
`audit_logs` restano per scelta, nessuna collegata a un'organizzazione.
